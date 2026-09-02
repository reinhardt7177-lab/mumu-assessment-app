import { randomBytes, randomUUID } from "node:crypto";
import { AppError, type AssessmentDefinition } from "../lib/assessment-domain";
import {
  validateClassroom,
  validateClassRoster,
  validateClassStudentUpdate,
  validateDistribution,
} from "../lib/classroom-domain";
import type { Query } from "./repository";

const timestamp = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const nullableTimestamp = (value: unknown) => value ? timestamp(value) : null;
const number = (value: unknown) => Number(value ?? 0);

export type ClassroomRecord = {
  id: string;
  ownerId: string;
  schoolId: string | null;
  schoolName: string | null;
  schoolYear: number;
  grade: number;
  name: string;
  status: "active" | "archived";
  studentCount: number;
  termCount: number;
  openDistributionCount: number;
  createdAt: string;
};

export type ClassStudentRecord = {
  id: string;
  classId: string;
  studentRef: string;
  displayName: string;
  active: boolean;
  createdAt: string;
};

export type DistributionRecord = {
  id: string;
  assessmentId: string;
  classId: string;
  className: string;
  schoolYear: number;
  grade: number;
  shareCode: string;
  status: "open" | "closed";
  instructions: string;
  closesAt: string | null;
  assessmentTitle: string;
  subject: string;
  questionCount: number;
  totalStudents: number;
  startedCount: number;
  submittedCount: number;
  pendingReviewCount: number;
  createdAt: string;
};

export type ClassroomDetailRecord = {
  classroom: ClassroomRecord;
  students: ClassStudentRecord[];
  terms: Array<{
    id: string;
    semester: 1 | 2;
    subject: string;
    status: "planning" | "active" | "closed";
    unitCount: number;
    evidenceCount: number;
  }>;
  distributions: DistributionRecord[];
};

const classroomColumns = `c.id, c.owner_id AS "ownerId", c.school_id AS "schoolId", school.name AS "schoolName",
  c.school_year AS "schoolYear", c.grade, c.name, c.status, c.created_at AS "createdAt"`;
const distributionColumns = `d.id, d.assessment_id AS "assessmentId", d.class_id AS "classId",
  c.name AS "className", c.school_year AS "schoolYear", c.grade, d.share_code AS "shareCode",
  CASE WHEN d.status = 'open' AND d.closes_at IS NOT NULL AND d.closes_at <= now() THEN 'closed' ELSE d.status END AS status,
  d.instructions, d.closes_at AS "closesAt", a.definition->>'title' AS "assessmentTitle",
  a.definition->>'subject' AS subject, jsonb_array_length(a.definition->'questions')::int AS "questionCount",
  (SELECT count(*)::int FROM class_students roster WHERE roster.class_id = c.id AND roster.active) AS "totalStudents",
  (SELECT count(*)::int FROM student_attempts attempt WHERE attempt.distribution_id = d.id) AS "startedCount",
  (SELECT count(*)::int FROM student_attempts attempt WHERE attempt.distribution_id = d.id AND attempt.status = 'submitted') AS "submittedCount",
  (SELECT count(*)::int FROM student_attempts attempt LEFT JOIN teacher_reviews review ON review.attempt_id = attempt.id
    WHERE attempt.distribution_id = d.id AND attempt.status = 'submitted' AND (review.state IS NULL OR review.state = 'draft')) AS "pendingReviewCount",
  d.created_at AS "createdAt"`;

const classroomRecord = (row: Record<string, unknown>) => ({
  ...row,
  schoolYear: number(row.schoolYear),
  grade: number(row.grade),
  studentCount: number(row.studentCount),
  termCount: number(row.termCount),
  openDistributionCount: number(row.openDistributionCount),
  createdAt: timestamp(row.createdAt),
}) as ClassroomRecord;

const studentRecord = (row: Record<string, unknown>) => ({
  ...row,
  createdAt: timestamp(row.createdAt),
}) as ClassStudentRecord;

const distributionRecord = (row: Record<string, unknown>) => ({
  ...row,
  schoolYear: number(row.schoolYear),
  grade: number(row.grade),
  questionCount: number(row.questionCount),
  totalStudents: number(row.totalStudents),
  startedCount: number(row.startedCount),
  submittedCount: number(row.submittedCount),
  pendingReviewCount: number(row.pendingReviewCount),
  closesAt: nullableTimestamp(row.closesAt),
  createdAt: timestamp(row.createdAt),
}) as DistributionRecord;

export function createClassroomRepository(query: Query) {
  async function getOwnedClassroom(id: string, ownerId: string) {
    const rows = await query(`SELECT ${classroomColumns},
      (SELECT count(*)::int FROM class_students student WHERE student.class_id = c.id AND student.active) AS "studentCount",
      (SELECT count(*)::int FROM curriculum_terms term WHERE term.class_id = c.id) AS "termCount",
      (SELECT count(*)::int FROM assessment_distributions distribution
        WHERE distribution.class_id = c.id AND distribution.status = 'open'
          AND (distribution.closes_at IS NULL OR distribution.closes_at > now())) AS "openDistributionCount"
      FROM teacher_classes c LEFT JOIN schools school ON school.id = c.school_id
      WHERE c.id = $1 AND c.owner_id = $2`, [id, ownerId]);
    if (!rows[0]) throw new AppError(404, "학급을 찾을 수 없거나 접근 권한이 없습니다.");
    return classroomRecord(rows[0]);
  }

  async function listDistributions(ownerId: string, classId?: string) {
    const rows = await query(`SELECT ${distributionColumns}
      FROM assessment_distributions d
      JOIN teacher_classes c ON c.id = d.class_id
      JOIN assessments a ON a.id = d.assessment_id
      WHERE c.owner_id = $1 AND ($2::uuid IS NULL OR c.id = $2)
      ORDER BY (CASE WHEN d.status = 'open' AND (d.closes_at IS NULL OR d.closes_at > now()) THEN 0 ELSE 1 END), d.created_at DESC
      LIMIT 200`, [ownerId, classId ?? null]);
    return rows.map(distributionRecord);
  }

  async function getDistribution(id: string, ownerId: string) {
    const rows = await query(`SELECT ${distributionColumns}
      FROM assessment_distributions d
      JOIN teacher_classes c ON c.id = d.class_id
      JOIN assessments a ON a.id = d.assessment_id
      WHERE d.id = $1 AND c.owner_id = $2`, [id, ownerId]);
    if (!rows[0]) throw new AppError(404, "학급 배포 기록을 찾을 수 없거나 접근 권한이 없습니다.");
    return distributionRecord(rows[0]);
  }

  return {
    getOwnedClassroom,
    listDistributions,
    getDistribution,

    async listClasses(ownerId: string) {
      const rows = await query(`SELECT ${classroomColumns},
        count(DISTINCT student.id)::int AS "studentCount",
        count(DISTINCT term.id)::int AS "termCount",
        count(DISTINCT distribution.id) FILTER (
          WHERE distribution.status = 'open' AND (distribution.closes_at IS NULL OR distribution.closes_at > now())
        )::int AS "openDistributionCount"
        FROM teacher_classes c
        LEFT JOIN schools school ON school.id = c.school_id
        LEFT JOIN class_students student ON student.class_id = c.id AND student.active
        LEFT JOIN curriculum_terms term ON term.class_id = c.id
        LEFT JOIN assessment_distributions distribution ON distribution.class_id = c.id
        WHERE c.owner_id = $1
        GROUP BY c.id, school.name
        ORDER BY c.school_year DESC, c.grade, c.name`, [ownerId]);
      return rows.map(classroomRecord);
    },

    async createClass(ownerId: string, input: unknown) {
      if (!ownerId) throw new AppError(401, "교사 로그인이 필요합니다.");
      const value = validateClassroom(input);
      const rows = await query(`WITH inserted AS (
        INSERT INTO teacher_classes (id, owner_id, school_id, school_year, grade, name)
        SELECT $1, $2, $3::uuid, $4, $5, $6
        WHERE $3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM school_members member
          WHERE member.school_id = $3 AND member.teacher_id = $2 AND member.role IN ('admin', 'editor')
        )
        ON CONFLICT (owner_id, school_year, grade, name) DO NOTHING
        RETURNING *
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $7, $2, $2, 'class.created', 'teacher_class', id,
          jsonb_build_object('schoolYear', school_year, 'grade', grade, 'name', name)
        FROM inserted
      )
      SELECT i.id, i.owner_id AS "ownerId", i.school_id AS "schoolId", school.name AS "schoolName",
        i.school_year AS "schoolYear", i.grade, i.name, i.status, i.created_at AS "createdAt",
        0::int AS "studentCount", 0::int AS "termCount", 0::int AS "openDistributionCount"
      FROM inserted i LEFT JOIN schools school ON school.id = i.school_id`,
      [randomUUID(), ownerId, value.schoolId ?? null, value.schoolYear, value.grade, value.name, randomUUID()]);
      if (!rows[0]) throw new AppError(409, "같은 학년도·학년·학급이 이미 있거나 학교 편집 권한이 없습니다.");
      return classroomRecord(rows[0]);
    },

    async addStudents(classId: string, ownerId: string, input: unknown) {
      const value = validateClassRoster(input);
      const students = value.students.map(student => ({ id: randomUUID(), student_ref: student.studentRef, display_name: student.displayName }));
      const rows = await query(`WITH authorized AS (
        SELECT id FROM teacher_classes WHERE id = $1 AND owner_id = $2 AND status = 'active'
      ), incoming AS (
        SELECT * FROM jsonb_to_recordset($3::jsonb) AS item(id uuid, student_ref text, display_name text)
      ), inserted AS (
        INSERT INTO class_students (id, class_id, student_ref, display_name)
        SELECT incoming.id, authorized.id, incoming.student_ref, incoming.display_name
        FROM authorized CROSS JOIN incoming
        WHERE NOT EXISTS (
          SELECT 1 FROM class_students existing
          WHERE existing.class_id = authorized.id AND existing.student_ref IN (SELECT student_ref FROM incoming)
        )
        RETURNING *
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $4, $2, $2, 'class.roster_added', 'teacher_class', $1,
          jsonb_build_object('studentCount', count(*)::int)
        FROM inserted HAVING count(*) > 0
      )
      SELECT id, class_id AS "classId", student_ref AS "studentRef", display_name AS "displayName", active, created_at AS "createdAt"
      FROM inserted ORDER BY student_ref`, [classId, ownerId, JSON.stringify(students), randomUUID()]);
      if (rows.length !== students.length) throw new AppError(409, "등록되지 않았습니다. 학급 권한과 중복된 학생 참조 번호를 확인해 주세요.");
      return rows.map(studentRecord);
    },

    async updateStudent(classId: string, studentId: string, ownerId: string, input: unknown) {
      const value = validateClassStudentUpdate(input);
      const rows = await query(`WITH updated AS (
        UPDATE class_students student
        SET student_ref = $4, display_name = $5, active = $6, updated_at = now()
        FROM teacher_classes classroom
        WHERE student.id = $2 AND student.class_id = $1
          AND classroom.id = student.class_id AND classroom.owner_id = $3
        RETURNING student.*
      ), synced AS (
        UPDATE curriculum_students curriculum
        SET student_ref = updated.student_ref, display_name = updated.display_name, active = updated.active
        FROM updated WHERE curriculum.class_student_id = updated.id
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $7, $3, $3, 'class.student_updated', 'class_student', id,
          jsonb_build_object('active', active) FROM updated
      )
      SELECT id, class_id AS "classId", student_ref AS "studentRef", display_name AS "displayName", active, created_at AS "createdAt"
      FROM updated`, [classId, studentId, ownerId, value.studentRef, value.displayName, value.active, randomUUID()]);
      if (!rows[0]) throw new AppError(404, "학생을 찾을 수 없거나 학급 접근 권한이 없습니다.");
      return studentRecord(rows[0]);
    },

    async getClassroom(id: string, ownerId: string): Promise<ClassroomDetailRecord> {
      const classroom = await getOwnedClassroom(id, ownerId);
      const [students, terms, distributions] = await Promise.all([
        query(`SELECT id, class_id AS "classId", student_ref AS "studentRef", display_name AS "displayName", active, created_at AS "createdAt"
          FROM class_students WHERE class_id = $1 ORDER BY active DESC, student_ref`, [id]),
        query(`SELECT term.id, term.semester, term.subject, term.status,
            count(DISTINCT unit.id)::int AS "unitCount", count(DISTINCT evidence.id)::int AS "evidenceCount"
          FROM curriculum_terms term
          LEFT JOIN curriculum_units unit ON unit.term_id = term.id
          LEFT JOIN curriculum_students student ON student.term_id = term.id
          LEFT JOIN learning_evidence evidence ON evidence.student_id = student.id
          WHERE term.class_id = $1 AND term.owner_id = $2
          GROUP BY term.id ORDER BY term.semester, term.subject`, [id, ownerId]),
        listDistributions(ownerId, id),
      ]);
      return {
        classroom,
        students: students.map(studentRecord),
        terms: terms.map(row => ({
          id: String(row.id),
          semester: number(row.semester) as 1 | 2,
          subject: String(row.subject),
          status: row.status as "planning" | "active" | "closed",
          unitCount: number(row.unitCount),
          evidenceCount: number(row.evidenceCount),
        })),
        distributions,
      };
    },

    async createDistribution(ownerId: string, input: unknown) {
      const value = validateDistribution(input);
      if (value.closesAt && new Date(value.closesAt).getTime() <= Date.now()) throw new AppError(400, "마감 시각은 현재 이후로 설정해 주세요.");
      const targetRows = await query<{
        assessmentId: string;
        definition: AssessmentDefinition;
        classId: string;
        termId: string | null;
      }>(`SELECT a.id AS "assessmentId", a.definition, c.id AS "classId", term.id AS "termId"
        FROM assessments a
        JOIN teacher_classes c ON c.id = $2 AND c.owner_id = $1 AND c.status = 'active'
        LEFT JOIN assessment_events event ON event.assessment_id = a.id
        LEFT JOIN curriculum_units unit ON unit.id = event.unit_id
        LEFT JOIN curriculum_terms term ON term.id = unit.term_id
        WHERE a.id = $3 AND a.owner_id = $1 AND a.status = 'published'
          AND split_part(a.definition->>'subject', '학년', 1)::int = c.grade
          AND (
            term.id IS NULL OR (
              term.owner_id = $1 AND term.school_year = c.school_year AND term.grade = c.grade
              AND term.class_name = c.name AND (term.class_id IS NULL OR term.class_id = c.id)
            )
          )`, [ownerId, value.classId, value.assessmentId]);
      const target = targetRows[0];
      if (!target) throw new AppError(409, "공개된 평가의 학년과 대상 학급 또는 연결된 교육과정을 확인해 주세요.");
      const roster = await query<{ id: string; studentRef: string; displayName: string }>(
        `SELECT id, student_ref AS "studentRef", display_name AS "displayName"
        FROM class_students WHERE class_id = $1 AND active ORDER BY student_ref`, [value.classId]);
      if (!roster.length) throw new AppError(409, "학생 명부를 한 명 이상 등록한 뒤 평가를 배포해 주세요.");
      const curriculumStudents = roster.map(student => ({
        id: randomUUID(),
        class_student_id: student.id,
        student_ref: student.studentRef,
        display_name: student.displayName,
      }));
      const distributionId = randomUUID();
      const shareCode = randomBytes(8).toString("hex").toUpperCase();
      const rows = await query(`WITH target AS (
        SELECT a.id AS assessment_id, c.id AS class_id, term.id AS term_id
        FROM assessments a
        JOIN teacher_classes c ON c.id = $2 AND c.owner_id = $1 AND c.status = 'active'
        LEFT JOIN assessment_events event ON event.assessment_id = a.id
        LEFT JOIN curriculum_units unit ON unit.id = event.unit_id
        LEFT JOIN curriculum_terms term ON term.id = unit.term_id
        WHERE a.id = $3 AND a.owner_id = $1 AND a.status = 'published'
          AND split_part(a.definition->>'subject', '학년', 1)::int = c.grade
          AND (term.id IS NULL OR (term.owner_id = $1 AND term.school_year = c.school_year
            AND term.grade = c.grade AND term.class_name = c.name AND (term.class_id IS NULL OR term.class_id = c.id)))
      ), inserted AS (
        INSERT INTO assessment_distributions (id, assessment_id, class_id, share_code, instructions, closes_at, created_by)
        SELECT $4, assessment_id, class_id, $5, $6, $7::timestamptz, $1 FROM target
        WHERE NOT EXISTS (SELECT 1 FROM assessments existing WHERE existing.share_code = $5)
        ON CONFLICT DO NOTHING
        RETURNING *
      ), linked_term AS (
        UPDATE curriculum_terms term SET class_id = target.class_id, updated_at = now()
        FROM target CROSS JOIN inserted
        WHERE target.term_id = term.id AND (term.class_id IS NULL OR term.class_id = target.class_id)
      ), student_data AS (
        SELECT * FROM jsonb_to_recordset($8::jsonb)
          AS item(id uuid, class_student_id uuid, student_ref text, display_name text)
      ), synced_students AS (
        INSERT INTO curriculum_students (id, term_id, class_student_id, student_ref, display_name)
        SELECT data.id, target.term_id, data.class_student_id, data.student_ref, data.display_name
        FROM target CROSS JOIN inserted CROSS JOIN student_data data
        WHERE target.term_id IS NOT NULL
        ON CONFLICT DO NOTHING
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $9, $1, $1, 'assessment.distributed', 'assessment_distribution', id,
          jsonb_build_object('assessmentId', assessment_id, 'classId', class_id, 'studentCount', $10::int)
        FROM inserted
      ) SELECT id FROM inserted`, [
        ownerId, value.classId, value.assessmentId, distributionId, shareCode,
        value.instructions, value.closesAt ?? null, JSON.stringify(curriculumStudents), randomUUID(), roster.length,
      ]);
      if (!rows[0]) throw new AppError(409, "이 평가는 이미 해당 학급에 배포되었거나 배포 조건이 변경되었습니다.");
      return getDistribution(distributionId, ownerId);
    },

    async closeDistribution(id: string, ownerId: string) {
      const rows = await query(`WITH closed AS (
        UPDATE assessment_distributions distribution
        SET status = 'closed', closed_at = now()
        FROM teacher_classes classroom
        WHERE distribution.id = $1 AND distribution.class_id = classroom.id
          AND classroom.owner_id = $2 AND distribution.status = 'open'
        RETURNING distribution.id
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $3, $2, $2, 'assessment.distribution_closed', 'assessment_distribution', id, '{}'::jsonb
        FROM closed
      ) SELECT id FROM closed`, [id, ownerId, randomUUID()]);
      if (!rows[0]) {
        const current = await getDistribution(id, ownerId);
        if (current.status === "closed") return current;
        throw new AppError(409, "배포 상태가 변경되었습니다. 새로고침해 주세요.");
      }
      return getDistribution(id, ownerId);
    },
  };
}
