import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createAssessmentRepository, type Query } from "../db/repository";
import { createClassroomRepository } from "../db/classroom-repository";
import { createGrowthRepository } from "../db/growth-repository";
import { AppError, type AssessmentDefinition } from "../lib/assessment-domain";

const migrationNames = [
  "0001_assessment_core.sql",
  "0002_curriculum_growth.sql",
  "0003_ai_assessment_suggestions.sql",
  "0004_assessment_growth_bridge.sql",
  "0005_school_curriculum_plans.sql",
  "0006_teacher_classes_and_distributions.sql",
  "0008_multimodal_evidence.sql",
];
const schema = (await Promise.all(migrationNames.map(name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8")))).join("\n");
const adapter = (db: PGlite): Query => async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;
const owner = () => `teacher-${crypto.randomUUID()}`;
const definition = (grade = 6): AssessmentDefinition => ({
  title: "민주주의 개념 평가",
  subject: `${grade}학년 사회`,
  learningGoal: "민주주의의 의미를 구체적인 근거와 함께 설명한다.",
  type: "독립 수행평가",
  standardCodes: ["6사01-01"],
  questions: [{ id: "q1", prompt: "민주주의의 의미를 근거와 함께 설명하세요.", kind: "서술형", standardCode: "6사01-01", criterion: "개념과 근거", points: 20 }],
  methods: ["text"],
  rubric: [{ name: "개념과 근거", high: "민주주의의 의미를 구체적인 근거와 연결하여 정확히 설명한다.", middle: "민주주의의 의미를 설명하고 근거를 일부 제시한다.", low: "민주주의와 관련된 낱말을 제시하지만 의미와 근거의 연결은 아직 드러나지 않는다." }],
  grading: { upperThreshold: 80, middleThreshold: 50 },
});

let pg: PGlite;
let assessments: ReturnType<typeof createAssessmentRepository>;
let classrooms: ReturnType<typeof createClassroomRepository>;
let growth: ReturnType<typeof createGrowthRepository>;

before(async () => {
  pg = await PGlite.create();
  await pg.exec(schema);
  const query = adapter(pg);
  assessments = createAssessmentRepository(query);
  classrooms = createClassroomRepository(query);
  growth = createGrowthRepository(query);
});
after(async () => { await pg.close(); });

test("교사별 학급과 공용 학생 명부를 분리하고 중복을 차단", async () => {
  const teacher = owner();
  const classroom = await classrooms.createClass(teacher, { schoolYear: 2026, grade: 6, name: "1반" });
  assert.equal(classroom.studentCount, 0);
  assert.equal((await classrooms.listClasses(teacher)).length, 1);
  assert.equal((await classrooms.listClasses(owner())).length, 0);
  await assert.rejects(classrooms.getOwnedClassroom(classroom.id, owner()), status(404));
  await assert.rejects(classrooms.createClass(teacher, { schoolYear: 2026, grade: 6, name: "1반" }), status(409));

  const inserted = await classrooms.addStudents(classroom.id, teacher, {
    students: [
      { studentRef: "01", displayName: "1번 학생" },
      { studentRef: "02", displayName: "2번 학생" },
    ],
  });
  assert.equal(inserted.length, 2);
  await assert.rejects(classrooms.addStudents(classroom.id, teacher, {
    students: [{ studentRef: "01", displayName: "중복 학생" }],
  }), status(409));
  await assert.rejects(classrooms.addStudents(classroom.id, owner(), {
    students: [{ studentRef: "03", displayName: "다른 교사 학생" }],
  }), status(409));
  const updated = await classrooms.updateStudent(classroom.id, inserted[1].id, teacher, {
    studentRef: "02", displayName: "수정된 2번", active: false,
  });
  assert.equal(updated.active, false);
  assert.equal((await classrooms.getClassroom(classroom.id, teacher)).classroom.studentCount, 1);
});

test("기존 학급으로 학기 교육과정을 만들면 활성 명렬을 자동 연결", async () => {
  const teacher = owner();
  const classroom = await classrooms.createClass(teacher, { schoolYear: 2026, grade: 5, name: "1반" });
  await classrooms.addStudents(classroom.id, teacher, { students: [
    { studentRef: "01", displayName: "햇살" },
    { studentRef: "02", displayName: "초록" },
  ] });
  const term = await growth.createTerm(teacher, {
    classId: classroom.id,
    schoolYear: 2026,
    semester: 1,
    grade: 5,
    className: "1반",
    subject: "국어",
  });
  assert.equal(term.classId, classroom.id);
  assert.equal(term.studentCount, 2);
  const detail = await classrooms.getClassroom(classroom.id, teacher);
  assert.equal(detail.terms.length, 1);
  assert.equal((await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM curriculum_students WHERE term_id = $1 AND class_student_id IS NOT NULL", [term.id])).rows[0].count, 2);
  await assert.rejects(growth.createTerm(teacher, {
    classId: classroom.id,
    schoolYear: 2026,
    semester: 2,
    grade: 6,
    className: "1반",
    subject: "국어",
  }), status(409));
});

test("공개 평가를 학급별 고유 링크로 배포하고 등록 학생만 한 번 참여", async () => {
  const teacher = owner();
  const classroom = await classrooms.createClass(teacher, { schoolYear: 2026, grade: 6, name: "2반" });
  await classrooms.addStudents(classroom.id, teacher, { students: [
    { studentRef: "01", displayName: "1번 학생" },
    { studentRef: "02", displayName: "2번 학생" },
  ] });
  const assessment = await assessments.create(teacher, definition());
  await assessments.setStatus(assessment.id, teacher, "published");
  const distribution = await classrooms.createDistribution(teacher, {
    assessmentId: assessment.id,
    classId: classroom.id,
    instructions: "차분히 읽고 근거를 써 주세요.",
    closesAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  assert.notEqual(distribution.shareCode, assessment.shareCode);
  assert.equal(distribution.totalStudents, 2);
  const publicAssessment = await assessments.getByCode(distribution.shareCode);
  assert.equal(publicAssessment.distribution?.className, "2반");
  assert.equal(publicAssessment.distribution?.instructions, "차분히 읽고 근거를 써 주세요.");

  await assert.rejects(assessments.startAttempt(distribution.shareCode, "99"), status(409));
  const { token, attempt } = await assessments.startAttempt(distribution.shareCode, "01");
  assert.equal(attempt.studentLabel, "1번 학생");
  assert.equal(attempt.distributionId, distribution.id);
  assert.ok(attempt.classStudentId);
  await assert.rejects(assessments.startAttempt(distribution.shareCode, "01"), status(409));
  await assessments.saveAttempt(distribution.shareCode, token, {
    answers: { q1: "시민이 함께 결정에 참여하는 제도입니다." },
    revision: 0,
    timeSpentSeconds: 42,
    submit: true,
  });
  const refreshed = await classrooms.getDistribution(distribution.id, teacher);
  assert.equal(refreshed.startedCount, 1);
  assert.equal(refreshed.submittedCount, 1);
  assert.equal(refreshed.pendingReviewCount, 1);
  await classrooms.closeDistribution(distribution.id, teacher);
  await assert.rejects(assessments.startAttempt(distribution.shareCode, "02"), status(409));
  assert.equal((await assessments.getByCode(distribution.shareCode)).status, "closed");
});

test("단원 평가의 학급 배포는 명부를 성장 증거 학생과 자동 연결", async () => {
  const teacher = owner();
  const classroom = await classrooms.createClass(teacher, { schoolYear: 2026, grade: 6, name: "3반" });
  await classrooms.addStudents(classroom.id, teacher, { students: [{ studentRef: "01", displayName: "1번 학생" }] });
  const term = await growth.createTerm(teacher, { schoolYear: 2026, semester: 1, grade: 6, className: "3반", subject: "사회" });
  const unit = await growth.createUnit(term.id, teacher, { orderIndex: 1, title: "민주주의와 시민 참여", standardCodes: ["6사01-01"] });
  const standard = unit.standards[0];
  const rubric = await growth.createRubric(standard.id, teacher, { criteria: [{
    key: "concept", name: "개념과 근거", description: "민주주의 개념과 근거의 연결을 확인한다.",
    high: "민주주의의 의미를 구체적인 근거와 연결하여 정확히 설명한다.",
    middle: "민주주의의 의미를 설명하고 근거를 일부 제시한다.",
    low: "관련 낱말을 제시하지만 의미와 근거의 연결은 아직 드러나지 않는다.",
  }] });
  await growth.lockRubric(rubric.id, teacher);
  const assessment = await assessments.create(teacher, {
    definition: {
      ...definition(),
      rubric: [{ ...definition().rubric[0], standardCode: "6사01-01", rubricCriterionId: rubric.criteria[0].id }],
      questions: [{ ...definition().questions[0], rubricCriterionId: rubric.criteria[0].id }],
    },
    curriculumLink: {
      unitId: unit.id,
      eventType: "initial",
      context: "단원 학습 후 독립적으로 개념과 근거를 설명하는 평가",
      occurredAt: new Date().toISOString(),
    },
  });
  await assessments.setStatus(assessment.id, teacher, "published");
  const distribution = await classrooms.createDistribution(teacher, { assessmentId: assessment.id, classId: classroom.id });
  const linked = (await pg.query<{ class_id: string }>("SELECT class_id FROM curriculum_terms WHERE id = $1", [term.id])).rows[0];
  assert.equal(linked.class_id, classroom.id);
  assert.equal((await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM curriculum_students WHERE term_id = $1", [term.id])).rows[0].count, 1);

  const { token, attempt } = await assessments.startAttempt(distribution.shareCode, "01");
  assert.ok(attempt.curriculumStudentId);
  await assessments.saveAttempt(distribution.shareCode, token, {
    answers: { q1: "시민이 주권자로서 공동의 문제를 함께 결정하는 원리입니다." },
    revision: 0,
    timeSpentSeconds: 55,
    submit: true,
  });
  assert.equal((await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM learning_evidence WHERE attempt_id = $1", [attempt.id])).rows[0].count, 1);
});
