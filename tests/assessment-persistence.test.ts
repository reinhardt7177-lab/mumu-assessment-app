import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createAssessmentRepository, type Query } from "../db/repository";
import { AppError, objectiveScoreDraft, publicAssessmentDefinition, validateAnswers, validateAssessment, type AssessmentDefinition } from "../lib/assessment-domain";

const coreSchema = await readFile(new URL("../db/migrations/0001_assessment_core.sql", import.meta.url), "utf8");
const growthSchema = await readFile(new URL("../db/migrations/0002_curriculum_growth.sql", import.meta.url), "utf8");
const aiSchema = await readFile(new URL("../db/migrations/0003_ai_assessment_suggestions.sql", import.meta.url), "utf8");
const bridgeSchema = await readFile(new URL("../db/migrations/0004_assessment_growth_bridge.sql", import.meta.url), "utf8");
const schoolPlanSchema = await readFile(new URL("../db/migrations/0005_school_curriculum_plans.sql", import.meta.url), "utf8");
const classroomSchema = await readFile(new URL("../db/migrations/0006_teacher_classes_and_distributions.sql", import.meta.url), "utf8");
const evidenceSchema = await readFile(new URL("../db/migrations/0008_multimodal_evidence.sql", import.meta.url), "utf8");
const schema = [coreSchema, growthSchema, aiSchema, bridgeSchema, schoolPlanSchema, classroomSchema, evidenceSchema].join("\n");
let pg: PGlite;
let repo: ReturnType<typeof createAssessmentRepository>;
const adapter = (db: PGlite): Query => async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
before(async () => { pg = await PGlite.create(); await pg.exec(schema); repo = createAssessmentRepository(adapter(pg)); });
after(async () => { await pg.close(); });
const definition = (): AssessmentDefinition => ({
  title: "사회 변화 평가", subject: "6학년 사회", learningGoal: "민주주의의 의미를 근거와 함께 설명한다.", type: "독립 수행평가",
  standardCodes: ["6사01-01"], questions: [{ id: "q1", prompt: "민주주의의 의미를 설명하세요.", kind: "서술형", standardCode: "6사01-01", criterion: "근거", points: 20 }],
  methods: ["text"], rubric: [{ name: "근거", high: "구체적인 근거를 들어 정확하게 설명한다.", middle: "근거를 일부 들어 설명한다.", low: "근거를 제시하는 데 도움이 필요하다." }], grading: { upperThreshold: 80, middleThreshold: 50 },
});
const owner = () => `teacher-${crypto.randomUUID()}`;

test("문항별 허용 응답을 학생 정의에 보존하고 허용하지 않은 텍스트 제출을 차단", () => {
  const base = definition();
  const input = { ...base, methods: ["text", "photo"] as AssessmentDefinition["methods"], questions: [{ ...base.questions[0], responseMethods: ["photo"] }] };
  const parsed = validateAssessment(input);
  assert.deepEqual(publicAssessmentDefinition(parsed).questions[0].responseMethods, ["photo"]);
  assert.throws(() => validateAnswers({ q1: "사진 대신 입력" }, parsed), status(400));
  assert.throws(() => validateAssessment({ ...input, questions: [{ ...input.questions[0], responseMethods: ["speech"] }] }), status(400));
  assert.throws(() => validateAssessment({ ...input, questions: [{ ...input.questions[0], responseMethods: ["photo", "photo"] }] }), status(400));
});
async function opened() { const teacher = owner(); const a = await repo.create(teacher, definition()); await repo.setStatus(a.id, teacher, "published"); return { teacher, a }; }
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;

test("실제 초등 학년군·성취기준·문항·루브릭 연결 검증", () => {
  assert.equal(validateAssessment(definition()).standardCodes[0], "6사01-01");
  assert.throws(() => validateAssessment({ ...definition(), subject: "1학년 사회" }), status(400));
  assert.throws(() => validateAssessment({ ...definition(), standardCodes: ["9사01-01"] }), status(400));
  const d = definition();
  assert.throws(() => validateAssessment({ ...d, questions: [d.questions[0], d.questions[0]] }), status(400));
  assert.throws(() => validateAssessment({ ...d, rubric: [{ ...d.rubric[0], name: "다른 기준" }] }), status(400));
});
test("객관식·단답형 구성 검증, 학생 정답키 비노출, 자동 채점 초안", () => {
  const base = definition();
  const selected: AssessmentDefinition = {
    ...base,
    questions: [{ ...base.questions[0], kind: "선택형", choices: ["직접 민주 정치", "대의 민주 정치", "입헌 군주제", "전제 정치"], answerKey: ["대의 민주 정치"] }],
  };
  assert.equal(validateAssessment(selected).questions[0].kind, "선택형");
  assert.throws(() => validateAssessment({ ...selected, questions: [{ ...selected.questions[0], choices: ["같은 보기", "같은 보기"] }] }), status(400));
  assert.throws(() => validateAssessment({ ...selected, questions: [{ ...selected.questions[0], answerKey: ["없는 보기"] }] }), status(400));
  assert.throws(() => validateAnswers({ q1: "임의 답" }, selected), status(400));
  assert.equal(validateAnswers({ q1: "대의 민주 정치" }, selected, true).q1, "대의 민주 정치");

  const short: AssessmentDefinition = {
    ...base,
    questions: [{ ...base.questions[0], kind: "단답형", answerKey: ["민주주의", "민주 주의"], choices: [] }],
  };
  assert.equal(objectiveScoreDraft(short.questions[0], "  민주주의  ")?.points, 20);
  assert.equal(objectiveScoreDraft(short.questions[0], "왕정")?.points, 0);
  assert.throws(() => validateAssessment({ ...short, questions: [{ ...short.questions[0], answerKey: [] }] }), status(400));

  const publicDefinition = publicAssessmentDefinition(selected);
  assert.equal(publicDefinition.questions[0].choices?.length, 4);
  assert.equal("answerKey" in publicDefinition.questions[0], false);
});

test("말하기 문항은 오럴 테스트 응답 방식과 함께 저장", () => {
  const base = definition();
  const speaking = { ...base, questions: [{ ...base.questions[0], kind: "말하기" as const }] };
  assert.throws(() => validateAssessment(speaking), status(400));
  assert.equal(validateAssessment({ ...speaking, methods: ["text", "speech"] }).questions[0].kind, "말하기");
});

test("교사별 목록·상세·배포·학생 조회 권한 분리", async () => {
  const teacher = owner(); const a = await repo.create(teacher, definition());
  assert.equal((await repo.list(teacher)).length, 1); assert.equal((await repo.list(owner())).length, 0);
  await assert.rejects(repo.getOwned(a.id, owner()), status(404));
  await assert.rejects(repo.submissions(a.id, owner()), status(404));
  await assert.rejects(repo.setStatus(a.id, owner(), "published"), status(404));
});
test("초안 비공개·평가별 고유 링크·학교 승인 없는 비텍스트 응답 배포 차단", async () => {
  const teacher = owner(); const a = await repo.create(teacher, definition()); const b = await repo.create(teacher, { ...definition(), methods: ["speech"] });
  assert.notEqual(a.shareCode, b.shareCode);
  await assert.rejects(repo.getByCode(a.shareCode), status(404));
  await assert.rejects(repo.startAttempt(a.shareCode, "1번"), status(409));
  await assert.rejects(repo.setStatus(b.id, teacher, "published"), status(409));
});
test("답안 저장 후 새 인스턴스에서 다시 불러오기", async () => {
  const { a } = await opened(); const { token, attempt } = await repo.startAttempt(a.shareCode, "1번");
  await repo.saveAttempt(a.shareCode, token, { answers: { q1: "내가 생각한 답" }, revision: attempt.revision, timeSpentSeconds: 20 });
  const restored = await createAssessmentRepository(adapter(pg)).getAttempt(a.shareCode, token);
  assert.equal(restored.answers.q1, "내가 생각한 답"); assert.equal(restored.timeSpentSeconds, 20); assert.equal(restored.revision, 1);
});
test("토큰 해시 저장·교사 조회에서 비밀정보 제거", async () => {
  const { a, teacher } = await opened(); const { token, attempt } = await repo.startAttempt(a.shareCode, "2번");
  await repo.saveAttempt(a.shareCode, token, { answers: { q1: "시민이 참여합니다." }, revision: 0, timeSpentSeconds: 30, submit: true });
  const stored = (await pg.query<{ token_hash: string }>("SELECT token_hash FROM student_attempts WHERE id = $1", [attempt.id])).rows[0];
  assert.notEqual(stored.token_hash, token);
  const submissions = JSON.stringify(await repo.submissions(a.id, teacher));
  assert.ok(!submissions.includes(token)); assert.ok(!submissions.includes(stored.token_hash));
});
test("학생별·평가별 참여 토큰 격리", async () => {
  const { a } = await opened(); const { token } = await repo.startAttempt(a.shareCode, "3번"); const { a: other } = await opened();
  await assert.rejects(repo.getAttempt(a.shareCode, "위조 토큰"), status(401));
  await assert.rejects(repo.getAttempt(other.shareCode, token), status(401));
});
test("오래된 탭의 저장이 최신 답안을 덮어쓰지 않는다", async () => {
  const { a } = await opened(); const { token } = await repo.startAttempt(a.shareCode, "4번");
  await repo.saveAttempt(a.shareCode, token, { answers: { q1: "최신 답" }, revision: 0, timeSpentSeconds: 40 });
  await assert.rejects(repo.saveAttempt(a.shareCode, token, { answers: { q1: "오래된 답" }, revision: 0, timeSpentSeconds: 10 }), status(409));
  assert.equal((await repo.getAttempt(a.shareCode, token)).answers.q1, "최신 답");
});
test("빈 답·다른 문항·과도한 길이를 서버에서 거절", async () => {
  const { a } = await opened(); const { token } = await repo.startAttempt(a.shareCode, "5번");
  for (const answers of [{}, { q2: "다른 문항" }, { q1: "a".repeat(10001) }]) await assert.rejects(repo.saveAttempt(a.shareCode, token, { answers, revision: 0, timeSpentSeconds: 0, submit: true }), status(400));
});
test("중복 제출은 한 건·제출 이후 답안 잠금", async () => {
  const { a, teacher } = await opened(); const { token } = await repo.startAttempt(a.shareCode, "6번");
  const input = { answers: { q1: "최종 답" }, revision: 0, timeSpentSeconds: 60, submit: true };
  const first = await repo.saveAttempt(a.shareCode, token, input);
  const retry = await repo.saveAttempt(a.shareCode, token, { ...input, answers: { q1: "바꾼 답" } });
  assert.equal(first.id, retry.id); assert.equal(retry.answers.q1, "최종 답"); assert.equal((await repo.list(teacher))[0].submittedCount, 1);
  await assert.rejects(repo.saveAttempt(a.shareCode, token, { ...input, submit: false }), status(409));
});
test("마감 이후 신규 참여·저장 차단, 기존 답안 보존", async () => {
  const { a, teacher } = await opened(); const { token } = await repo.startAttempt(a.shareCode, "7번"); await repo.setStatus(a.id, teacher, "closed");
  await assert.rejects(repo.startAttempt(a.shareCode, "8번"), status(409));
  await assert.rejects(repo.saveAttempt(a.shareCode, token, { answers: { q1: "답" }, revision: 0, timeSpentSeconds: 2 }), status(409));
  assert.equal((await repo.getAttempt(a.shareCode, token)).studentLabel, "7번");
});
test("교사 확정과 공개 분리·상중하 산출·감사 이력", async () => {
  const { a, teacher } = await opened(); const { token, attempt } = await repo.startAttempt(a.shareCode, "9번");
  await repo.saveAttempt(a.shareCode, token, { answers: { q1: "정치에 참여한다." }, revision: 0, timeSpentSeconds: 50, submit: true });
  const review = { questionScores: [{ questionId: "q1", points: 16, reason: "핵심 개념을 설명함" }], feedback: "다음에는 예를 들어 보세요.", state: "final" };
  await repo.saveReview(a.id, attempt.id, teacher, review); assert.equal(await repo.studentResult(a.shareCode, token), null);
  await assert.rejects(repo.saveReview(a.id, attempt.id, owner(), review), status(404));
  await repo.saveReview(a.id, attempt.id, teacher, { ...review, state: "published" });
  const result = await repo.studentResult(a.shareCode, token); assert.equal(result?.total, 16); assert.equal(result?.level, "상");
  assert.equal((await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM review_events WHERE attempt_id = $1", [attempt.id])).rows[0].count, 2);
});
test("배점 초과 거절", async () => {
  const { a, teacher } = await opened(); const { attempt } = await repo.startAttempt(a.shareCode, "10번");
  await assert.rejects(repo.saveReview(a.id, attempt.id, teacher, { questionScores: [{ questionId: "q1", points: 21, reason: "과다" }], feedback: "피드백", state: "final" }), status(400));
});
test("최종 확정 없는 직접 공개·확정 후 점수 바꿔 공개를 차단", async () => {
  const { a, teacher } = await opened(); const { token, attempt } = await repo.startAttempt(a.shareCode, "11번");
  await repo.saveAttempt(a.shareCode, token, { answers: { q1: "답안 원문" }, revision: 0, timeSpentSeconds: 20, submit: true });
  const review = { questionScores: [{ questionId: "q1", points: 12, reason: "부분적인 개념 이해" }], feedback: "근거를 더 써주세요.", state: "published" };
  await assert.rejects(repo.saveReview(a.id, attempt.id, teacher, review), status(409));
  await repo.saveReview(a.id, attempt.id, teacher, { ...review, state: "final" });
  await assert.rejects(repo.saveReview(a.id, attempt.id, teacher, { ...review, feedback: "검토하지 않은 변경" }), status(409));
  assert.equal(await repo.studentResult(a.shareCode, token), null);
  await repo.saveReview(a.id, attempt.id, teacher, review);
  await assert.rejects(repo.saveReview(a.id, attempt.id, teacher, { ...review, state: "draft" }), status(409));
});
test("동시에 저장해도 한 버전만 성공하며 최종 답을 덮어쓰지 않는다", async () => {
  const { a } = await opened(); const { token } = await repo.startAttempt(a.shareCode, "12번");
  const outcomes = await Promise.allSettled(["첫 탭", "둘째 탭"].map(answer => repo.saveAttempt(a.shareCode, token, { answers: { q1: answer }, revision: 0, timeSpentSeconds: 10 })));
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(r => r.status === "rejected").length, 1);
  assert.equal((await repo.getAttempt(a.shareCode, token)).revision, 1);
});
test("실제 PostgreSQL 종료 후 디스크 재시작 보존", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mumu-pg-test-"));
  if (!directory.startsWith(join(tmpdir(), "mumu-pg-test-"))) throw new Error("Unsafe test cleanup path");
  try {
    const first = await PGlite.create(directory); await first.exec(schema); const teacher = owner();
    const a = await createAssessmentRepository(adapter(first)).create(teacher, definition()); await first.close();
    const second = await PGlite.create(directory); assert.equal((await createAssessmentRepository(adapter(second)).getOwned(a.id, teacher)).definition.title, "사회 변화 평가"); await second.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("AI 요청 제한이 DB에 남고 여러 인스턴스에서도 적용된다", async () => {
  const key = `ai:${owner()}`;
  await repo.consumeLimit(key, 2, 3600);
  const other = createAssessmentRepository(adapter(pg));
  await other.consumeLimit(key, 2, 3600);
  await assert.rejects(repo.consumeLimit(key, 2, 3600), status(429));
  await pg.query("UPDATE request_limits SET bucket = bucket - 1 WHERE key = $1", [key]);
  await repo.consumeLimit(key, 2, 3600);
});
