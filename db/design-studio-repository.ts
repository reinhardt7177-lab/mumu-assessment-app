import { randomBytes, randomUUID } from "node:crypto";
import { AppError } from "../lib/assessment-domain";
import {
  alignmentCandidateSchema,
  competencyUnpackSchema,
  designSessionCreateSchema,
  rubricDraftItemSchema,
  questionDraftSchema,
  validityAuditSchema,
  type AlignmentCandidate,
  type CompetencyUnpack,
  type DesignFeature,
  type DesignSessionRecord,
  type DraftSource,
  type QuestionDraft,
  type RubricDraftItem,
  type ValidityAudit,
} from "../lib/design-studio-domain";
import type { AssessmentDefinition } from "../lib/assessment-domain";
import type { Query } from "./repository";

const sessionColumns = `s.id, s.owner_id AS "ownerId", s.title, s.grade, s.subject,
  s.learning_goal AS "learningGoal", s.status, s.current_step AS "currentStep",
  s.approved_assessment_id AS "approvedAssessmentId", s.created_at AS "createdAt", s.updated_at AS "updatedAt"`;
const timestamp = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const number = (value: unknown) => Number(value ?? 0);

function mapSession(row: Record<string, unknown>): DesignSessionRecord {
  const source = row.source && typeof row.source === "object" ? row.source as DesignSessionRecord["source"] : null;
  const standards = Array.isArray(row.standards) ? alignmentCandidateSchema.array().parse(row.standards.map(item => ({ ...(item as object), confidence: number((item as { confidence?: unknown }).confidence) }))) : [];
  const competency = row.competency ? competencyUnpackSchema.parse(row.competency) : null;
  const rawBlueprint = row.blueprint && typeof row.blueprint === "object" ? row.blueprint as Record<string, unknown> : null;
  const blueprint = rawBlueprint ? {
    rubric: rubricDraftItemSchema.array().parse(rawBlueprint.rubric ?? []),
    questions: questionDraftSchema.array().parse(rawBlueprint.questions ?? []),
    methods: ["text"] as AssessmentDefinition["methods"],
    grading: { upperThreshold: number((rawBlueprint.grading as { upperThreshold?: unknown } | undefined)?.upperThreshold || 80), middleThreshold: number((rawBlueprint.grading as { middleThreshold?: unknown } | undefined)?.middleThreshold || 50) },
  } : null;
  return {
    ...row,
    grade: number(row.grade),
    currentStep: number(row.currentStep),
    createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt),
    source,
    standards,
    competency,
    blueprint,
    validity: row.validity ? validityAuditSchema.parse(row.validity) : null,
  } as DesignSessionRecord;
}

export function createDesignStudioRepository(query: Query) {
  async function get(id: string, ownerId: string) {
    const rows = await query(`SELECT ${sessionColumns},
      (SELECT jsonb_build_object('id', ds.id, 'kind', ds.source_kind, 'fileName', ds.file_name,
        'mimeType', ds.mime_type, 'sha256', ds.sha256, 'text', ds.extracted_text)
       FROM design_sources ds WHERE ds.session_id = s.id ORDER BY ds.created_at DESC LIMIT 1) AS source,
      coalesce((SELECT jsonb_agg(jsonb_build_object('code', a.standard_code, 'domain', a.domain,
        'content', a.standard_content, 'rationale', a.rationale, 'confidence', a.confidence, 'state', a.state)
        ORDER BY a.created_at, a.standard_code) FROM standard_alignment_candidates a WHERE a.session_id = s.id), '[]'::jsonb) AS standards,
      (SELECT c.output FROM competency_unpacks c WHERE c.session_id = s.id ORDER BY c.version DESC LIMIT 1) AS competency,
      (SELECT jsonb_build_object('rubric', b.rubric, 'questions', b.questions, 'methods', b.methods, 'grading', b.grading)
        FROM assessment_blueprints b WHERE b.session_id = s.id ORDER BY b.version DESC LIMIT 1) AS blueprint,
      (SELECT v.output FROM validity_audits v WHERE v.session_id = s.id ORDER BY v.version DESC LIMIT 1) AS validity
      FROM design_sessions s WHERE s.id = $1 AND s.owner_id = $2`, [id, ownerId]);
    if (!rows[0]) throw new AppError(404, "평가 설계 작업을 찾을 수 없거나 접근 권한이 없습니다.");
    return mapSession(rows[0]);
  }

  return {
    get,
    async list(ownerId: string) {
      const rows = await query(`SELECT ${sessionColumns},
        NULL::jsonb AS source, '[]'::jsonb AS standards, NULL::jsonb AS competency, NULL::jsonb AS blueprint, NULL::jsonb AS validity,
        (SELECT count(*)::int FROM standard_alignment_candidates a WHERE a.session_id = s.id AND a.state = 'selected') AS "selectedStandardCount",
        EXISTS (SELECT 1 FROM assessment_blueprints b WHERE b.session_id = s.id) AS "hasBlueprint",
        (SELECT v.blocked FROM validity_audits v WHERE v.session_id = s.id ORDER BY v.version DESC LIMIT 1) AS "validityBlocked"
        FROM design_sessions s WHERE s.owner_id = $1 ORDER BY s.updated_at DESC LIMIT 100`, [ownerId]);
      return rows.map(row => ({
        id: String(row.id), title: String(row.title), grade: number(row.grade), subject: String(row.subject),
        learningGoal: String(row.learningGoal), status: String(row.status), currentStep: number(row.currentStep),
        approvedAssessmentId: row.approvedAssessmentId ? String(row.approvedAssessmentId) : null,
        selectedStandardCount: number(row.selectedStandardCount), hasBlueprint: Boolean(row.hasBlueprint),
        validityBlocked: row.validityBlocked === null ? null : Boolean(row.validityBlocked),
        updatedAt: timestamp(row.updatedAt),
      }));
    },
    async create(ownerId: string, input: unknown) {
      if (!ownerId) throw new AppError(401, "교사 로그인이 필요합니다.");
      const value = designSessionCreateSchema.parse(input);
      const id = randomUUID();
      const rows = await query(`WITH inserted_session AS (
        INSERT INTO design_sessions (id, owner_id, title, grade, subject, learning_goal)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
      ), inserted_source AS (
        INSERT INTO design_sources (id, session_id, source_kind, file_name, mime_type, sha256, extracted_text)
        SELECT $7, id, $8, $9, $10, $11, $12 FROM inserted_session RETURNING id
      ) SELECT id FROM inserted_session`, [id, ownerId, value.title, value.grade, value.subject, value.learningGoal,
        randomUUID(), value.source.kind, value.source.fileName ?? null, value.source.mimeType ?? null, value.source.sha256 ?? null, value.source.text]);
      if (!rows[0]) throw new AppError(500, "평가 설계를 시작하지 못했습니다.");
      return get(id, ownerId);
    },
    async updateBasics(id: string, ownerId: string, input: { title?: string; learningGoal?: string; currentStep?: number }) {
      const rows = await query(`UPDATE design_sessions SET
        title = coalesce($3, title), learning_goal = coalesce($4, learning_goal), current_step = coalesce($5, current_step),
        status = CASE WHEN $3::text IS NOT NULL OR $4::text IS NOT NULL THEN 'draft' ELSE status END,
        validity_checked_at = CASE WHEN $3::text IS NOT NULL OR $4::text IS NOT NULL THEN NULL ELSE validity_checked_at END,
        updated_at = now()
        WHERE id = $1 AND owner_id = $2 AND status <> 'approved' RETURNING id`, [id, ownerId, input.title ?? null, input.learningGoal ?? null, input.currentStep ?? null]);
      if (!rows[0]) throw new AppError(409, "승인된 설계는 수정할 수 없거나 접근 권한이 없습니다.");
      return get(id, ownerId);
    },
    async saveSource(id: string, ownerId: string, source: { kind: "direct_text" | "upload"; fileName?: string | null; mimeType?: string | null; sha256?: string | null; text: string }) {
      const rows = await query(`INSERT INTO design_sources (id, session_id, source_kind, file_name, mime_type, sha256, extracted_text)
        SELECT $3, s.id, $4, $5, $6, $7, $8 FROM design_sessions s
        WHERE s.id = $1 AND s.owner_id = $2 AND s.status <> 'approved' RETURNING id`, [id, ownerId, randomUUID(), source.kind, source.fileName ?? null, source.mimeType ?? null, source.sha256 ?? null, source.text]);
      if (!rows[0]) throw new AppError(409, "자료를 저장할 수 없는 설계입니다.");
      await query("UPDATE design_sessions SET status = 'draft', validity_checked_at = NULL, updated_at = now() WHERE id = $1 AND owner_id = $2", [id, ownerId]);
      return get(id, ownerId);
    },
    async saveStandards(id: string, ownerId: string, standards: AlignmentCandidate[]) {
      const value = alignmentCandidateSchema.array().min(1).max(8).parse(standards);
      const rows = await query(`WITH authorized AS (
        SELECT id FROM design_sessions WHERE id = $1 AND owner_id = $2 AND status <> 'approved'
      ), cleared AS (
        DELETE FROM standard_alignment_candidates WHERE session_id IN (SELECT id FROM authorized)
      ), data AS (
        SELECT * FROM jsonb_to_recordset($3::jsonb)
          AS item(id uuid, standard_code text, domain text, standard_content text, rationale text, confidence numeric, state text)
      ), inserted AS (
        INSERT INTO standard_alignment_candidates (id, session_id, standard_code, domain, standard_content, rationale, confidence, state)
        SELECT data.id, authorized.id, data.standard_code, data.domain, data.standard_content, data.rationale, data.confidence, data.state
        FROM authorized CROSS JOIN data RETURNING id
      ) SELECT count(*)::int AS count FROM inserted`, [id, ownerId, JSON.stringify(value.map(item => ({ id: randomUUID(), standard_code: item.code, domain: item.domain, standard_content: item.content, rationale: item.rationale, confidence: item.confidence, state: item.state })))]);
      if (!rows[0] || number(rows[0].count) !== value.length) throw new AppError(409, "성취기준을 저장할 수 없는 설계입니다.");
      await query("UPDATE design_sessions SET current_step = greatest(current_step, 2), status = 'draft', validity_checked_at = NULL, updated_at = now() WHERE id = $1 AND owner_id = $2", [id, ownerId]);
      return get(id, ownerId);
    },
    async saveCompetency(id: string, ownerId: string, competency: CompetencyUnpack, source: DraftSource) {
      const value = competencyUnpackSchema.parse(competency);
      const rows = await query(`WITH authorized AS (
        SELECT id FROM design_sessions WHERE id = $1 AND owner_id = $2 AND status <> 'approved'
      ), inserted AS (
        INSERT INTO competency_unpacks (id, session_id, version, source, output)
        SELECT $3, a.id, coalesce((SELECT max(c.version) + 1 FROM competency_unpacks c WHERE c.session_id = a.id), 1), $4, $5::jsonb
        FROM authorized a RETURNING id
      ) SELECT id FROM inserted`, [id, ownerId, randomUUID(), source, JSON.stringify(value)]);
      if (!rows[0]) throw new AppError(409, "성공 기준을 저장할 수 없는 설계입니다.");
      await query("UPDATE design_sessions SET current_step = greatest(current_step, 3), status = 'draft', validity_checked_at = NULL, updated_at = now() WHERE id = $1 AND owner_id = $2", [id, ownerId]);
      return get(id, ownerId);
    },
    async saveBlueprint(id: string, ownerId: string, input: { rubric: RubricDraftItem[]; questions: QuestionDraft[]; source: DraftSource }) {
      const rubric = rubricDraftItemSchema.array().min(1).max(10).parse(input.rubric);
      const questions = questionDraftSchema.array().max(20).parse(input.questions);
      const rows = await query(`WITH authorized AS (
        SELECT id FROM design_sessions WHERE id = $1 AND owner_id = $2 AND status <> 'approved'
      ), inserted AS (
        INSERT INTO assessment_blueprints (id, session_id, version, source, rubric, questions)
        SELECT $3, a.id, coalesce((SELECT max(b.version) + 1 FROM assessment_blueprints b WHERE b.session_id = a.id), 1), $4, $5::jsonb, $6::jsonb
        FROM authorized a RETURNING id
      ) SELECT id FROM inserted`, [id, ownerId, randomUUID(), input.source, JSON.stringify(rubric), JSON.stringify(questions)]);
      if (!rows[0]) throw new AppError(409, "루브릭과 문항 초안을 저장할 수 없는 설계입니다.");
      await query("UPDATE design_sessions SET current_step = greatest(current_step, $3), status = 'draft', validity_checked_at = NULL, updated_at = now() WHERE id = $1 AND owner_id = $2", [id, ownerId, questions.length ? 5 : 4]);
      return get(id, ownerId);
    },
    async saveValidity(id: string, ownerId: string, validity: ValidityAudit, source: DraftSource) {
      const value = validityAuditSchema.parse(validity);
      const rows = await query(`WITH authorized AS (
        SELECT id FROM design_sessions WHERE id = $1 AND owner_id = $2 AND status <> 'approved'
      ), inserted AS (
        INSERT INTO validity_audits (id, session_id, version, source, output, blocked)
        SELECT $3, a.id, coalesce((SELECT max(v.version) + 1 FROM validity_audits v WHERE v.session_id = a.id), 1), $4, $5::jsonb, $6
        FROM authorized a RETURNING id
      ) SELECT id FROM inserted`, [id, ownerId, randomUUID(), source, JSON.stringify(value), value.blocked]);
      if (!rows[0]) throw new AppError(409, "타당도 점검 결과를 저장할 수 없는 설계입니다.");
      await query(`UPDATE design_sessions SET current_step = greatest(current_step, 6), status = $3,
        validity_checked_at = (SELECT created_at FROM validity_audits WHERE session_id = $1 ORDER BY version DESC LIMIT 1), updated_at = now()
        WHERE id = $1 AND owner_id = $2`, [id, ownerId, value.blocked ? "draft" : "ready"]);
      return get(id, ownerId);
    },
    async findCompletedGeneration(ownerId: string, sessionId: string, feature: DesignFeature, model: string, promptVersion: string, inputHash: string) {
      const rows = await query(`SELECT id, output_json AS output, input_tokens AS "inputTokens", output_tokens AS "outputTokens", total_tokens AS "totalTokens"
        FROM design_generation_runs WHERE owner_id = $1 AND session_id = $2 AND feature = $3 AND model = $4
          AND prompt_version = $5 AND input_hash = $6 AND status = 'complete' ORDER BY created_at DESC LIMIT 1`, [ownerId, sessionId, feature, model, promptVersion, inputHash]);
      return rows[0] ?? null;
    },
    async beginGeneration(ownerId: string, sessionId: string, input: { feature: DesignFeature; model: string; promptVersion: string; inputHash: string; inputJson: unknown }) {
      const runId = randomUUID();
      const rows = await query(`INSERT INTO design_generation_runs (id, session_id, owner_id, feature, model, prompt_version, input_hash, input_json)
        SELECT $3, id, $2, $4, $5, $6, $7, $8::jsonb FROM design_sessions
        WHERE id = $1 AND owner_id = $2 AND status <> 'approved' RETURNING id`, [sessionId, ownerId, runId, input.feature, input.model, input.promptVersion, input.inputHash, JSON.stringify(input.inputJson)]);
      if (!rows[0]) throw new AppError(409, "AI 초안을 생성할 수 없는 설계입니다.");
      return runId;
    },
    async completeGeneration(runId: string, ownerId: string, input: { output: unknown; usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; latencyMs: number; providerMetadata?: unknown }) {
      const rows = await query(`UPDATE design_generation_runs SET status = 'complete', output_json = $3::jsonb,
        input_tokens = $4, output_tokens = $5, total_tokens = $6, latency_ms = $7, provider_metadata = $8::jsonb, completed_at = now()
        WHERE id = $1 AND owner_id = $2 AND status = 'pending' RETURNING id`, [runId, ownerId, JSON.stringify(input.output), input.usage.inputTokens ?? null, input.usage.outputTokens ?? null, input.usage.totalTokens ?? null, input.latencyMs, JSON.stringify(input.providerMetadata ?? {})]);
      if (!rows[0]) throw new AppError(409, "AI 생성 실행이 이미 완료되었습니다.");
    },
    async failGeneration(runId: string, ownerId: string, input: { code: string; message: string; latencyMs: number }) {
      await query(`UPDATE design_generation_runs SET status = 'error', error_code = $3, error_message = $4, latency_ms = $5, completed_at = now()
        WHERE id = $1 AND owner_id = $2 AND status = 'pending'`, [runId, ownerId, input.code.slice(0, 80), input.message.slice(0, 500), input.latencyMs]);
    },
    async approve(id: string, ownerId: string, definition: AssessmentDefinition) {
      const assessmentId = randomUUID();
      const shareCode = randomBytes(8).toString("hex").toUpperCase();
      const rows = await query(`WITH target AS (
        SELECT id, approved_assessment_id, validity_checked_at FROM design_sessions WHERE id = $1 AND owner_id = $2 FOR UPDATE
      ), inserted AS (
        INSERT INTO assessments (id, owner_id, share_code, definition)
        SELECT $3, $2, $4, $5::jsonb FROM target
        WHERE approved_assessment_id IS NULL AND validity_checked_at IS NOT NULL AND
          (SELECT NOT v.blocked FROM validity_audits v WHERE v.session_id = target.id ORDER BY v.version DESC LIMIT 1)
        RETURNING id
      ), updated AS (
        UPDATE design_sessions s SET status = 'approved', current_step = 7, approved_assessment_id = inserted.id, updated_at = now()
        FROM inserted WHERE s.id = $1 RETURNING inserted.id
      ) SELECT id FROM updated UNION ALL SELECT approved_assessment_id AS id FROM target WHERE approved_assessment_id IS NOT NULL LIMIT 1`, [id, ownerId, assessmentId, shareCode, JSON.stringify(definition)]);
      if (!rows[0]) throw new AppError(409, "중대한 타당도 경고를 해결하고 최신 점검을 완료한 뒤 승인해 주세요.");
      return String(rows[0].id);
    },
  };
}
