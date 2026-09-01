import { randomUUID } from "node:crypto";
import { AppError } from "../lib/assessment-domain";
import {
  aiSuggestionCompletionSchema,
  aiSuggestionFailureSchema,
  assessmentEventInputSchema,
  evidenceInputSchema,
  feedbackInputSchema,
  interventionInputSchema,
  judgementInputSchema,
  parseInput,
  reassessmentInputSchema,
  semesterJudgementInputSchema,
  studentInputSchema,
  validateRubric,
  validateTerm,
  validateUnit,
} from "../lib/growth-domain";
import type { TermInput } from "../lib/growth-domain";
import type { Query } from "./repository";

const timestamp = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const number = (value: unknown) => Number(value ?? 0);

export type CurriculumTermRecord = {
  id: string;
  ownerId: string;
  schoolYear: number;
  semester: 1 | 2;
  grade: number;
  className: string;
  subject: TermInput["subject"];
  status: "planning" | "active" | "closed";
  createdAt: string;
  unitCount: number;
  studentCount: number;
  evidenceCount: number;
};

export type UnitStandardRecord = {
  id: string;
  code: string;
  content: string;
  domain: string;
  position: number;
};

export type CurriculumUnitRecord = {
  id: string;
  termId: string;
  orderIndex: number;
  title: string;
  status: "planned" | "teaching" | "assessing" | "feedback" | "completed";
  createdAt: string;
  standards: UnitStandardRecord[];
};

export type CurriculumStudentRecord = {
  id: string;
  termId: string;
  studentRef: string;
  displayName: string;
  active: boolean;
  createdAt: string;
};

export type AssessmentEventRecord = {
  id: string;
  unitId: string;
  assessmentId: string | null;
  eventType: "initial" | "formative" | "reassessment" | "observation" | "conversation";
  title: string;
  context: string;
  occurredAt: string;
  createdAt: string;
};

export type EvidenceRecord = {
  id: string;
  studentId: string;
  eventId: string;
  attemptId: string | null;
  modality: "text" | "photo" | "speech" | "observation" | "chat";
  sourceKind: string;
  assistanceLevel: "independent" | "teacher_prompt" | "step_hint" | "example" | "scaffolded";
  originalText: string | null;
  sourceRef: string | null;
  transformedText: string | null;
  transformationStatus: "original" | "automated" | "teacher_verified";
  teacherVerified: boolean;
  collectedAt: string;
  createdAt: string;
  supersedesId: string | null;
};

export type RubricCriterionRecord = {
  id: string;
  key: string;
  name: string;
  description: string;
  high: string;
  middle: string;
  low: string;
  position: number;
};

export type RubricRecord = {
  id: string;
  unitStandardId: string;
  version: number;
  state: "draft" | "locked" | "retired";
  createdAt: string;
  criteria: RubricCriterionRecord[];
};

export type CriterionJudgementRecord = {
  id: string;
  evidenceId: string;
  rubricCriterionId: string;
  level: "상" | "중" | "하" | "판단 보류";
  evidenceExcerpt: string;
  rationale: string;
  state: "draft" | "final";
  revision: number;
  supersedesId: string | null;
  createdAt: string;
};

export type AiGenerationRunRecord = {
  id: string;
  evidenceId: string;
  rubricCriterionId: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  status: "pending" | "complete" | "error";
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type AiCriterionSuggestionRecord = {
  id: string;
  generationRunId: string;
  evidenceId: string;
  rubricCriterionId: string;
  criterionName: string;
  unitStandardId: string;
  standardCode: string;
  model: string;
  promptVersion: string;
  suggestedLevel: "상" | "중" | "하" | "판단 보류";
  confidence: number;
  evidenceExcerpt: string;
  rationale: string;
  uncertainty: string;
  missingEvidence: string;
  constructCaution: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
};

export type AiSuggestionContext = {
  evidenceId: string;
  rubricCriterionId: string;
  studentId: string;
  grade: number;
  subject: string;
  unitId: string;
  unitTitle: string;
  standardCode: string;
  standardContent: string;
  eventTitle: string;
  eventContext: string;
  eventType: AssessmentEventRecord["eventType"];
  modality: EvidenceRecord["modality"];
  assistanceLevel: EvidenceRecord["assistanceLevel"];
  evidenceText: string;
  teacherVerified: boolean;
  criterionName: string;
  criterionDescription: string;
  high: string;
  middle: string;
  low: string;
};

export type FeedbackRecord = {
  id: string;
  studentId: string;
  unitStandardId: string;
  strength: string;
  gapType: "conceptual" | "procedural" | "communication";
  gapDescription: string;
  nextLearning: string;
  status: "planned" | "in_progress" | "ready_for_reassessment" | "completed";
  createdAt: string;
};

export type InterventionRecord = {
  id: string;
  cycleId: string;
  activity: string;
  supportLevel: "teacher_prompt" | "step_hint" | "example" | "scaffolded";
  teacherNote: string;
  occurredAt: string;
  createdAt: string;
};

export type ReassessmentRecord = {
  id: string;
  cycleId: string;
  priorEvidenceId: string;
  newEvidenceId: string;
  independent: boolean;
  createdAt: string;
};

export type SemesterJudgementRecord = {
  id: string;
  termId: string;
  studentId: string;
  standardCode: string;
  level: "상" | "중" | "하" | "판단 보류";
  rationale: string;
  state: "draft" | "final";
  revision: number;
  supersedesId: string | null;
  createdAt: string;
  evidence: { id: string; role: "supporting" | "conflicting" }[];
};

export type CurriculumDashboardRecord = {
  term: CurriculumTermRecord;
  units: Array<{
    id: string;
    orderIndex: number;
    title: string;
    status: CurriculumUnitRecord["status"];
    standards: Array<UnitStandardRecord & {
      rubric: null | { id: string; version: number; state: RubricRecord["state"]; criterionCount: number };
    }>;
  }>;
  students: Array<{
    id: string;
    studentRef: string;
    displayName: string;
    active: boolean;
    evidenceCount: number;
    openFeedbackCount: number;
    independentGrowthCount: number;
  }>;
  activity: {
    evidenceCount: number;
    openFeedbackCount: number;
    independentGrowthCount: number;
    finalStandardCount: number;
  };
};

export type WorkflowRubricRecord = RubricRecord & {
  unitId: string;
  unitTitle: string;
  standardCode: string;
  standardContent: string;
};

export type WorkflowEvidenceRecord = EvidenceRecord & {
  studentName: string;
  unitId: string;
  unitTitle: string;
  eventTitle: string;
  eventContext: string;
  eventType: AssessmentEventRecord["eventType"];
  judgements: Array<CriterionJudgementRecord & {
    criterionName: string;
    unitStandardId: string;
    standardCode: string;
  }>;
  aiSuggestions: AiCriterionSuggestionRecord[];
};

export type WorkflowFeedbackRecord = FeedbackRecord & {
  studentName: string;
  unitId: string;
  unitTitle: string;
  standardCode: string;
  standardContent: string;
  basisJudgementIds: string[];
  interventions: InterventionRecord[];
  reassessments: ReassessmentRecord[];
};

export type CurriculumWorkflowRecord = {
  events: Array<AssessmentEventRecord & { unitTitle: string }>;
  rubrics: WorkflowRubricRecord[];
  evidence: WorkflowEvidenceRecord[];
  feedback: WorkflowFeedbackRecord[];
  semesterJudgements: Array<SemesterJudgementRecord & { studentName: string }>;
};

const termColumns = `t.id, t.owner_id AS "ownerId", t.school_year AS "schoolYear", t.semester, t.grade, t.class_name AS "className", t.subject, t.status, t.created_at AS "createdAt"`;
const termRecord = (row: Record<string, unknown>) => ({
  ...row,
  schoolYear: number(row.schoolYear),
  semester: number(row.semester),
  grade: number(row.grade),
  unitCount: number(row.unitCount),
  studentCount: number(row.studentCount),
  evidenceCount: number(row.evidenceCount),
  createdAt: timestamp(row.createdAt),
}) as CurriculumTermRecord;

const nullableNumber = (value: unknown) => value === null || value === undefined ? null : number(value);
const aiSuggestionRecord = (row: Record<string, unknown>) => ({
  ...row,
  confidence: number(row.confidence),
  inputTokens: nullableNumber(row.inputTokens),
  outputTokens: nullableNumber(row.outputTokens),
  totalTokens: nullableNumber(row.totalTokens),
  latencyMs: nullableNumber(row.latencyMs),
  createdAt: timestamp(row.createdAt),
}) as AiCriterionSuggestionRecord;

export function createGrowthRepository(query: Query) {
  async function getOwnedTerm(id: string, ownerId: string) {
    const rows = await query(`SELECT ${termColumns} FROM curriculum_terms t WHERE t.id = $1 AND t.owner_id = $2`, [id, ownerId]);
    if (!rows[0]) throw new AppError(404, "학기 교육과정을 찾을 수 없거나 접근 권한이 없습니다.");
    return termRecord(rows[0]);
  }

  return {
    getOwnedTerm,

    async listTerms(ownerId: string) {
      const rows = await query(`SELECT ${termColumns},
        count(DISTINCT u.id)::int AS "unitCount",
        count(DISTINCT s.id)::int AS "studentCount",
        count(DISTINCT e.id)::int AS "evidenceCount"
        FROM curriculum_terms t
        LEFT JOIN curriculum_units u ON u.term_id = t.id
        LEFT JOIN curriculum_students s ON s.term_id = t.id AND s.active
        LEFT JOIN learning_evidence e ON e.student_id = s.id
        WHERE t.owner_id = $1
        GROUP BY t.id
        ORDER BY t.school_year DESC, t.semester DESC, t.grade, t.class_name, t.subject`, [ownerId]);
      return rows.map(termRecord);
    },

    async createTerm(ownerId: string, input: unknown) {
      if (!ownerId) throw new AppError(401, "교사 로그인이 필요합니다.");
      const value = validateTerm(input);
      const id = randomUUID();
      const rows = await query(`WITH inserted AS (
        INSERT INTO curriculum_terms AS t (id, owner_id, school_year, semester, grade, class_name, subject)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (owner_id, school_year, semester, grade, class_name, subject) DO NOTHING
        RETURNING *
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $8, $2, $2, 'term.created', 'curriculum_term', id, jsonb_build_object('schoolYear', school_year, 'semester', semester, 'grade', grade, 'subject', subject)
        FROM inserted
      )
      SELECT i.id, i.owner_id AS "ownerId", i.school_year AS "schoolYear", i.semester, i.grade, i.class_name AS "className", i.subject, i.status, i.created_at AS "createdAt"
      FROM inserted i`, [id, ownerId, value.schoolYear, value.semester, value.grade, value.className, value.subject, randomUUID()]);
      if (!rows[0]) throw new AppError(409, "같은 학년도·학기·학급·교과의 교육과정이 이미 있습니다.");
      return termRecord(rows[0]);
    },

    async createUnit(termId: string, ownerId: string, input: unknown) {
      const term = await getOwnedTerm(termId, ownerId);
      if (term.status === "closed") throw new AppError(409, "마감한 학기에는 단원을 추가할 수 없습니다.");
      const value = validateUnit(input, term);
      const unitId = randomUUID();
      const standards = value.standards.map((standard, index) => ({
        id: randomUUID(),
        standard_code: standard.code,
        standard_content: standard.content,
        domain: standard.domain,
        position: index + 1,
      }));
      const rows = await query(`WITH authorized AS (
        SELECT id FROM curriculum_terms WHERE id = $1 AND owner_id = $2 AND status <> 'closed'
      ), inserted_unit AS (
        INSERT INTO curriculum_units (id, term_id, order_index, title)
        SELECT $3, id, $4, $5 FROM authorized
        ON CONFLICT DO NOTHING
        RETURNING *
      ), standard_data AS (
        SELECT * FROM jsonb_to_recordset($6::jsonb)
          AS item(id uuid, standard_code text, standard_content text, domain text, position smallint)
      ), inserted_standards AS (
        INSERT INTO unit_standards (id, unit_id, standard_code, standard_content, domain, position)
        SELECT d.id, u.id, d.standard_code, d.standard_content, d.domain, d.position
        FROM inserted_unit u CROSS JOIN standard_data d
        RETURNING *
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $7, $2, $2, 'unit.created', 'curriculum_unit', id, jsonb_build_object('title', title, 'standardCount', $8::int)
        FROM inserted_unit
      )
      SELECT u.id, u.term_id AS "termId", u.order_index AS "orderIndex", u.title, u.status, u.created_at AS "createdAt",
        coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'code', s.standard_code, 'content', s.standard_content, 'domain', s.domain, 'position', s.position) ORDER BY s.position)
          FILTER (WHERE s.id IS NOT NULL), '[]') AS standards
      FROM inserted_unit u LEFT JOIN inserted_standards s ON s.unit_id = u.id
      GROUP BY u.id, u.term_id, u.order_index, u.title, u.status, u.created_at`,
      [termId, ownerId, unitId, value.orderIndex, value.title, JSON.stringify(standards), randomUUID(), standards.length]);
      if (!rows[0]) throw new AppError(409, "같은 순서나 이름의 단원이 이미 있거나 학기가 마감되었습니다.");
      return { ...rows[0], orderIndex: number(rows[0].orderIndex), createdAt: timestamp(rows[0].createdAt) } as CurriculumUnitRecord;
    },

    async createStudent(termId: string, ownerId: string, input: unknown) {
      const value = parseInput(studentInputSchema, input, "학생 번호·별칭을 확인해 주세요.");
      const rows = await query(`WITH authorized AS (
        SELECT id FROM curriculum_terms WHERE id = $1 AND owner_id = $2 AND status <> 'closed'
      ), saved AS (
        INSERT INTO curriculum_students AS s (id, term_id, student_ref, display_name)
        SELECT $3, id, $4, $5 FROM authorized
        ON CONFLICT (term_id, student_ref) DO UPDATE
          SET display_name = EXCLUDED.display_name, active = true
        RETURNING s.*
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $6, $2, $2, 'student.saved', 'curriculum_student', id, jsonb_build_object('termId', term_id)
        FROM saved
      )
      SELECT id, term_id AS "termId", student_ref AS "studentRef", display_name AS "displayName", active, created_at AS "createdAt" FROM saved`,
      [termId, ownerId, randomUUID(), value.studentRef, value.displayName, randomUUID()]);
      if (!rows[0]) throw new AppError(409, "마감한 학기에는 학생을 추가할 수 없습니다.");
      return { ...rows[0], createdAt: timestamp(rows[0].createdAt) } as CurriculumStudentRecord;
    },

    async createEvent(unitId: string, ownerId: string, input: unknown) {
      const value = parseInput(assessmentEventInputSchema, input, "평가 시점·맥락을 확인해 주세요.");
      const rows = await query(`WITH authorized AS (
        SELECT u.id FROM curriculum_units u
        JOIN curriculum_terms t ON t.id = u.term_id
        WHERE u.id = $1 AND t.owner_id = $2 AND t.status <> 'closed'
          AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM assessments a WHERE a.id = $3 AND a.owner_id = $2))
      ), inserted AS (
        INSERT INTO assessment_events (id, unit_id, assessment_id, event_type, title, context, occurred_at, created_by)
        SELECT $4, id, $3, $5, $6, $7, $8::timestamptz, $2 FROM authorized
        RETURNING *
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $9, $2, $2, 'assessment_event.created', 'assessment_event', id, jsonb_build_object('eventType', event_type, 'unitId', unit_id)
        FROM inserted
      )
      SELECT id, unit_id AS "unitId", assessment_id AS "assessmentId", event_type AS "eventType", title, context, occurred_at AS "occurredAt", created_at AS "createdAt"
      FROM inserted`, [unitId, ownerId, value.assessmentId ?? null, randomUUID(), value.eventType, value.title, value.context, value.occurredAt, randomUUID()]);
      if (!rows[0]) throw new AppError(404, "단원 또는 연결 평가를 찾을 수 없거나 학기가 마감되었습니다.");
      return { ...rows[0], occurredAt: timestamp(rows[0].occurredAt), createdAt: timestamp(rows[0].createdAt) } as AssessmentEventRecord;
    },

    async createEvidence(ownerId: string, input: unknown) {
      const value = parseInput(evidenceInputSchema, input, "학생 수행 증거의 원본·방식·도움 수준을 확인해 주세요.");
      const rows = await query(`WITH authorized AS (
        SELECT s.id AS student_id, e.id AS event_id
        FROM curriculum_students s
        JOIN curriculum_terms t ON t.id = s.term_id
        JOIN assessment_events e ON e.id = $4
        JOIN curriculum_units u ON u.id = e.unit_id AND u.term_id = t.id
        WHERE s.id = $3 AND t.owner_id = $1 AND t.status <> 'closed'
          AND ($5::uuid IS NULL OR EXISTS (
            SELECT 1 FROM student_attempts a
            JOIN assessments assessment ON assessment.id = a.assessment_id
            WHERE a.id = $5 AND assessment.owner_id = $1
              AND (e.assessment_id IS NULL OR e.assessment_id = assessment.id)
          ))
          AND ($16::uuid IS NULL OR EXISTS (
            SELECT 1 FROM learning_evidence prior
            WHERE prior.id = $16 AND prior.student_id = s.id
          ))
      ), inserted AS (
        INSERT INTO learning_evidence (
          id, student_id, event_id, attempt_id, modality, source_kind, assistance_level,
          original_text, source_ref, transformed_text, transformation_status, teacher_verified,
          collected_at, created_by, supersedes_id
        )
        SELECT $2, student_id, event_id, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz, $1, $16
        FROM authorized
        RETURNING *
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $15, $1, $1, 'evidence.created', 'learning_evidence', id,
          jsonb_build_object('studentId', student_id, 'eventId', event_id, 'modality', modality, 'assistanceLevel', assistance_level)
        FROM inserted
      )
      SELECT id, student_id AS "studentId", event_id AS "eventId", attempt_id AS "attemptId",
        modality, source_kind AS "sourceKind", assistance_level AS "assistanceLevel",
        original_text AS "originalText", source_ref AS "sourceRef", transformed_text AS "transformedText",
        transformation_status AS "transformationStatus", teacher_verified AS "teacherVerified",
        collected_at AS "collectedAt", created_at AS "createdAt", supersedes_id AS "supersedesId"
      FROM inserted`, [
        ownerId, randomUUID(), value.studentId, value.eventId, value.attemptId ?? null,
        value.modality, value.sourceKind, value.assistanceLevel, value.originalText ?? null,
        value.sourceRef ?? null, value.transformedText ?? null, value.transformationStatus,
        value.teacherVerified, value.collectedAt, randomUUID(), value.supersedesId ?? null,
      ]);
      if (!rows[0]) throw new AppError(404, "학생·평가 시점·원본 증거의 연결을 확인해 주세요.");
      return { ...rows[0], collectedAt: timestamp(rows[0].collectedAt), createdAt: timestamp(rows[0].createdAt) } as EvidenceRecord;
    },

    async createRubric(unitStandardId: string, ownerId: string, input: unknown) {
      const value = validateRubric(input);
      const criteria = value.criteria.map((criterion, index) => ({
        id: randomUUID(),
        criterion_key: criterion.key,
        name: criterion.name,
        description: criterion.description,
        high_descriptor: criterion.high,
        middle_descriptor: criterion.middle,
        low_descriptor: criterion.low,
        position: index + 1,
      }));
      const rows = await query(`WITH authorized AS (
        SELECT us.id
        FROM unit_standards us
        JOIN curriculum_units u ON u.id = us.unit_id
        JOIN curriculum_terms t ON t.id = u.term_id
        WHERE us.id = $1 AND t.owner_id = $2 AND t.status <> 'closed'
      ), next_version AS (
        SELECT a.id, coalesce(max(rv.version), 0)::int + 1 AS version
        FROM authorized a LEFT JOIN rubric_versions rv ON rv.unit_standard_id = a.id
        GROUP BY a.id
      ), inserted_version AS (
        INSERT INTO rubric_versions (id, unit_standard_id, version, created_by)
        SELECT $3, id, version, $2 FROM next_version
        RETURNING *
      ), criterion_data AS (
        SELECT * FROM jsonb_to_recordset($4::jsonb)
          AS item(id uuid, criterion_key text, name text, description text, high_descriptor text, middle_descriptor text, low_descriptor text, position smallint)
      ), inserted_criteria AS (
        INSERT INTO rubric_criteria (id, rubric_version_id, criterion_key, name, description, high_descriptor, middle_descriptor, low_descriptor, position)
        SELECT d.id, v.id, d.criterion_key, d.name, d.description, d.high_descriptor, d.middle_descriptor, d.low_descriptor, d.position
        FROM inserted_version v CROSS JOIN criterion_data d
        RETURNING *
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $5, $2, $2, 'rubric.created', 'rubric_version', id, jsonb_build_object('version', version, 'criterionCount', $6::int)
        FROM inserted_version
      )
      SELECT v.id, v.unit_standard_id AS "unitStandardId", v.version, v.state, v.created_at AS "createdAt",
        coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id, 'key', c.criterion_key, 'name', c.name, 'description', c.description,
          'high', c.high_descriptor, 'middle', c.middle_descriptor, 'low', c.low_descriptor, 'position', c.position
        ) ORDER BY c.position) FILTER (WHERE c.id IS NOT NULL), '[]') AS criteria
      FROM inserted_version v LEFT JOIN inserted_criteria c ON c.rubric_version_id = v.id
      GROUP BY v.id, v.unit_standard_id, v.version, v.state, v.created_at`,
      [unitStandardId, ownerId, randomUUID(), JSON.stringify(criteria), randomUUID(), criteria.length]);
      if (!rows[0]) throw new AppError(404, "성취기준을 찾을 수 없거나 학기가 마감되었습니다.");
      return { ...rows[0], version: number(rows[0].version), createdAt: timestamp(rows[0].createdAt) } as RubricRecord;
    },

    async lockRubric(rubricId: string, ownerId: string) {
      const rows = await query(`WITH target AS (
        SELECT rv.id, rv.unit_standard_id
        FROM rubric_versions rv
        JOIN unit_standards us ON us.id = rv.unit_standard_id
        JOIN curriculum_units u ON u.id = us.unit_id
        JOIN curriculum_terms t ON t.id = u.term_id
        WHERE rv.id = $1 AND t.owner_id = $2 AND t.status <> 'closed' AND rv.state = 'draft'
          AND EXISTS (SELECT 1 FROM rubric_criteria c WHERE c.rubric_version_id = rv.id)
      ), retired AS (
        UPDATE rubric_versions old SET state = 'retired'
        FROM target
        WHERE old.unit_standard_id = target.unit_standard_id AND old.state = 'locked' AND old.id <> target.id
      ), locked AS (
        UPDATE rubric_versions rv SET state = 'locked', locked_at = now()
        FROM target WHERE rv.id = target.id
        RETURNING rv.*
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $3, $2, $2, 'rubric.locked', 'rubric_version', id, jsonb_build_object('version', version)
        FROM locked
      )
      SELECT id, unit_standard_id AS "unitStandardId", version, state, locked_at AS "lockedAt" FROM locked`,
      [rubricId, ownerId, randomUUID()]);
      if (!rows[0]) throw new AppError(409, "루브릭이 이미 잠겼거나, 평가 요소가 없거나, 접근할 수 없습니다.");
      return { ...rows[0], version: number(rows[0].version), lockedAt: timestamp(rows[0].lockedAt) } as Pick<RubricRecord, "id" | "unitStandardId" | "version" | "state"> & { lockedAt: string };
    },

    async getAiSuggestionContext(evidenceId: string, rubricCriterionId: string, ownerId: string) {
      const rows = await query(`SELECT e.id AS "evidenceId", c.id AS "rubricCriterionId",
        s.id AS "studentId", t.grade, t.subject, u.id AS "unitId", u.title AS "unitTitle",
        us.standard_code AS "standardCode", us.standard_content AS "standardContent",
        event.title AS "eventTitle", event.context AS "eventContext", event.event_type AS "eventType",
        e.modality, e.assistance_level AS "assistanceLevel",
        coalesce(e.original_text, e.transformed_text, '') AS "evidenceText",
        e.teacher_verified AS "teacherVerified", c.name AS "criterionName",
        c.description AS "criterionDescription", c.high_descriptor AS high,
        c.middle_descriptor AS middle, c.low_descriptor AS low
        FROM learning_evidence e
        JOIN curriculum_students s ON s.id = e.student_id
        JOIN curriculum_terms t ON t.id = s.term_id
        JOIN assessment_events event ON event.id = e.event_id
        JOIN curriculum_units u ON u.id = event.unit_id AND u.term_id = t.id
        JOIN rubric_criteria c ON c.id = $2
        JOIN rubric_versions rv ON rv.id = c.rubric_version_id AND rv.state = 'locked'
        JOIN unit_standards us ON us.id = rv.unit_standard_id AND us.unit_id = u.id
        WHERE e.id = $1 AND t.owner_id = $3
          AND char_length(coalesce(e.original_text, e.transformed_text, '')) > 0
          AND (e.transformation_status <> 'automated' OR e.teacher_verified)`,
      [evidenceId, rubricCriterionId, ownerId]);
      if (!rows[0]) throw new AppError(409, "잠긴 루브릭과 교사가 확인한 학생 수행 원문을 먼저 준비해 주세요.");
      return { ...rows[0], grade: number(rows[0].grade) } as AiSuggestionContext;
    },

    async findCompletedAiSuggestion(evidenceId: string, rubricCriterionId: string, ownerId: string, model: string, promptVersion: string, inputHash: string) {
      const rows = await query(`SELECT suggestion.id, suggestion.generation_run_id AS "generationRunId",
        suggestion.evidence_id AS "evidenceId", suggestion.rubric_criterion_id AS "rubricCriterionId",
        c.name AS "criterionName", us.id AS "unitStandardId", us.standard_code AS "standardCode",
        suggestion.model, suggestion.prompt_version AS "promptVersion",
        suggestion.suggested_level AS "suggestedLevel", suggestion.confidence,
        suggestion.evidence_excerpt AS "evidenceExcerpt", suggestion.rationale,
        suggestion.uncertainty, suggestion.missing_evidence AS "missingEvidence",
        suggestion.construct_caution AS "constructCaution", run.input_tokens AS "inputTokens",
        run.output_tokens AS "outputTokens", run.total_tokens AS "totalTokens",
        run.latency_ms AS "latencyMs", suggestion.created_at AS "createdAt"
        FROM ai_criterion_suggestions suggestion
        JOIN ai_generation_runs run ON run.id = suggestion.generation_run_id AND run.status = 'complete'
        JOIN learning_evidence e ON e.id = suggestion.evidence_id
        JOIN curriculum_students s ON s.id = e.student_id
        JOIN curriculum_terms t ON t.id = s.term_id
        JOIN rubric_criteria c ON c.id = suggestion.rubric_criterion_id
        JOIN rubric_versions rv ON rv.id = c.rubric_version_id
        JOIN unit_standards us ON us.id = rv.unit_standard_id
        WHERE suggestion.evidence_id = $1 AND suggestion.rubric_criterion_id = $2
          AND t.owner_id = $3 AND run.model = $4 AND run.prompt_version = $5 AND run.input_hash = $6
        ORDER BY suggestion.created_at DESC LIMIT 1`,
      [evidenceId, rubricCriterionId, ownerId, model, promptVersion, inputHash]);
      return rows[0] ? aiSuggestionRecord(rows[0]) : null;
    },

    async beginAiSuggestion(evidenceId: string, rubricCriterionId: string, ownerId: string, model: string, promptVersion: string, inputHash: string) {
      if (!model || model.length > 120 || !promptVersion || promptVersion.length > 80 || !/^[0-9a-f]{64}$/.test(inputHash)) {
        throw new AppError(400, "AI 평가 실행 정보를 확인해 주세요.");
      }
      const id = randomUUID();
      const rows = await query(`WITH authorized AS (
        SELECT e.id AS evidence_id, c.id AS criterion_id
        FROM learning_evidence e
        JOIN curriculum_students s ON s.id = e.student_id
        JOIN curriculum_terms t ON t.id = s.term_id
        JOIN assessment_events event ON event.id = e.event_id
        JOIN curriculum_units u ON u.id = event.unit_id AND u.term_id = t.id
        JOIN rubric_criteria c ON c.id = $2
        JOIN rubric_versions rv ON rv.id = c.rubric_version_id AND rv.state = 'locked'
        JOIN unit_standards us ON us.id = rv.unit_standard_id AND us.unit_id = u.id
        WHERE e.id = $1 AND t.owner_id = $3
      ), inserted AS (
        INSERT INTO ai_generation_runs (id, owner_id, evidence_id, rubric_criterion_id, feature, model, prompt_version, input_hash)
        SELECT $4, $3, evidence_id, criterion_id, 'criterion_suggestion', $5, $6, $7 FROM authorized
        RETURNING *
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $8, $3, $3, 'ai_suggestion.started', 'ai_generation_run', id,
          jsonb_build_object('evidenceId', evidence_id, 'criterionId', rubric_criterion_id, 'model', model, 'promptVersion', prompt_version)
        FROM inserted
      )
      SELECT id, evidence_id AS "evidenceId", rubric_criterion_id AS "rubricCriterionId",
        model, prompt_version AS "promptVersion", input_hash AS "inputHash", status,
        input_tokens AS "inputTokens", output_tokens AS "outputTokens", total_tokens AS "totalTokens",
        latency_ms AS "latencyMs", error_code AS "errorCode", error_message AS "errorMessage",
        created_at AS "createdAt", completed_at AS "completedAt" FROM inserted`,
      [evidenceId, rubricCriterionId, ownerId, id, model, promptVersion, inputHash, randomUUID()]);
      if (!rows[0]) throw new AppError(404, "학생 증거와 잠긴 루브릭 기준의 연결을 찾을 수 없습니다.");
      return {
        ...rows[0], inputTokens: null, outputTokens: null, totalTokens: null, latencyMs: null,
        createdAt: timestamp(rows[0].createdAt), completedAt: null,
      } as AiGenerationRunRecord;
    },

    async completeAiSuggestion(runId: string, ownerId: string, input: unknown) {
      const value = parseInput(aiSuggestionCompletionSchema, input, "AI 추천 결과와 사용량을 확인해 주세요.");
      const suggestionId = randomUUID();
      const rows = await query(`WITH completed AS (
        UPDATE ai_generation_runs run SET status = 'complete', input_tokens = $11,
          output_tokens = $12, total_tokens = $13, latency_ms = $14,
          provider_metadata = $15::jsonb, completed_at = now()
        WHERE run.id = $1 AND run.owner_id = $2 AND run.status = 'pending'
        RETURNING *
      ), inserted AS (
        INSERT INTO ai_criterion_suggestions (
          id, generation_run_id, evidence_id, rubric_criterion_id, model, prompt_version,
          suggested_level, confidence, evidence_excerpt, rationale, uncertainty,
          missing_evidence, construct_caution
        )
        SELECT $3, id, evidence_id, rubric_criterion_id, model, prompt_version,
          $4, $5, $6, $7, $8, $9, $10 FROM completed
        RETURNING *
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $16, $2, $2, 'ai_suggestion.completed', 'ai_criterion_suggestion', id,
          jsonb_build_object('runId', generation_run_id, 'level', suggested_level, 'confidence', confidence, 'totalTokens', $13::int)
        FROM inserted
      )
      SELECT suggestion.id, suggestion.generation_run_id AS "generationRunId",
        suggestion.evidence_id AS "evidenceId", suggestion.rubric_criterion_id AS "rubricCriterionId",
        c.name AS "criterionName", us.id AS "unitStandardId", us.standard_code AS "standardCode",
        suggestion.model, suggestion.prompt_version AS "promptVersion",
        suggestion.suggested_level AS "suggestedLevel", suggestion.confidence,
        suggestion.evidence_excerpt AS "evidenceExcerpt", suggestion.rationale,
        suggestion.uncertainty, suggestion.missing_evidence AS "missingEvidence",
        suggestion.construct_caution AS "constructCaution", run.input_tokens AS "inputTokens",
        run.output_tokens AS "outputTokens", run.total_tokens AS "totalTokens",
        run.latency_ms AS "latencyMs", suggestion.created_at AS "createdAt"
      FROM inserted suggestion
      JOIN completed run ON run.id = suggestion.generation_run_id
      JOIN rubric_criteria c ON c.id = suggestion.rubric_criterion_id
      JOIN rubric_versions rv ON rv.id = c.rubric_version_id
      JOIN unit_standards us ON us.id = rv.unit_standard_id`, [
        runId, ownerId, suggestionId, value.suggestedLevel, value.confidence,
        value.evidenceExcerpt, value.rationale, value.uncertainty, value.missingEvidence,
        value.constructCaution, value.usage.inputTokens ?? null, value.usage.outputTokens ?? null,
        value.usage.totalTokens ?? null, value.latencyMs, JSON.stringify(value.providerMetadata), randomUUID(),
      ]);
      if (!rows[0]) throw new AppError(409, "AI 추천 실행이 이미 완료되었거나 접근할 수 없습니다.");
      return aiSuggestionRecord(rows[0]);
    },

    async failAiSuggestion(runId: string, ownerId: string, input: unknown) {
      const value = parseInput(aiSuggestionFailureSchema, input, "AI 추천 실패 기록을 확인해 주세요.");
      const rows = await query(`WITH failed AS (
        UPDATE ai_generation_runs run SET status = 'error', error_code = $3,
          error_message = $4, latency_ms = $5, completed_at = now()
        WHERE run.id = $1 AND run.owner_id = $2 AND run.status = 'pending'
        RETURNING *
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $6, $2, $2, 'ai_suggestion.failed', 'ai_generation_run', id,
          jsonb_build_object('errorCode', error_code, 'latencyMs', latency_ms)
        FROM failed
      )
      SELECT id, evidence_id AS "evidenceId", rubric_criterion_id AS "rubricCriterionId",
        model, prompt_version AS "promptVersion", input_hash AS "inputHash", status,
        input_tokens AS "inputTokens", output_tokens AS "outputTokens", total_tokens AS "totalTokens",
        latency_ms AS "latencyMs", error_code AS "errorCode", error_message AS "errorMessage",
        created_at AS "createdAt", completed_at AS "completedAt" FROM failed`,
      [runId, ownerId, value.errorCode, value.errorMessage, value.latencyMs, randomUUID()]);
      if (!rows[0]) return null;
      return {
        ...rows[0], inputTokens: nullableNumber(rows[0].inputTokens), outputTokens: nullableNumber(rows[0].outputTokens),
        totalTokens: nullableNumber(rows[0].totalTokens), latencyMs: nullableNumber(rows[0].latencyMs),
        createdAt: timestamp(rows[0].createdAt), completedAt: timestamp(rows[0].completedAt),
      } as AiGenerationRunRecord;
    },

    async saveJudgement(evidenceId: string, ownerId: string, input: unknown) {
      const value = parseInput(judgementInputSchema, input, "기준별 수준·학생 원문 근거·교사 판단 이유를 확인해 주세요.");
      const rows = await query(`WITH authorized AS (
        SELECT e.id AS evidence_id, c.id AS criterion_id
        FROM learning_evidence e
        JOIN assessment_events event ON event.id = e.event_id
        JOIN curriculum_units u ON u.id = event.unit_id
        JOIN curriculum_terms t ON t.id = u.term_id
        JOIN rubric_criteria c ON c.id = $4
        JOIN rubric_versions rv ON rv.id = c.rubric_version_id AND rv.state = 'locked'
        JOIN unit_standards us ON us.id = rv.unit_standard_id AND us.unit_id = u.id
        WHERE e.id = $1 AND t.owner_id = $2 AND t.status <> 'closed'
      ), previous AS (
        SELECT j.id, j.revision FROM criterion_judgements j
        JOIN authorized a ON a.evidence_id = j.evidence_id AND a.criterion_id = j.rubric_criterion_id
        ORDER BY j.revision DESC, j.created_at DESC LIMIT 1
      ), inserted AS (
        INSERT INTO criterion_judgements (
          id, evidence_id, rubric_criterion_id, teacher_id, level, evidence_excerpt, rationale, state, revision, supersedes_id
        )
        SELECT $3, a.evidence_id, a.criterion_id, $2, $5, $6, $7, $8,
          coalesce((SELECT revision FROM previous), 0) + 1,
          (SELECT id FROM previous)
        FROM authorized a
        RETURNING *
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $9, $2, $2, 'judgement.saved', 'criterion_judgement', id,
          jsonb_build_object('evidenceId', evidence_id, 'criterionId', rubric_criterion_id, 'level', level, 'state', state, 'revision', revision)
        FROM inserted
      )
      SELECT id, evidence_id AS "evidenceId", rubric_criterion_id AS "rubricCriterionId", level,
        evidence_excerpt AS "evidenceExcerpt", rationale, state, revision, supersedes_id AS "supersedesId", created_at AS "createdAt"
      FROM inserted`, [evidenceId, ownerId, randomUUID(), value.rubricCriterionId, value.level, value.evidenceExcerpt, value.rationale, value.state, randomUUID()]);
      if (!rows[0]) throw new AppError(404, "증거와 잠긴 루브릭 기준의 연결을 확인해 주세요.");
      return { ...rows[0], revision: number(rows[0].revision), createdAt: timestamp(rows[0].createdAt) } as CriterionJudgementRecord;
    },

    async createFeedback(ownerId: string, input: unknown) {
      const value = parseInput(feedbackInputSchema, input, "강점·격차 유형·다음 학습과 판단 근거를 확인해 주세요.");
      const basisIds = [...new Set(value.basisJudgementIds)];
      if (basisIds.length !== value.basisJudgementIds.length) throw new AppError(400, "같은 판단 근거를 중복 선택할 수 없습니다.");
      const rows = await query(`WITH authorized AS (
        SELECT s.id AS student_id, us.id AS unit_standard_id
        FROM curriculum_students s
        JOIN curriculum_terms t ON t.id = s.term_id
        JOIN curriculum_units u ON u.term_id = t.id
        JOIN unit_standards us ON us.id = $3 AND us.unit_id = u.id
        WHERE s.id = $2 AND t.owner_id = $1 AND t.status <> 'closed'
      ), basis AS (
        SELECT DISTINCT j.id
        FROM criterion_judgements j
        JOIN learning_evidence e ON e.id = j.evidence_id
        JOIN rubric_criteria c ON c.id = j.rubric_criterion_id
        JOIN rubric_versions rv ON rv.id = c.rubric_version_id
        JOIN authorized a ON a.student_id = e.student_id AND a.unit_standard_id = rv.unit_standard_id
        WHERE j.id = ANY($4::uuid[]) AND j.state = 'final'
      ), valid AS (
        SELECT * FROM authorized WHERE (SELECT count(*) FROM basis) = $5::int
      ), inserted AS (
        INSERT INTO feedback_cycles (id, student_id, unit_standard_id, strength, gap_type, gap_description, next_learning, created_by)
        SELECT $6, student_id, unit_standard_id, $7, $8, $9, $10, $1 FROM valid
        RETURNING *
      ), linked AS (
        INSERT INTO feedback_basis (cycle_id, judgement_id)
        SELECT i.id, b.id FROM inserted i CROSS JOIN basis b
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $11, $1, $1, 'feedback.created', 'feedback_cycle', id,
          jsonb_build_object('studentId', student_id, 'unitStandardId', unit_standard_id, 'gapType', gap_type)
        FROM inserted
      )
      SELECT id, student_id AS "studentId", unit_standard_id AS "unitStandardId", strength,
        gap_type AS "gapType", gap_description AS "gapDescription", next_learning AS "nextLearning",
        status, created_at AS "createdAt"
      FROM inserted`, [
        ownerId, value.studentId, value.unitStandardId, basisIds, basisIds.length, randomUUID(),
        value.strength, value.gapType, value.gapDescription, value.nextLearning, randomUUID(),
      ]);
      if (!rows[0]) throw new AppError(409, "같은 학생·성취기준의 최종 교사 판단만 피드백 근거로 사용할 수 있습니다.");
      return { ...rows[0], createdAt: timestamp(rows[0].createdAt) } as FeedbackRecord;
    },

    async recordIntervention(cycleId: string, ownerId: string, input: unknown) {
      const value = parseInput(interventionInputSchema, input, "추가 학습 내용·지원 수준·교사 기록을 확인해 주세요.");
      const rows = await query(`WITH authorized AS (
        SELECT f.id
        FROM feedback_cycles f
        JOIN curriculum_students s ON s.id = f.student_id
        JOIN curriculum_terms t ON t.id = s.term_id
        WHERE f.id = $1 AND t.owner_id = $2 AND t.status <> 'closed' AND f.status <> 'completed'
      ), inserted AS (
        INSERT INTO learning_interventions (id, cycle_id, activity, support_level, teacher_note, occurred_at, created_by)
        SELECT $3, id, $4, $5, $6, $7::timestamptz, $2 FROM authorized
        RETURNING *
      ), advanced AS (
        UPDATE feedback_cycles f SET status = 'in_progress', updated_at = now()
        FROM authorized WHERE f.id = authorized.id
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $8, $2, $2, 'intervention.recorded', 'learning_intervention', id,
          jsonb_build_object('cycleId', cycle_id, 'supportLevel', support_level)
        FROM inserted
      )
      SELECT id, cycle_id AS "cycleId", activity, support_level AS "supportLevel", teacher_note AS "teacherNote",
        occurred_at AS "occurredAt", created_at AS "createdAt" FROM inserted`,
      [cycleId, ownerId, randomUUID(), value.activity, value.supportLevel, value.teacherNote, value.occurredAt, randomUUID()]);
      if (!rows[0]) throw new AppError(409, "피드백 사이클이 완료되었거나 접근할 수 없습니다.");
      return { ...rows[0], occurredAt: timestamp(rows[0].occurredAt), createdAt: timestamp(rows[0].createdAt) } as InterventionRecord;
    },

    async linkReassessment(cycleId: string, ownerId: string, input: unknown) {
      const value = parseInput(reassessmentInputSchema, input, "이전 증거·재평가 증거·독립 수행 여부를 확인해 주세요.");
      const rows = await query(`WITH authorized AS (
        SELECT f.id AS cycle_id
        FROM feedback_cycles f
        JOIN curriculum_students s ON s.id = f.student_id
        JOIN curriculum_terms t ON t.id = s.term_id
        JOIN learning_evidence prior ON prior.id = $3 AND prior.student_id = f.student_id
        JOIN learning_evidence newer ON newer.id = $4 AND newer.student_id = f.student_id
        JOIN assessment_events newer_event ON newer_event.id = newer.event_id AND newer_event.event_type = 'reassessment'
        WHERE f.id = $1 AND t.owner_id = $2 AND t.status <> 'closed'
          AND newer_event.unit_id = (SELECT unit_id FROM unit_standards WHERE id = f.unit_standard_id)
          AND EXISTS (
            SELECT 1 FROM feedback_basis fb
            JOIN criterion_judgements j ON j.id = fb.judgement_id
            WHERE fb.cycle_id = f.id AND j.evidence_id = prior.id
          )
          AND (($5::boolean AND newer.assistance_level = 'independent') OR (NOT $5::boolean AND newer.assistance_level <> 'independent'))
      ), inserted AS (
        INSERT INTO reassessment_links (id, cycle_id, prior_evidence_id, new_evidence_id, independent, created_by)
        SELECT $6, cycle_id, $3, $4, $5, $2 FROM authorized
        ON CONFLICT (cycle_id, new_evidence_id) DO NOTHING
        RETURNING *
      ), advanced AS (
        UPDATE feedback_cycles f
        SET status = CASE WHEN $5 THEN 'completed' ELSE 'ready_for_reassessment' END, updated_at = now()
        FROM inserted i WHERE f.id = i.cycle_id
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $7, $2, $2, 'reassessment.linked', 'reassessment_link', id,
          jsonb_build_object('cycleId', cycle_id, 'independent', independent)
        FROM inserted
      )
      SELECT id, cycle_id AS "cycleId", prior_evidence_id AS "priorEvidenceId", new_evidence_id AS "newEvidenceId",
        independent, created_at AS "createdAt" FROM inserted`,
      [cycleId, ownerId, value.priorEvidenceId, value.newEvidenceId, value.independent, randomUUID(), randomUUID()]);
      if (!rows[0]) throw new AppError(409, "같은 학생·성취기준의 새로운 재평가 증거인지, 도움 수준과 독립 수행 표시가 일치하는지 확인해 주세요.");
      return { ...rows[0], createdAt: timestamp(rows[0].createdAt) } as ReassessmentRecord;
    },

    async saveSemesterJudgement(termId: string, ownerId: string, input: unknown) {
      const value = parseInput(semesterJudgementInputSchema, input, "학기말 수준·근거·선택한 수행 증거를 확인해 주세요.");
      const allEvidenceIds = [...value.evidenceIds, ...value.conflictingEvidenceIds];
      const evidenceRows = allEvidenceIds.length ? await query(`SELECT DISTINCT e.id, e.assistance_level AS "assistanceLevel"
        FROM learning_evidence e
        JOIN curriculum_students s ON s.id = e.student_id
        JOIN curriculum_terms t ON t.id = s.term_id
        JOIN criterion_judgements j ON j.evidence_id = e.id AND j.state = 'final'
        JOIN rubric_criteria c ON c.id = j.rubric_criterion_id
        JOIN rubric_versions rv ON rv.id = c.rubric_version_id
        JOIN unit_standards us ON us.id = rv.unit_standard_id AND us.standard_code = $4
        WHERE t.id = $1 AND t.owner_id = $2 AND s.id = $3 AND e.id = ANY($5::uuid[])`,
      [termId, ownerId, value.studentId, value.standardCode, allEvidenceIds]) : [];
      if (evidenceRows.length !== allEvidenceIds.length) throw new AppError(409, "이 학생·학기·성취기준에 대해 교사가 최종 확정한 수행 증거만 선택할 수 있습니다.");
      if (value.state === "final" && value.level !== "판단 보류" && !evidenceRows.some(row => row.assistanceLevel === "independent")) {
        throw new AppError(409, "학기말 최종 수준에는 도움 없이 수행한 독립 증거가 적어도 하나 필요합니다.");
      }
      const evidenceLinks = [
        ...value.evidenceIds.map(id => ({ id, role: "supporting" })),
        ...value.conflictingEvidenceIds.map(id => ({ id, role: "conflicting" })),
      ];
      const rows = await query(`WITH authorized AS (
        SELECT t.id AS term_id, s.id AS student_id
        FROM curriculum_terms t
        JOIN curriculum_students s ON s.term_id = t.id
        WHERE t.id = $1 AND t.owner_id = $2 AND s.id = $3 AND t.status <> 'closed'
          AND EXISTS (
            SELECT 1 FROM curriculum_units u
            JOIN unit_standards us ON us.unit_id = u.id
            WHERE u.term_id = t.id AND us.standard_code = $4
          )
      ), previous AS (
        SELECT j.id, j.revision FROM semester_judgements j
        JOIN authorized a ON a.term_id = j.term_id AND a.student_id = j.student_id
        WHERE j.standard_code = $4
        ORDER BY j.revision DESC, j.created_at DESC LIMIT 1
      ), inserted AS (
        INSERT INTO semester_judgements (id, term_id, student_id, standard_code, level, rationale, state, revision, teacher_id, supersedes_id)
        SELECT $5, term_id, student_id, $4, $6, $7, $8,
          coalesce((SELECT revision FROM previous), 0) + 1, $2, (SELECT id FROM previous)
        FROM authorized
        RETURNING *
      ), link_data AS (
        SELECT * FROM jsonb_to_recordset($9::jsonb) AS item(id uuid, role text)
      ), linked AS (
        INSERT INTO semester_judgement_evidence (judgement_id, evidence_id, evidence_role)
        SELECT j.id, d.id, d.role FROM inserted j CROSS JOIN link_data d
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $10, $2, $2, 'semester_judgement.saved', 'semester_judgement', id,
          jsonb_build_object('studentId', student_id, 'standardCode', standard_code, 'level', level, 'state', state, 'revision', revision, 'evidenceCount', $11::int)
        FROM inserted
      )
      SELECT id, term_id AS "termId", student_id AS "studentId", standard_code AS "standardCode",
        level, rationale, state, revision, supersedes_id AS "supersedesId", created_at AS "createdAt"
      FROM inserted`, [
        termId, ownerId, value.studentId, value.standardCode, randomUUID(), value.level,
        value.rationale, value.state, JSON.stringify(evidenceLinks), randomUUID(), evidenceLinks.length,
      ]);
      if (!rows[0]) throw new AppError(404, "학기·학생·성취기준 연결을 찾을 수 없거나 학기가 마감되었습니다.");
      return { ...rows[0], revision: number(rows[0].revision), createdAt: timestamp(rows[0].createdAt), evidence: evidenceLinks } as SemesterJudgementRecord;
    },

    async getWorkflow(termId: string, ownerId: string) {
      await getOwnedTerm(termId, ownerId);
      const [events, rubrics, evidence, feedback, semesterJudgements] = await Promise.all([
        query(`SELECT event.id, event.unit_id AS "unitId", event.assessment_id AS "assessmentId",
          event.event_type AS "eventType", event.title, event.context,
          event.occurred_at AS "occurredAt", event.created_at AS "createdAt", u.title AS "unitTitle"
          FROM assessment_events event
          JOIN curriculum_units u ON u.id = event.unit_id
          JOIN curriculum_terms t ON t.id = u.term_id
          WHERE t.id = $1 AND t.owner_id = $2
          ORDER BY event.occurred_at DESC, event.created_at DESC`, [termId, ownerId]),
        query(`SELECT
          rv.id, rv.unit_standard_id AS "unitStandardId", rv.version, rv.state,
          rv.created_at AS "createdAt", u.id AS "unitId", u.title AS "unitTitle",
          us.standard_code AS "standardCode", us.standard_content AS "standardContent",
          coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'id', c.id, 'key', c.criterion_key, 'name', c.name, 'description', c.description,
              'high', c.high_descriptor, 'middle', c.middle_descriptor, 'low', c.low_descriptor,
              'position', c.position
            ) ORDER BY c.position)
            FROM rubric_criteria c WHERE c.rubric_version_id = rv.id
          ), '[]') AS criteria
          FROM rubric_versions rv
          JOIN unit_standards us ON us.id = rv.unit_standard_id
          JOIN curriculum_units u ON u.id = us.unit_id
          JOIN curriculum_terms t ON t.id = u.term_id
          WHERE t.id = $1 AND t.owner_id = $2
          ORDER BY us.id, rv.version DESC`, [termId, ownerId]),
        query(`SELECT e.id, e.student_id AS "studentId", e.event_id AS "eventId", e.attempt_id AS "attemptId",
          e.modality, e.source_kind AS "sourceKind", e.assistance_level AS "assistanceLevel",
          e.original_text AS "originalText", e.source_ref AS "sourceRef", e.transformed_text AS "transformedText",
          e.transformation_status AS "transformationStatus", e.teacher_verified AS "teacherVerified",
          e.collected_at AS "collectedAt", e.created_at AS "createdAt", e.supersedes_id AS "supersedesId",
          s.display_name AS "studentName", u.id AS "unitId", u.title AS "unitTitle",
          event.title AS "eventTitle", event.context AS "eventContext", event.event_type AS "eventType",
          coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'id', latest.id, 'evidenceId', latest.evidence_id,
              'rubricCriterionId', latest.rubric_criterion_id, 'criterionName', latest.criterion_name,
              'unitStandardId', latest.unit_standard_id, 'standardCode', latest.standard_code,
              'level', latest.level, 'evidenceExcerpt', latest.evidence_excerpt,
              'rationale', latest.rationale, 'state', latest.state, 'revision', latest.revision,
              'supersedesId', latest.supersedes_id, 'createdAt', latest.created_at
            ) ORDER BY latest.standard_code, latest.criterion_position)
            FROM (
              SELECT DISTINCT ON (j.rubric_criterion_id)
                j.id, j.evidence_id, j.rubric_criterion_id, c.name AS criterion_name,
                us.id AS unit_standard_id, us.standard_code, c.position AS criterion_position,
                j.level, j.evidence_excerpt, j.rationale, j.state, j.revision,
                j.supersedes_id, j.created_at
              FROM criterion_judgements j
              JOIN rubric_criteria c ON c.id = j.rubric_criterion_id
              JOIN rubric_versions rv ON rv.id = c.rubric_version_id
              JOIN unit_standards us ON us.id = rv.unit_standard_id
              WHERE j.evidence_id = e.id
              ORDER BY j.rubric_criterion_id, j.revision DESC, j.created_at DESC
            ) latest
          ), '[]') AS judgements,
          coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'id', latest.id, 'generationRunId', latest.generation_run_id,
              'evidenceId', latest.evidence_id, 'rubricCriterionId', latest.rubric_criterion_id,
              'criterionName', latest.criterion_name, 'unitStandardId', latest.unit_standard_id,
              'standardCode', latest.standard_code, 'model', latest.model,
              'promptVersion', latest.prompt_version, 'suggestedLevel', latest.suggested_level,
              'confidence', latest.confidence, 'evidenceExcerpt', latest.evidence_excerpt,
              'rationale', latest.rationale, 'uncertainty', latest.uncertainty,
              'missingEvidence', latest.missing_evidence, 'constructCaution', latest.construct_caution,
              'inputTokens', latest.input_tokens, 'outputTokens', latest.output_tokens,
              'totalTokens', latest.total_tokens, 'latencyMs', latest.latency_ms,
              'createdAt', latest.created_at
            ) ORDER BY latest.standard_code, latest.criterion_position)
            FROM (
              SELECT DISTINCT ON (suggestion.rubric_criterion_id)
                suggestion.*, c.name AS criterion_name, c.position AS criterion_position,
                us.id AS unit_standard_id, us.standard_code, run.input_tokens,
                run.output_tokens, run.total_tokens, run.latency_ms
              FROM ai_criterion_suggestions suggestion
              JOIN ai_generation_runs run ON run.id = suggestion.generation_run_id AND run.status = 'complete'
              JOIN rubric_criteria c ON c.id = suggestion.rubric_criterion_id
              JOIN rubric_versions rv ON rv.id = c.rubric_version_id
              JOIN unit_standards us ON us.id = rv.unit_standard_id
              WHERE suggestion.evidence_id = e.id
              ORDER BY suggestion.rubric_criterion_id, suggestion.created_at DESC
            ) latest
          ), '[]') AS "aiSuggestions"
          FROM learning_evidence e
          JOIN curriculum_students s ON s.id = e.student_id
          JOIN curriculum_terms t ON t.id = s.term_id
          JOIN assessment_events event ON event.id = e.event_id
          JOIN curriculum_units u ON u.id = event.unit_id AND u.term_id = t.id
          WHERE t.id = $1 AND t.owner_id = $2
          ORDER BY e.collected_at DESC, e.created_at DESC`, [termId, ownerId]),
        query(`SELECT f.id, f.student_id AS "studentId", f.unit_standard_id AS "unitStandardId",
          f.strength, f.gap_type AS "gapType", f.gap_description AS "gapDescription",
          f.next_learning AS "nextLearning", f.status, f.created_at AS "createdAt",
          s.display_name AS "studentName", u.id AS "unitId", u.title AS "unitTitle",
          us.standard_code AS "standardCode", us.standard_content AS "standardContent",
          coalesce((SELECT jsonb_agg(fb.judgement_id ORDER BY fb.judgement_id) FROM feedback_basis fb WHERE fb.cycle_id = f.id), '[]') AS "basisJudgementIds",
          coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id', i.id, 'cycleId', i.cycle_id, 'activity', i.activity,
            'supportLevel', i.support_level, 'teacherNote', i.teacher_note,
            'occurredAt', i.occurred_at, 'createdAt', i.created_at
          ) ORDER BY i.occurred_at) FROM learning_interventions i WHERE i.cycle_id = f.id), '[]') AS interventions,
          coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id', r.id, 'cycleId', r.cycle_id, 'priorEvidenceId', r.prior_evidence_id,
            'newEvidenceId', r.new_evidence_id, 'independent', r.independent,
            'createdAt', r.created_at
          ) ORDER BY r.created_at) FROM reassessment_links r WHERE r.cycle_id = f.id), '[]') AS reassessments
          FROM feedback_cycles f
          JOIN curriculum_students s ON s.id = f.student_id
          JOIN curriculum_terms t ON t.id = s.term_id
          JOIN unit_standards us ON us.id = f.unit_standard_id
          JOIN curriculum_units u ON u.id = us.unit_id AND u.term_id = t.id
          WHERE t.id = $1 AND t.owner_id = $2
          ORDER BY f.created_at DESC`, [termId, ownerId]),
        query(`SELECT latest.id, latest.term_id AS "termId", latest.student_id AS "studentId",
          latest.standard_code AS "standardCode", latest.level, latest.rationale, latest.state,
          latest.revision, latest.supersedes_id AS "supersedesId", latest.created_at AS "createdAt",
          s.display_name AS "studentName",
          coalesce((SELECT jsonb_agg(jsonb_build_object('id', link.evidence_id, 'role', link.evidence_role) ORDER BY link.evidence_role, link.evidence_id)
            FROM semester_judgement_evidence link WHERE link.judgement_id = latest.id), '[]') AS evidence
          FROM (
            SELECT DISTINCT ON (j.student_id, j.standard_code) j.*
            FROM semester_judgements j
            WHERE j.term_id = $1
            ORDER BY j.student_id, j.standard_code, j.revision DESC, j.created_at DESC
          ) latest
          JOIN curriculum_students s ON s.id = latest.student_id
          JOIN curriculum_terms t ON t.id = latest.term_id
          WHERE t.owner_id = $2
          ORDER BY s.display_name, latest.standard_code`, [termId, ownerId]),
      ]);
      return {
        events: events.map(row => ({ ...row, occurredAt: timestamp(row.occurredAt), createdAt: timestamp(row.createdAt) })),
        rubrics: rubrics.map(row => ({ ...row, version: number(row.version), createdAt: timestamp(row.createdAt) })),
        evidence: evidence.map(row => ({ ...row, collectedAt: timestamp(row.collectedAt), createdAt: timestamp(row.createdAt) })),
        feedback: feedback.map(row => ({ ...row, createdAt: timestamp(row.createdAt) })),
        semesterJudgements: semesterJudgements.map(row => ({ ...row, revision: number(row.revision), createdAt: timestamp(row.createdAt) })),
      } as CurriculumWorkflowRecord;
    },

    async getDashboard(termId: string, ownerId: string) {
      const term = await getOwnedTerm(termId, ownerId);
      const [units, students, activity] = await Promise.all([
        query(`SELECT u.id, u.order_index AS "orderIndex", u.title, u.status,
          coalesce(jsonb_agg(jsonb_build_object(
            'id', us.id, 'code', us.standard_code, 'content', us.standard_content, 'domain', us.domain,
            'rubric', (
              SELECT jsonb_build_object('id', rv.id, 'version', rv.version, 'state', rv.state, 'criterionCount', (SELECT count(*) FROM rubric_criteria rc WHERE rc.rubric_version_id = rv.id))
              FROM rubric_versions rv WHERE rv.unit_standard_id = us.id ORDER BY rv.version DESC LIMIT 1
            )
          ) ORDER BY us.position) FILTER (WHERE us.id IS NOT NULL), '[]') AS standards
          FROM curriculum_units u
          LEFT JOIN unit_standards us ON us.unit_id = u.id
          WHERE u.term_id = $1
          GROUP BY u.id
          ORDER BY u.order_index`, [termId]),
        query(`SELECT s.id, s.student_ref AS "studentRef", s.display_name AS "displayName", s.active,
          count(DISTINCT e.id)::int AS "evidenceCount",
          count(DISTINCT f.id) FILTER (WHERE f.status <> 'completed')::int AS "openFeedbackCount",
          count(DISTINCT r.id) FILTER (WHERE r.independent)::int AS "independentGrowthCount"
          FROM curriculum_students s
          LEFT JOIN learning_evidence e ON e.student_id = s.id
          LEFT JOIN feedback_cycles f ON f.student_id = s.id
          LEFT JOIN reassessment_links r ON r.cycle_id = f.id
          WHERE s.term_id = $1
          GROUP BY s.id
          ORDER BY s.display_name`, [termId]),
        query(`SELECT
          (SELECT count(*)::int FROM learning_evidence e JOIN curriculum_students s ON s.id = e.student_id WHERE s.term_id = $1) AS "evidenceCount",
          (SELECT count(*)::int FROM feedback_cycles f JOIN curriculum_students s ON s.id = f.student_id WHERE s.term_id = $1 AND f.status <> 'completed') AS "openFeedbackCount",
          (SELECT count(*)::int FROM reassessment_links r JOIN feedback_cycles f ON f.id = r.cycle_id JOIN curriculum_students s ON s.id = f.student_id WHERE s.term_id = $1 AND r.independent) AS "independentGrowthCount",
          (SELECT count(DISTINCT standard_code)::int FROM semester_judgements j WHERE j.term_id = $1 AND j.state = 'final') AS "finalStandardCount"`, [termId]),
      ]);
      const summary = activity[0] ?? {};
      return {
        term,
        units: units.map(row => ({ ...row, orderIndex: number(row.orderIndex) })),
        students: students.map(row => ({
          ...row,
          evidenceCount: number(row.evidenceCount),
          openFeedbackCount: number(row.openFeedbackCount),
          independentGrowthCount: number(row.independentGrowthCount),
        })),
        activity: {
          evidenceCount: number(summary.evidenceCount),
          openFeedbackCount: number(summary.openFeedbackCount),
          independentGrowthCount: number(summary.independentGrowthCount),
          finalStandardCount: number(summary.finalStandardCount),
        },
      } as CurriculumDashboardRecord;
    },
  };
}

export type GrowthRepository = ReturnType<typeof createGrowthRepository>;
