import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createGrowthRepository } from "../db/growth-repository";
import type { Query } from "../db/repository";
import { AppError } from "../lib/assessment-domain";
import { validateRubric, validateTerm, validateUnit } from "../lib/growth-domain";

const coreSchema = await readFile(new URL("../db/migrations/0001_assessment_core.sql", import.meta.url), "utf8");
const growthSchema = await readFile(new URL("../db/migrations/0002_curriculum_growth.sql", import.meta.url), "utf8");
let pg: PGlite;
let repo: ReturnType<typeof createGrowthRepository>;
const adapter = (db: PGlite): Query => async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;
const now = () => new Date().toISOString();

before(async () => {
  pg = await PGlite.create();
  await pg.exec(coreSchema);
  await pg.exec(growthSchema);
  repo = createGrowthRepository(adapter(pg));
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
