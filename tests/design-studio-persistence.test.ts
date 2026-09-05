import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createDesignStudioRepository } from "../db/design-studio-repository";
import { createGrowthRepository } from "../db/growth-repository";
import { createEvidenceRepository } from "../db/evidence-repository";
import { pendingDesignChanges } from "../lib/design-editor-state";
import { evidenceRubrics } from "../lib/evidence-rubrics";
import { createAssessmentRepository, type Query } from "../db/repository";
import { AppError } from "../lib/assessment-domain";
import { basicCompetencyDraft, basicQuestionDraft, basicRubricDraft, defaultQuestionPlan, matchesQuestionPlan, questionPlanSchema, runDeterministicValidityAudit, toAssessmentDefinition } from "../lib/design-studio-domain";


const migrationNames = [
  "0001_assessment_core.sql", "0002_curriculum_growth.sql", "0003_ai_assessment_suggestions.sql",
  "0004_assessment_growth_bridge.sql", "0005_school_curriculum_plans.sql",
  "0006_teacher_classes_and_distributions.sql", "0007_design_studio.sql", "0008_multimodal_evidence.sql", "0009_screen_recording_evidence.sql",
];
const schema = (await Promise.all(migrationNames.map(name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8")))).join("\n");
const adapter = (db: PGlite): Query => async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;

let pg: PGlite;
let designs: ReturnType<typeof createDesignStudioRepository>;
let assessments: ReturnType<typeof createAssessmentRepository>;
const previousBlobToken = process.env.BLOB_READ_WRITE_TOKEN;

before(async () => {
  process.env.BLOB_READ_WRITE_TOKEN = "synthetic-test-token";
  pg = await PGlite.create();
  await pg.exec(schema);
  const query = adapter(pg);
  designs = createDesignStudioRepository(query);
  assessments = createAssessmentRepository(query);
});
after(async () => { await pg.close(); if (previousBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = previousBlobToken; });

test("응답 방식 수정은 생성 전에 저장 대상이며 저장된 감사는 불필요하게 무효화하지 않는다", async () => {
  const saved = await preparedSession(`teacher-${crypto.randomUUID()}`);
  assert.deepEqual(pendingDesignChanges(saved, saved), {});
  const edited = { ...saved, blueprint: { ...saved.blueprint!, methods: ["speech"] as const } };
  assert.deepEqual(pendingDesignChanges({ ...edited, blueprint: { ...edited.blueprint, methods: ["speech"] } }, saved), { methods: ["speech"] });
});

test("생성 전 유형별 문항 수를 검증하고 개별 문항 응답 설정 오류를 승인 전에 차단", async () => {
  assert.equal(questionPlanSchema.safeParse(defaultQuestionPlan).success, true);
  assert.equal(questionPlanSchema.safeParse({ 선택형: 0, 단답형: 0, 서술형: 0, 말하기: 0 }).success, false);
  assert.equal(questionPlanSchema.safeParse({ ...defaultQuestionPlan, 선택형: 20 }).success, false);
  const session = await preparedSession(`teacher-${crypto.randomUUID()}`);
  const first = session.blueprint!.questions[0];
  const questions = (["선택형", "단답형", "서술형"] as const).map(kind => ({ ...first, kind }));
  assert.equal(matchesQuestionPlan(questions, defaultQuestionPlan), true);
  assert.equal(matchesQuestionPlan([...questions, first], defaultQuestionPlan), false);
  const audit = runDeterministicValidityAudit({ ...session, rubric: session.blueprint!.rubric, methods: ["text", "speech"], questions: [{ ...first, kind: "말하기", responseMethods: ["text"] }] });
  assert.equal(audit.blocked, true);
  assert.ok(audit.threats.some(item => item.issue.includes("음성 응답")));
});

test("스튜디오 승인→단원 루브릭→녹화 단독 제출→성장 증거, 중복 승인과 타교사 연결 차단", async () => {
  const owner = `teacher-${crypto.randomUUID()}`;
  const growth = createGrowthRepository(adapter(pg));
  const media = createEvidenceRepository(adapter(pg));
  const term = await growth.createTerm(owner, { schoolYear: 2026, semester: 1, grade: 6, className: "합성 6-1", subject: "사회" });
  const unit = await growth.createUnit(term.id, owner, { orderIndex: 1, title: "합성 민주주의 단원", standardCodes: ["6사01-01"] });
  const student = await growth.createStudent(term.id, owner, { studentRef: "synthetic-01", displayName: "합성 학생" });
  let session = await preparedSession(owner);
  session = await designs.saveBlueprint(session.id, owner, { ...session.blueprint!, methods: ["screen"], source: "teacher" });
  session = await designs.saveValidity(session.id, owner, runDeterministicValidityAudit({ ...session, ...session.blueprint! }), "teacher");
  const definition = toAssessmentDefinition(session);
  const link = { unitId: unit.id, eventType: "initial" as const, context: session.learningGoal, occurredAt: new Date().toISOString() };
  await assert.rejects(designs.approveInUnit(session.id, "other-teacher", definition, link), status(404));
  await assert.rejects(designs.approveInUnit(session.id, owner, definition, { ...link, unitId: crypto.randomUUID() }), status(409));
  assert.equal((await assessments.list(owner)).length, 0);
  const id = await designs.approveInUnit(session.id, owner, definition, link);
  assert.equal(await designs.approveInUnit(session.id, owner, definition, link), id);
  const assessment = await assessments.getOwned(id, owner);
  assert.equal(assessment.curriculumLink?.unitId, unit.id);
  assert.ok(assessment.definition.questions[0].rubricCriterionId);
  assert.equal((await growth.getWorkflow(term.id, owner)).rubrics.length, 1);
  await media.savePolicy(owner, { enabled: true, providerId: "vercel-gateway", acknowledgement: "합성 자료만 사용하는 연결 회귀 테스트입니다.", retentionDays: 30 });
  await assessments.setStatus(id, owner, "published");
  const { attempt, token } = await assessments.startAttempt(assessment.shareCode, student.studentRef);
  await assert.rejects(assessments.saveAttempt(assessment.shareCode, token, { answers: {}, revision: attempt.revision, timeSpentSeconds: 30, submit: true }), status(400));
  const asset = await media.createAsset(attempt.id, { questionId: definition.questions[0].id, modality: "screen", blobPathname: "synthetic/screen.webm", originalFilename: "synthetic.webm", mimeType: "video/webm", byteSize: 128, sha256: "a".repeat(64), identifiersRemovedConfirmed: true });
  await assessments.saveAttempt(assessment.shareCode, token, { answers: {}, revision: attempt.revision, timeSpentSeconds: 30, submit: true });
  assert.equal((await media.listAttemptResponses(attempt.id))[0].state, "submitted");
  const workflow = await growth.getWorkflow(term.id, owner);
  assert.equal(workflow.evidence.length, 1);
  assert.match(workflow.evidence[0].originalText!, /screen/);
  assert.ok(workflow.evidence[0].originalText!.includes(asset.assetId));
  await assert.rejects(growth.getAiSuggestionContext(workflow.evidence[0].id, assessment.definition.questions[0].rubricCriterionId!, owner), status(409));
  await assert.rejects(media.createAsset(attempt.id, { questionId: definition.questions[0].id, modality: "screen", blobPathname: "synthetic/second.webm", originalFilename: "second.webm", mimeType: "video/webm", byteSize: 128, sha256: "b".repeat(64), identifiersRemovedConfirmed: true }), status(409));
  const repeat = await preparedSession(owner);
  const repeatId = await designs.approveInUnit(repeat.id, owner, toAssessmentDefinition(repeat), { ...link, eventType: "reassessment" });
  assert.equal((await assessments.getOwned(repeatId, owner)).definition.questions[0].rubricCriterionId, assessment.definition.questions[0].rubricCriterionId);
  assert.equal((await growth.getWorkflow(term.id, owner)).rubrics.length, 1);
  let revised = await preparedSession(owner);
  revised = await designs.saveBlueprint(revised.id, owner, { ...revised.blueprint!, rubric: revised.blueprint!.rubric.map(item => ({ ...item, high: item.high + " 두 사례를 비교한다." })), source: "teacher" });
  revised = await designs.saveValidity(revised.id, owner, runDeterministicValidityAudit({ ...revised, ...revised.blueprint! }), "teacher");
  const revisedId = await designs.approveInUnit(revised.id, owner, toAssessmentDefinition(revised), link);
  const changedCriterion = (await assessments.getOwned(revisedId, owner)).definition.questions[0].rubricCriterionId!;
  const after = await growth.getWorkflow(term.id, owner);
  assert.equal(after.rubrics.length, 2);
  assert.deepEqual(evidenceRubrics(after.rubrics, after.evidence[0]).flatMap(item => item.criteria.map(criterion => criterion.id)), [assessment.definition.questions[0].rubricCriterionId]);
  await assert.rejects(growth.saveJudgement(after.evidence[0].id, owner, { rubricCriterionId: changedCriterion, level: "상", evidenceExcerpt: "합성 수행 원문입니다.", rationale: "다른 버전으로 소급 채점하면 안 됩니다.", state: "final" }), status(404));
  await assert.rejects(growth.getAiSuggestionContext(after.evidence[0].id, changedCriterion, owner), status(409));
});

test("문항 유형 조합과 말하기 응답 방식의 타당도를 점검", () => {
  const standards = [{ code: "6사01-01", domain: "정치", content: "민주주의의 의미와 중요성을 이해하고 시민의 역할을 탐색한다.", rationale: "학습 목표에 직접 연결됩니다.", confidence: .9, state: "selected" as const }];
  const rubric = [{ id: "criterion-1", name: "개념 이해", description: "민주주의의 의미를 정확히 설명한다.", standardCode: "6사01-01", high: "정확한 개념과 사례를 연결하여 스스로 설명한다.", middle: "핵심 개념을 설명하지만 사례 연결은 보완이 필요하다.", low: "핵심 개념을 부분적으로 표현하며 안내가 필요하다." }];
  const selectedOnly = runDeterministicValidityAudit({
    learningGoal: "민주주의의 의미와 시민의 역할을 설명한다.", standards, rubric, methods: ["text"],
    questions: [{ id: "question-1", prompt: "민주주의의 뜻과 가장 가까운 것을 고르세요.", kind: "선택형", standardCode: "6사01-01", criterion: "개념 이해", points: 10, choices: ["시민이 주권을 행사하는 정치", "한 사람이 모든 권력을 가지는 정치"], answerKey: ["시민이 주권을 행사하는 정치"], evidenceExpected: "민주주의의 핵심 개념을 구별한다." }],
  });
  assert.equal(selectedOnly.blocked, false);
  assert.ok(selectedOnly.threats.some(item => item.issue.includes("객관식·단답형만")));

  const speakingWithoutAudio = runDeterministicValidityAudit({
    learningGoal: "민주주의의 의미와 시민의 역할을 설명한다.", standards, rubric, methods: ["text"],
    questions: [{ id: "question-1", prompt: "민주주의의 의미를 자신의 말로 설명하세요.", kind: "말하기", standardCode: "6사01-01", criterion: "개념 이해", points: 10, choices: [], answerKey: [], evidenceExpected: "민주주의의 핵심 개념을 말로 설명한다." }],
  });
  assert.equal(speakingWithoutAudio.blocked, true);
});

async function preparedSession(ownerId: string) {
  let session = await designs.create(ownerId, {
    title: "민주주의의 발전 서술형 평가", grade: 6, subject: "사회",
    learningGoal: "민주주의의 의미와 발전 과정을 근거와 함께 설명한다.",
    source: { kind: "direct_text", text: "6사01-01 민주주의의 의미와 중요성을 사례를 들어 살펴본다." },
  });
  session = await designs.saveStandards(session.id, ownerId, [{
    code: "6사01-01", domain: "정치", content: "민주주의의 의미와 중요성을 이해하고, 민주주의 발전을 위한 시민의 역할을 탐색한다.",
    rationale: "학습 목표의 민주주의 의미와 시민의 역할에 직접 연결됩니다.", confidence: .94, state: "selected",
  }]);
  const competency = basicCompetencyDraft(session);
  session = await designs.saveCompetency(session.id, ownerId, competency, "basic_draft");
  const rubric = basicRubricDraft(competency);
  const questions = basicQuestionDraft(rubric);
  session = await designs.saveBlueprint(session.id, ownerId, { rubric, questions, methods: ["text", "photo", "speech", "chat", "screen"], source: "basic_draft" });
  const validity = runDeterministicValidityAudit({ learningGoal: session.learningGoal, standards: session.standards, rubric, questions });
  assert.equal(validity.blocked, false);
  return designs.saveValidity(session.id, ownerId, validity, "basic_draft");
}

test("교사별 설계 작업을 분리하고 모든 편집 단계를 버전으로 저장", async () => {
  const ownerId = `teacher-${crypto.randomUUID()}`;
  const session = await preparedSession(ownerId);
  assert.equal(session.currentStep, 6);
  assert.equal(session.status, "ready");
  assert.equal(session.standards.filter(item => item.state === "selected").length, 1);
  assert.ok(session.competency);
  assert.ok(session.blueprint?.rubric.length);
  assert.ok(session.blueprint?.questions.length);
  assert.deepEqual(session.blueprint?.methods, ["text", "photo", "speech", "chat", "screen"]);
  assert.equal((await designs.list(ownerId)).length, 1);
  assert.equal((await designs.list(`teacher-${crypto.randomUUID()}`)).length, 0);
  await assert.rejects(designs.get(session.id, `teacher-${crypto.randomUUID()}`), status(404));

  const next = { ...session.competency!, bigIdea: `${session.competency!.bigIdea} 시민 참여까지 연결한다.` };
  const saved = await designs.saveCompetency(session.id, ownerId, next, "teacher");
  assert.equal(saved.competency?.bigIdea, next.bigIdea);
  const versions = await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM competency_unpacks WHERE session_id = $1", [session.id]);
  assert.equal(versions.rows[0].count, 2);
});

test("통과한 타당도 감사 뒤 기존 평가 보관함에 한 번만 승인", async () => {
  const ownerId = `teacher-${crypto.randomUUID()}`;
  const session = await preparedSession(ownerId);
  const definition = toAssessmentDefinition(session);
  const assessmentId = await designs.approve(session.id, ownerId, definition);
  assert.equal(await designs.approve(session.id, ownerId, definition), assessmentId);
  const assessment = await assessments.getOwned(assessmentId, ownerId);
  assert.equal(assessment.definition.title, session.title);
  assert.equal(assessment.status, "draft");
  assert.deepEqual(assessment.definition.standardCodes, ["6사01-01"]);
  assert.deepEqual(assessment.definition.methods, ["text", "photo", "speech", "chat", "screen"]);
  assert.equal((await designs.get(session.id, ownerId)).status, "approved");
  await assert.rejects(designs.updateBasics(session.id, ownerId, { title: "승인 후 변경" }), status(409));
});

test("타당도 점검 뒤 루브릭이나 문항을 바꾸면 재점검 전 승인을 차단", async () => {
  const ownerId = `teacher-${crypto.randomUUID()}`;
  let session = await preparedSession(ownerId);
  session = await designs.saveBlueprint(session.id, ownerId, {
    rubric: session.blueprint!.rubric,
    questions: session.blueprint!.questions.map((item, index) => index === 0 ? { ...item, prompt: `${item.prompt} 반드시 수업에서 다룬 사례를 포함하세요.` } : item),
    source: "teacher",
  });
  assert.equal(session.status, "draft");
  await assert.rejects(designs.approve(session.id, ownerId, toAssessmentDefinition({ ...session, validity: { ...session.validity!, blocked: false } })), status(409));
  const validity = runDeterministicValidityAudit({ learningGoal: session.learningGoal, standards: session.standards, rubric: session.blueprint!.rubric, questions: session.blueprint!.questions });
  session = await designs.saveValidity(session.id, ownerId, validity, "basic_draft");
  assert.ok(await designs.approve(session.id, ownerId, toAssessmentDefinition(session)));
});

test("중대한 타당도 경고는 승인 차단", async () => {
  const ownerId = `teacher-${crypto.randomUUID()}`;
  let session = await designs.create(ownerId, {
    title: "연결 누락 평가", grade: 6, subject: "사회", learningGoal: "민주주의를 근거와 함께 설명한다.",
    source: { kind: "direct_text", text: "민주주의의 의미를 설명하는 수업" },
  });
  session = await designs.saveStandards(session.id, ownerId, [{ code: "6사01-01", domain: "정치", content: "민주주의의 의미와 중요성을 이해하고, 민주주의 발전을 위한 시민의 역할을 탐색한다.", rationale: "학습 목표와 연결됩니다.", confidence: .9, state: "selected" }]);
  const competency = basicCompetencyDraft(session);
  const rubric = basicRubricDraft(competency);
  session = await designs.saveCompetency(session.id, ownerId, competency, "basic_draft");
  session = await designs.saveBlueprint(session.id, ownerId, { rubric, questions: [{ ...basicQuestionDraft(rubric)[0], criterion: "연결되지 않은 기준" }], source: "teacher" });
  const validity = runDeterministicValidityAudit({ learningGoal: session.learningGoal, standards: session.standards, rubric, questions: session.blueprint!.questions });
  assert.equal(validity.blocked, true);
  session = await designs.saveValidity(session.id, ownerId, validity, "basic_draft");
  await assert.rejects(designs.approve(session.id, ownerId, {
    title: "임시 평가", subject: "6학년 사회", learningGoal: session.learningGoal, type: "독립 수행평가", standardCodes: ["6사01-01"], methods: ["text"],
    rubric: rubric.map(item => ({ name: item.name, standardCode: item.standardCode, high: item.high, middle: item.middle, low: item.low })),
    questions: [{ id: "question-1", prompt: "민주주의의 의미를 근거와 함께 설명하세요.", kind: "서술형", standardCode: "6사01-01", criterion: rubric[0].name, points: 10 }],
    grading: { upperThreshold: 80, middleThreshold: 50 },
  }), status(409));
});

test("이전 통과 기록이 있어도 가장 최신 타당도 감사가 차단이면 승인하지 않음", async () => {
  const ownerId = `teacher-${crypto.randomUUID()}`;
  let session = await preparedSession(ownerId);
  const validDefinition = toAssessmentDefinition(session);
  session = await designs.saveValidity(session.id, ownerId, {
    ...session.validity!, overall: "재설계 필요", fitForPurpose: false, blocked: true,
    threats: [{ severity: "major", issue: "최신 검토에서 루브릭과 문항의 연결 오류를 발견했습니다.", recommendation: "문항 기준을 수정하고 다시 점검하세요." }],
  }, "teacher");
  assert.equal(session.validity?.blocked, true);
  await assert.rejects(designs.approve(session.id, ownerId, validDefinition), status(409));
});

test("AI 생성 결과와 사용량을 주소 가능한 실행 이력으로 저장하고 재사용", async () => {
  const ownerId = `teacher-${crypto.randomUUID()}`;
  const session = await preparedSession(ownerId);
  const inputHash = createHash("sha256").update("same-design-input").digest("hex");
  const runId = await designs.beginGeneration(ownerId, session.id, { feature: "rubric_generation", model: "openai/gpt-5.4-mini", promptVersion: "test-v1", inputHash, inputJson: { goal: session.learningGoal } });
  await designs.completeGeneration(runId, ownerId, { output: { rubric: session.blueprint!.rubric }, usage: { inputTokens: 120, outputTokens: 240, totalTokens: 360 }, latencyMs: 800 });
  const cached = await designs.findCompletedGeneration(ownerId, session.id, "rubric_generation", "openai/gpt-5.4-mini", "test-v1", inputHash);
  assert.equal(cached?.id, runId);
  assert.equal(Number(cached?.totalTokens), 360);
  await designs.rejectGeneration(runId, ownerId, "합성 출력의 내용 검증에 실패했습니다.");
  assert.equal(await designs.findCompletedGeneration(ownerId, session.id, "rubric_generation", "openai/gpt-5.4-mini", "test-v1", inputHash), null);
  const rejected = await pg.query<{ total_tokens: number; output_json: unknown }>("SELECT total_tokens, output_json FROM design_generation_runs WHERE id = $1", [runId]);
  assert.equal(rejected.rows[0].total_tokens, 360);
  assert.ok(rejected.rows[0].output_json);
});
