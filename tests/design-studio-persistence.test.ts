import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createDesignStudioRepository } from "../db/design-studio-repository";
import { createAssessmentRepository, type Query } from "../db/repository";
import { AppError } from "../lib/assessment-domain";
import { basicCompetencyDraft, basicQuestionDraft, basicRubricDraft, runDeterministicValidityAudit, toAssessmentDefinition } from "../lib/design-studio-domain";

const migrationNames = [
  "0001_assessment_core.sql", "0002_curriculum_growth.sql", "0003_ai_assessment_suggestions.sql",
  "0004_assessment_growth_bridge.sql", "0005_school_curriculum_plans.sql",
  "0006_teacher_classes_and_distributions.sql", "0007_design_studio.sql",
];
const schema = (await Promise.all(migrationNames.map(name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8")))).join("\n");
const adapter = (db: PGlite): Query => async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;

let pg: PGlite;
let designs: ReturnType<typeof createDesignStudioRepository>;
let assessments: ReturnType<typeof createAssessmentRepository>;

before(async () => {
  pg = await PGlite.create();
  await pg.exec(schema);
  const query = adapter(pg);
  designs = createDesignStudioRepository(query);
  assessments = createAssessmentRepository(query);
});
after(async () => { await pg.close(); });

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
  session = await designs.saveBlueprint(session.id, ownerId, { rubric, questions, source: "basic_draft" });
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
});
