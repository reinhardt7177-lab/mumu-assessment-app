import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createGrowthRepository } from "../db/growth-repository";
import { createAssessmentRepository, type Query } from "../db/repository";
import { AppError, type AssessmentDefinition } from "../lib/assessment-domain";
import { validateRubric, validateTerm, validateUnit } from "../lib/growth-domain";
import { previewCurriculumDocument } from "../lib/curriculum-import";
import { validateSchoolPlan } from "../lib/school-curriculum-domain";

const coreSchema = await readFile(new URL("../db/migrations/0001_assessment_core.sql", import.meta.url), "utf8");
const growthSchema = await readFile(new URL("../db/migrations/0002_curriculum_growth.sql", import.meta.url), "utf8");
const aiSchema = await readFile(new URL("../db/migrations/0003_ai_assessment_suggestions.sql", import.meta.url), "utf8");
const bridgeSchema = await readFile(new URL("../db/migrations/0004_assessment_growth_bridge.sql", import.meta.url), "utf8");
const schoolPlanSchema = await readFile(new URL("../db/migrations/0005_school_curriculum_plans.sql", import.meta.url), "utf8");
const classroomSchema = await readFile(new URL("../db/migrations/0006_teacher_classes_and_distributions.sql", import.meta.url), "utf8");
let pg: PGlite;
let repo: ReturnType<typeof createGrowthRepository>;
let assessmentRepo: ReturnType<typeof createAssessmentRepository>;
const adapter = (db: PGlite): Query => async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;
const now = () => new Date().toISOString();

before(async () => {
  pg = await PGlite.create();
  await pg.exec(coreSchema);
  await pg.exec(growthSchema);
  await pg.exec(aiSchema);
  await pg.exec(bridgeSchema);
  await pg.exec(schoolPlanSchema);
  await pg.exec(classroomSchema);
  repo = createGrowthRepository(adapter(pg));
  assessmentRepo = createAssessmentRepository(adapter(pg));
});
after(async () => { await pg.close(); });

const rubricDefinition = {
  criteria: [{
    key: "concept",
    name: "개념과 원리",
    description: "선거와 시민 주권의 관계를 설명하는 수행을 확인한다.",
    high: "선거의 의미와 역할을 시민 주권과 연결하고 새로운 사례에 적용하여 설명한다.",
    middle: "선거의 의미와 역할을 설명하고 시민 참여의 중요성을 사례와 연결한다.",
    low: "선거를 투표 절차로 설명하지만 시민 주권과 연결한 이유는 아직 드러나지 않는다.",
  }],
};

async function createBase(owner = `teacher-${crypto.randomUUID()}`) {
  const term = await repo.createTerm(owner, {
    schoolYear: 2026,
    semester: 1,
    grade: 6,
    className: `6-1-${crypto.randomUUID().slice(0, 6)}`,
    subject: "사회",
  });
  const unit = await repo.createUnit(term.id, owner, {
    orderIndex: 1,
    title: "민주주의와 시민 참여",
    standardCodes: ["6사08-01"],
  });
  const standard = (unit.standards as { id: string; code: string; content: string }[])[0];
  const rubric = await repo.createRubric(standard.id, owner, rubricDefinition);
  const criterion = (rubric.criteria as { id: string }[])[0];
  await repo.lockRubric(String(rubric.id), owner);
  const student = await repo.createStudent(term.id, owner, { studentRef: "6-1-01", displayName: "1번 학생" });
  return { owner, term, unit, standard, rubric, criterion, student };
}

test("학년·교과·성취기준·서술 루브릭을 서버에서 검증", () => {
  assert.equal(validateTerm({ schoolYear: 2026, semester: 1, grade: 6, className: "6-1", subject: "사회" }).subject, "사회");
  assert.throws(() => validateTerm({ schoolYear: 2026, semester: 1, grade: 1, className: "1-1", subject: "사회" }), status(400));
  assert.throws(() => validateUnit({ orderIndex: 1, title: "민주주의", standardCodes: ["9사01-01"] }, { grade: 6, subject: "사회" }), status(400));
  assert.throws(() => validateRubric({ criteria: [{ key: "concept", name: "개념", description: "개념 이해를 확인한다.", high: "잘함", middle: "보통", low: "부족" }] }), status(400));
});

test("CSV 학년 교육과정에서 단원·평가방법·성취기준을 외부 AI 없이 추출", async () => {
  const csv = [
    "순서,학년,학기,교과,단원명,성취기준,평가시기,평가방법,평가요소",
    "1,6,1,사회,민주주의와 시민 참여,6사08-01 6사08-02,5월,서술형·발표,선거와 시민 주권의 관계 설명",
  ].join("\n");
  const preview = await previewCurriculumDocument(new File([csv], "6학년-사회.csv", { type: "text/csv" }), {
    documentKind: "grade", schoolYear: 2026, grade: 6, semester: 1, subject: "사회",
  });
  assert.equal(preview.gradeTemplates.length, 1);
  assert.equal(preview.gradeTemplates[0].units[0].title, "민주주의와 시민 참여");
  assert.deepEqual(preview.gradeTemplates[0].units[0].standardCodes, ["6사08-01", "6사08-02"]);
  assert.deepEqual(preview.gradeTemplates[0].units[0].assessmentMethods, ["text", "speech"]);
  assert.equal(preview.matchedStandards.length, 2);
  assert.equal(preview.sourceDocument.detectedStandardCount, 2);
  assert.match(preview.sourceDocument.sha256, /^[0-9a-f]{64}$/);
});

test("학교 계획 승인본을 버전 보존하며 학급 학기·단원으로 원자 복제", async () => {
  const owner = `school-admin-${crypto.randomUUID()}`;
  const school = await repo.createSchool(owner, { name: "무무초등학교", region: "전북특별자치도" });
  assert.equal(school.role, "admin");
  assert.equal((await repo.listSchools(owner)).length, 1);
  assert.equal((await repo.listSchools("other-teacher")).length, 0);
  const templateKey = crypto.randomUUID();
  const planInput = {
    schoolId: school.id,
    schoolYear: 2026,
    state: "approved" as const,
    schoolBasics: { vision: "학생의 질문과 성장을 중심에 두는 교육", focusAreas: ["학생 주도 탐구"], assessmentPolicy: "성취기준에 따른 준거참조 평가를 실시한다.", schoolEvents: [] },
    gradeTemplates: [{
      key: templateKey, grade: 6, semester: 1 as const, subject: "사회" as const, notes: "",
      units: [{
        key: crypto.randomUUID(), orderIndex: 1, title: "민주주의와 시민 참여",
        standardCodes: ["6사08-01", "6사08-02"], plannedPeriod: "5월", teachingHours: 12,
        assessmentTiming: "5월 4주", assessmentMethods: ["text", "speech"] as ("text" | "speech")[],
        assessmentFocus: "선거와 시민 주권의 관계를 설명한다.",
      }],
    }],
    sourceDocuments: [{ name: "6학년 교육과정.csv", mimeType: "text/csv", sha256: "a".repeat(64), documentKind: "grade" as const, extractedAt: now(), detectedStandardCount: 2 }],
  };
  assert.equal(validateSchoolPlan(planInput).gradeTemplates[0].units[0].standardCodes.length, 2);
  const approved = await repo.saveSchoolPlan(owner, planInput);
  assert.equal(approved.state, "approved");
  assert.equal(approved.version, 1);
  await assert.rejects(repo.applySchoolPlan(approved.id, "other-teacher", { templateKey, className: "1반" }), status(404));
  const term = await repo.applySchoolPlan(approved.id, owner, { templateKey, className: "1반" });
  assert.equal(term.sourceSchoolPlanId, approved.id);
  assert.equal(term.sourceTemplateKey, templateKey);
  assert.equal(term.subject, "사회");
  const dashboard = await repo.getDashboard(term.id, owner);
  assert.equal(dashboard.units.length, 1);
  assert.deepEqual(dashboard.units[0].standards.map(item => item.code), ["6사08-01", "6사08-02"]);
  await assert.rejects(repo.applySchoolPlan(approved.id, owner, { templateKey, className: "1반" }), status(409));
  const next = await repo.saveSchoolPlan(owner, { ...planInput, schoolBasics: { ...planInput.schoolBasics, vision: "질문·협력·성장을 연결하는 교육" } });
  assert.equal(next.version, 2);
  const history = await repo.listSchoolPlans(owner);
  assert.equal(history.find(item => item.id === approved.id)?.state, "retired");
  assert.equal(history.find(item => item.id === next.id)?.state, "approved");
  const audits = await pg.query<{ event_type: string }>("SELECT event_type FROM curriculum_audit_events WHERE owner_id = $1 AND event_type LIKE 'school%' ORDER BY created_at", [owner]);
  assert.deepEqual(audits.rows.map(item => item.event_type), ["school.created", "school_plan.approved", "school_plan.applied", "school_plan.approved"]);
});

test("교육과정 문항 AI 생성 요청·성공·실패·중복 재사용 이력을 보존", async () => {
  const owner = `teacher-${crypto.randomUUID()}`;
  const inputHash = "c".repeat(64);
  const run = await assessmentRepo.beginQuestionGeneration(owner, {
    model: "openai/gpt-5.6-luna",
    promptVersion: "elementary-questions-v2",
    inputHash,
    title: "민주주의 단원 평가",
    subject: "6학년 사회",
    learningGoal: "선거와 시민 주권의 관계를 근거와 함께 설명한다.",
    standards: [{ code: "6사08-01", domain: "정치", content: "선거의 의미와 역할을 파악한다." }],
    count: 1,
  });
  assert.equal(run.status, "pending");
  const completed = await assessmentRepo.completeQuestionGeneration(run.id, owner, {
    output: { questions: [{ prompt: "선거가 시민의 주권 행사인 까닭을 사례와 함께 설명하세요.", kind: "서술형", standardCode: "6사08-01", criterion: "논리적 설명", points: 20 }] },
    usage: { inputTokens: 300, outputTokens: 120, totalTokens: 420 },
    latencyMs: 780,
    providerMetadata: { gateway: "test" },
  });
  assert.equal(completed.status, "complete");
  assert.equal(completed.totalTokens, 420);
  assert.equal((completed.output as { questions: unknown[] }).questions.length, 1);
  const cached = await assessmentRepo.findCompletedQuestionGeneration(owner, "openai/gpt-5.6-luna", "elementary-questions-v2", inputHash);
  assert.equal(cached?.id, completed.id);
  assert.equal(await assessmentRepo.findCompletedQuestionGeneration("other-teacher", "openai/gpt-5.6-luna", "elementary-questions-v2", inputHash), null);
  const failedRun = await assessmentRepo.beginQuestionGeneration(owner, {
    model: "openai/gpt-5.6-luna", promptVersion: "elementary-questions-v2", inputHash: "d".repeat(64),
    title: "실패 기록", subject: "6학년 사회", learningGoal: "실패한 생성도 이력에 남긴다.",
    standards: [{ code: "6사08-01" }], count: 1,
  });
  const failed = await assessmentRepo.failQuestionGeneration(failedRun.id, owner, { errorCode: "budget_exceeded", errorMessage: "AI 사용 예산을 확인해 주세요.", latencyMs: 90 });
  assert.equal(failed?.status, "error");
  const history = await assessmentRepo.listQuestionGenerations(owner, 10);
  assert.equal(history.length, 1);
  assert.equal(history[0].id, completed.id);
  assert.equal(history[0].title, "민주주의 단원 평가");
  assert.equal(history[0].requestedCount, 1);
  const restored = await assessmentRepo.getQuestionGeneration(completed.id, owner);
  assert.equal((restored.output as { questions: unknown[] }).questions.length, 1);
  assert.deepEqual(await assessmentRepo.listQuestionGenerations("other-teacher", 10), []);
  await assert.rejects(assessmentRepo.getQuestionGeneration(completed.id, "other-teacher"), status(404));
});

test("단원 QR 평가 제출을 등록 학생의 원본 성장 증거로 자동 수합", async () => {
  const { owner, term, unit, standard, criterion, student } = await createBase();
  const definition: AssessmentDefinition = {
    title: "민주주의 단원 독립 수행", subject: "6학년 사회",
    learningGoal: "선거와 시민 주권의 관계를 새로운 사례에서 근거와 함께 설명한다.",
    type: "독립 수행평가", standardCodes: [standard.code], methods: ["text"],
    questions: [{ id: "q1", prompt: "학급 대표 선거가 학생의 의견을 반영하는 과정인 까닭을 설명하세요.", kind: "서술형", standardCode: standard.code, criterion: "개념과 원리", rubricCriterionId: criterion.id, points: 20 }],
    rubric: [{ name: "개념과 원리", standardCode: standard.code, rubricCriterionId: criterion.id, high: rubricDefinition.criteria[0].high, middle: rubricDefinition.criteria[0].middle, low: rubricDefinition.criteria[0].low }],
    grading: { upperThreshold: 80, middleThreshold: 50 },
  };
  const assessment = await assessmentRepo.create(owner, {
    definition, curriculumLink: { unitId: unit.id, eventType: "initial", context: "새로운 선거 사례에서 시민의 선택과 대표 권한의 관계를 독립적으로 설명한다.", occurredAt: now() },
  });
  assert.equal(assessment.curriculumLink?.termId, term.id);
  assert.equal(assessment.curriculumLink?.unitId, unit.id);
  assert.equal(assessment.curriculumLink?.unitTitle, unit.title);
  await assessmentRepo.setStatus(assessment.id, owner, "published");
  await assert.rejects(assessmentRepo.startAttempt(assessment.shareCode, "등록되지-않음"), status(409));
  const started = await assessmentRepo.startAttempt(assessment.shareCode, student.studentRef);
  assert.equal(started.attempt.curriculumStudentId, student.id);
  assert.equal(started.attempt.studentLabel, student.displayName);
  await assert.rejects(assessmentRepo.startAttempt(assessment.shareCode, student.studentRef), status(409));
  const submitted = await assessmentRepo.saveAttempt(assessment.shareCode, started.token, {
    answers: { q1: "학생들이 투표로 대표를 선택하므로 대표의 권한은 학생들의 선택에서 나옵니다." },
    revision: 0, timeSpentSeconds: 95, submit: true,
  });
  assert.equal(submitted.status, "submitted");
  const evidenceRows = (await pg.query<{ id: string; attempt_id: string; original_text: string }>("SELECT id, attempt_id, original_text FROM learning_evidence WHERE attempt_id = $1", [started.attempt.id])).rows;
  assert.equal(evidenceRows.length, 1);
  const original = JSON.parse(evidenceRows[0].original_text) as { format: string; answers: { standardCode: string; answer: string }[] };
  assert.equal(original.format, "mumu.text.answers.v1");
  assert.equal(original.answers[0].standardCode, standard.code);
  assert.match(original.answers[0].answer, /대표의 권한/);
  const retried = await assessmentRepo.saveAttempt(assessment.shareCode, started.token, { answers: { q1: "바꾼 답" }, revision: 0, timeSpentSeconds: 95, submit: true });
  assert.equal(retried.id, submitted.id);
  assert.equal((await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM learning_evidence WHERE attempt_id = $1", [started.attempt.id])).rows[0].count, 1);
  const workflow = await repo.getWorkflow(term.id, owner);
  const imported = workflow.evidence.find(item => item.attemptId === started.attempt.id);
  assert.equal(imported?.studentId, student.id);
  assert.equal(imported?.eventType, "initial");
  assert.equal(imported?.assistanceLevel, "independent");
  assert.equal((await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM curriculum_audit_events WHERE owner_id = $1 AND event_type IN ('assessment.linked', 'evidence.imported')", [owner])).rows[0].count, 2);
});

test("학기→단원→루브릭→증거→피드백→추가 학습→재평가→학기말 판단 전체 흐름", async () => {
  const { owner, term, unit, standard, criterion, student } = await createBase();
  await assert.rejects(repo.getOwnedTerm(term.id, "other-teacher"), status(404));

  const initialEvent = await repo.createEvent(String(unit.id), owner, {
    eventType: "initial",
    title: "선거와 시민 주권 첫 수행",
    context: "선거가 시민의 주권 행사인 이유를 사례와 함께 설명한다.",
    occurredAt: now(),
  });
  const initialEvidence = await repo.createEvidence(owner, {
    studentId: student.id,
    eventId: initialEvent.id,
    modality: "text",
    sourceKind: "student_response",
    assistanceLevel: "teacher_prompt",
    originalText: "선거는 대표를 뽑는 투표입니다.",
    transformationStatus: "original",
    teacherVerified: false,
    collectedAt: now(),
  });
  const draft = await repo.saveJudgement(initialEvidence.id, owner, {
    rubricCriterionId: criterion.id,
    level: "하",
    evidenceExcerpt: "선거는 대표를 뽑는 투표입니다.",
    rationale: "선거의 절차는 확인되지만 시민 주권과의 관계는 아직 설명하지 않았다.",
    state: "draft",
  });
  const initialFinal = await repo.saveJudgement(initialEvidence.id, owner, {
    rubricCriterionId: criterion.id,
    level: "하",
    evidenceExcerpt: "선거는 대표를 뽑는 투표입니다.",
    rationale: "교사 질문 뒤에도 시민이 권력을 행사한다는 관계는 답안에 드러나지 않았다.",
    state: "final",
  });
  assert.equal(draft.revision, 1);
  assert.equal(initialFinal.revision, 2);
  assert.equal(initialFinal.supersedesId, draft.id);

  const aiContext = await repo.getAiSuggestionContext(initialEvidence.id, criterion.id, owner);
  assert.equal(aiContext.standardCode, "6사08-01");
  assert.equal(aiContext.assistanceLevel, "teacher_prompt");
  const aiRun = await repo.beginAiSuggestion(initialEvidence.id, criterion.id, owner, "openai/gpt-5.6-luna", "criterion-v1", "a".repeat(64));
  assert.equal(aiRun.status, "pending");
  const aiSuggestion = await repo.completeAiSuggestion(aiRun.id, owner, {
    suggestedLevel: "하",
    confidence: 0.82,
    evidenceExcerpt: "선거는 대표를 뽑는 투표입니다.",
    rationale: "투표 절차는 설명했지만 시민 주권과의 관계를 연결한 근거는 드러나지 않았다.",
    uncertainty: "짧은 글 한 편만으로 다른 맥락의 적용 수준은 확인하기 어렵다.",
    missingEvidence: "새로운 선거 사례를 도움 없이 설명하는 수행 증거가 더 필요하다.",
    constructCaution: "글의 길이나 맞춤법을 사회 개념 이해 수준의 근거로 사용하지 않았다.",
    usage: { inputTokens: 420, outputTokens: 180, totalTokens: 600 },
    latencyMs: 910,
    providerMetadata: { gateway: "test" },
  });
  assert.equal(aiSuggestion.suggestedLevel, "하");
  assert.equal(aiSuggestion.totalTokens, 600);
  const cachedSuggestion = await repo.findCompletedAiSuggestion(initialEvidence.id, criterion.id, owner, "openai/gpt-5.6-luna", "criterion-v1", "a".repeat(64));
  assert.equal(cachedSuggestion?.id, aiSuggestion.id);
  const failedRun = await repo.beginAiSuggestion(initialEvidence.id, criterion.id, owner, "openai/gpt-5.6-luna", "criterion-v1", "b".repeat(64));
  const failed = await repo.failAiSuggestion(failedRun.id, owner, { errorCode: "rate_limited", errorMessage: "잠시 뒤 다시 시도해 주세요.", latencyMs: 120 });
  assert.equal(failed?.status, "error");

  const feedback = await repo.createFeedback(owner, {
    studentId: student.id,
    unitStandardId: standard.id,
    basisJudgementIds: [initialFinal.id],
    strength: "선거가 대표를 뽑는 절차라는 점을 정확하게 확인했다.",
    gapType: "conceptual",
    gapDescription: "선거 절차를 시민이 주권을 행사하는 원리와 연결하지 못했다.",
    nextLearning: "학급 대표 선거 사례에서 시민의 선택이 권력의 근거가 되는 과정을 다시 설명한다.",
  });
  const intervention = await repo.recordIntervention(feedback.id, owner, {
    activity: "시민·대표·권한 카드를 연결하고 선거 전후의 권력 관계를 말로 설명한다.",
    supportLevel: "step_hint",
    teacherNote: "대표가 권한을 얻는 근거를 시민의 선택에서 찾도록 단계 질문을 제공했다.",
    occurredAt: now(),
  });
  assert.equal(intervention.supportLevel, "step_hint");

  const supportedEvent = await repo.createEvent(String(unit.id), owner, {
    eventType: "formative",
    title: "추가 학습 중 확인",
    context: "카드와 문장 틀을 활용해 시민 주권의 의미를 다시 설명한다.",
    occurredAt: now(),
  });
  const supportedEvidence = await repo.createEvidence(owner, {
    studentId: student.id,
    eventId: supportedEvent.id,
    modality: "speech",
    sourceKind: "recording",
    assistanceLevel: "scaffolded",
    sourceRef: "private://audio/supported-example",
    transformedText: "시민이 대표를 선택해서 대표가 권한을 얻습니다.",
    transformationStatus: "teacher_verified",
    teacherVerified: true,
    collectedAt: now(),
  });
  await repo.saveJudgement(supportedEvidence.id, owner, {
    rubricCriterionId: criterion.id,
    level: "중",
    evidenceExcerpt: "시민이 대표를 선택해서 대표가 권한을 얻습니다.",
    rationale: "문장 틀의 도움을 받아 시민의 선택과 대표의 권한을 연결했다.",
    state: "final",
  });
  await assert.rejects(repo.saveSemesterJudgement(term.id, owner, {
    studentId: student.id,
    standardCode: "6사08-01",
    level: "중",
    rationale: "지원받은 두 수행에서는 관계 설명이 나타났으나 독립 수행 증거는 없다.",
    state: "final",
    evidenceIds: [initialEvidence.id, supportedEvidence.id],
    conflictingEvidenceIds: [],
  }), status(409));

  const reassessmentEvent = await repo.createEvent(String(unit.id), owner, {
    eventType: "reassessment",
    title: "새로운 맥락의 독립 재평가",
    context: "다른 지역의 주민 투표 사례에서 시민 주권이 실현되는 과정을 도움 없이 설명한다.",
    occurredAt: now(),
  });
  const independentEvidence = await repo.createEvidence(owner, {
    studentId: student.id,
    eventId: reassessmentEvent.id,
    modality: "text",
    sourceKind: "student_response",
    assistanceLevel: "independent",
    originalText: "주민이 투표로 결정하기 때문에 시민의 뜻이 정책 권한의 근거가 됩니다.",
    transformationStatus: "original",
    teacherVerified: false,
    collectedAt: now(),
  });
  await repo.saveJudgement(independentEvidence.id, owner, {
    rubricCriterionId: criterion.id,
    level: "상",
    evidenceExcerpt: "시민의 뜻이 정책 권한의 근거가 됩니다.",
    rationale: "새로운 주민 투표 사례에서 선택과 권한의 관계를 도움 없이 적용해 설명했다.",
    state: "final",
  });
  const link = await repo.linkReassessment(feedback.id, owner, {
    priorEvidenceId: initialEvidence.id,
    newEvidenceId: independentEvidence.id,
    independent: true,
  });
  assert.equal(link.independent, true);

  const semester = await repo.saveSemesterJudgement(term.id, owner, {
    studentId: student.id,
    standardCode: "6사08-01",
    level: "상",
    rationale: "최초에는 절차만 설명했으나 추가 학습 후 새로운 주민 투표 사례에서 시민의 선택이 권한의 근거임을 독립적으로 설명했다.",
    state: "final",
    evidenceIds: [initialEvidence.id, independentEvidence.id],
    conflictingEvidenceIds: [],
  });
  assert.equal(semester.level, "상");
  assert.equal(semester.revision, 1);

  const dashboard = await repo.getDashboard(term.id, owner);
  assert.equal(dashboard.activity.evidenceCount, 3);
  assert.equal(dashboard.activity.independentGrowthCount, 1);
  assert.equal(dashboard.activity.openFeedbackCount, 0);
  assert.equal(dashboard.activity.finalStandardCount, 1);
  assert.equal(dashboard.students[0].evidenceCount, 3);

  const workflow = await repo.getWorkflow(term.id, owner);
  assert.equal(workflow.events.length, 3);
  assert.equal(workflow.rubrics.length, 1);
  assert.equal(workflow.rubrics[0].criteria[0].name, "개념과 원리");
  assert.equal(workflow.evidence.length, 3);
  assert.equal(workflow.evidence.find(item => item.id === independentEvidence.id)?.judgements[0].level, "상");
  assert.equal(workflow.evidence.find(item => item.id === initialEvidence.id)?.aiSuggestions[0].suggestedLevel, "하");
  assert.equal(workflow.feedback[0].interventions.length, 1);
  assert.equal(workflow.feedback[0].reassessments[0].independent, true);
  assert.equal(workflow.semesterJudgements[0].evidence.length, 2);
  await assert.rejects(repo.getWorkflow(term.id, "other-teacher"), status(404));

  const auditCount = (await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM curriculum_audit_events WHERE owner_id = $1", [owner])).rows[0].count;
  assert.ok(auditCount >= 14);
});

test("원본 증거·교사 판단·감사 이력은 DB에서도 수정과 삭제를 차단", async () => {
  const { owner, unit, criterion, student } = await createBase();
  const event = await repo.createEvent(String(unit.id), owner, {
    eventType: "initial",
    title: "불변성 확인 평가",
    context: "학생 원문과 교사 판단을 저장한 뒤 변경 차단을 확인한다.",
    occurredAt: now(),
  });
  const evidence = await repo.createEvidence(owner, {
    studentId: student.id,
    eventId: event.id,
    modality: "text",
    sourceKind: "student_response",
    assistanceLevel: "independent",
    originalText: "원본 학생 답안",
    transformationStatus: "original",
    teacherVerified: false,
    collectedAt: now(),
  });
  const judgement = await repo.saveJudgement(evidence.id, owner, {
    rubricCriterionId: criterion.id,
    level: "중",
    evidenceExcerpt: "원본 학생 답안",
    rationale: "독립 수행 원문을 그대로 인용해 판단했다.",
    state: "final",
  });
  await assert.rejects(pg.query("UPDATE learning_evidence SET original_text = '바꾼 답안' WHERE id = $1", [evidence.id]));
  await assert.rejects(pg.query("DELETE FROM criterion_judgements WHERE id = $1", [judgement.id]));
  await assert.rejects(pg.query("DELETE FROM curriculum_audit_events WHERE owner_id = $1", [owner]));
  const stored = (await pg.query<{ original_text: string }>("SELECT original_text FROM learning_evidence WHERE id = $1", [evidence.id])).rows[0];
  assert.equal(stored.original_text, "원본 학생 답안");
});

test("다른 교사·다른 학생·초안 루브릭의 증거를 섞지 못한다", async () => {
  const base = await createBase();
  const other = await createBase();
  const event = await repo.createEvent(String(base.unit.id), base.owner, {
    eventType: "initial",
    title: "권한 분리 확인",
    context: "교사와 학생 소유권이 다른 증거를 차단한다.",
    occurredAt: now(),
  });
  await assert.rejects(repo.createEvidence(other.owner, {
    studentId: base.student.id,
    eventId: event.id,
    modality: "text",
    sourceKind: "student_response",
    assistanceLevel: "independent",
    originalText: "다른 교사의 접근",
    transformationStatus: "original",
    teacherVerified: false,
    collectedAt: now(),
  }), status(404));
  const evidence = await repo.createEvidence(base.owner, {
    studentId: base.student.id,
    eventId: event.id,
    modality: "text",
    sourceKind: "student_response",
    assistanceLevel: "independent",
    originalText: "같은 교사의 수행 증거",
    transformationStatus: "original",
    teacherVerified: false,
    collectedAt: now(),
  });
  const draftRubric = await repo.createRubric(base.standard.id, base.owner, rubricDefinition);
  const draftCriterion = (draftRubric.criteria as { id: string }[])[0];
  await assert.rejects(repo.saveJudgement(evidence.id, base.owner, {
    rubricCriterionId: draftCriterion.id,
    level: "상",
    evidenceExcerpt: "같은 교사의 수행 증거",
    rationale: "잠기지 않은 루브릭으로 판단하려는 시도다.",
    state: "final",
  }), status(404));
  await assert.rejects(repo.saveJudgement(evidence.id, other.owner, {
    rubricCriterionId: other.criterion.id,
    level: "상",
    evidenceExcerpt: "같은 교사의 수행 증거",
    rationale: "다른 교사의 루브릭과 증거를 섞으려는 시도다.",
    state: "final",
  }), status(404));
});
