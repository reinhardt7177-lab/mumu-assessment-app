import { randomUUID } from "node:crypto";
import { AppError } from "../lib/assessment-domain";
import {
  POLICY_VERSION,
  evidencePolicyInputSchema,
  teacherCorrectionInputSchema,
  type EvidenceDerivationRecord,
  type EvidencePolicy,
  type ResponseEvidenceRecord,
} from "../lib/evidence-domain";
import type { Query } from "./repository";

const timestamp = (value: unknown) => value == null ? null : value instanceof Date ? value.toISOString() : String(value);
const number = (value: unknown) => Number(value ?? 0);

function responseRecord(row: Record<string, unknown>): ResponseEvidenceRecord {
  const assets = Array.isArray(row.assets) ? row.assets : [];
  const derivations = Array.isArray(row.derivations) ? row.derivations : [];
  const chat = row.chat && typeof row.chat === "object" ? row.chat as Record<string, unknown> : null;
  return {
    id: String(row.id),
    attemptId: String(row.attemptId),
    questionId: String(row.questionId),
    modality: row.modality as ResponseEvidenceRecord["modality"],
    assistanceLevel: row.assistanceLevel as ResponseEvidenceRecord["assistanceLevel"],
    state: row.state as ResponseEvidenceRecord["state"],
    assets: assets.map(item => {
      const asset = item as Record<string, unknown>;
      return {
        id: String(asset.id), responseEvidenceId: String(row.id), originalFilename: String(asset.originalFilename),
        mimeType: String(asset.mimeType), byteSize: number(asset.byteSize), sha256: String(asset.sha256),
        identifiersRemovedConfirmed: Boolean(asset.identifiersRemovedConfirmed),
        durationSeconds: asset.durationSeconds == null ? null : number(asset.durationSeconds), createdAt: timestamp(asset.createdAt)!,
      };
    }),
    derivations: derivations.map(item => {
      const derivation = item as Record<string, unknown>;
      return {
        id: String(derivation.id), responseEvidenceId: String(row.id), kind: derivation.kind as EvidenceDerivationRecord["kind"],
        model: String(derivation.model), promptVersion: String(derivation.promptVersion), status: derivation.status as EvidenceDerivationRecord["status"],
        extractedText: derivation.extractedText == null ? null : String(derivation.extractedText),
        confidence: derivation.confidence == null ? null : Number(derivation.confidence),
        segments: Array.isArray(derivation.segments) ? derivation.segments as EvidenceDerivationRecord["segments"] : [],
        errorCode: derivation.errorCode == null ? null : String(derivation.errorCode),
        errorMessage: derivation.errorMessage == null ? null : String(derivation.errorMessage),
        correctionReason: derivation.correctionReason == null ? null : String(derivation.correctionReason),
        createdAt: timestamp(derivation.createdAt)!, completedAt: timestamp(derivation.completedAt),
      };
    }),
    chat: chat ? {
      id: String(chat.id), state: chat.state as "active" | "submitted", elapsedSeconds: number(chat.elapsedSeconds),
      helpCount: number(chat.helpCount), messages: (Array.isArray(chat.messages) ? chat.messages : []).map(item => {
        const message = item as Record<string, unknown>;
        return {
          id: String(message.id), sequence: number(message.sequence), role: message.role as "student" | "assistant",
          content: String(message.content), helpType: message.helpType as "none" | "prompt" | "step_hint" | "example",
          elapsedSeconds: number(message.elapsedSeconds), createdAt: timestamp(message.createdAt)!,
        };
      }),
    } : null,
    createdAt: timestamp(row.createdAt)!,
    updatedAt: timestamp(row.updatedAt)!,
  };
}

const responseColumns = `r.id, r.attempt_id AS "attemptId", r.question_id AS "questionId", r.modality,
  r.assistance_level AS "assistanceLevel", r.state, r.created_at AS "createdAt", r.updated_at AS "updatedAt",
  coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id', asset.id, 'originalFilename', asset.original_filename, 'mimeType', asset.mime_type,
    'byteSize', asset.byte_size, 'sha256', asset.sha256,
    'identifiersRemovedConfirmed', asset.identifiers_removed_confirmed, 'durationSeconds', asset.duration_seconds,
    'createdAt', asset.created_at
  ) ORDER BY asset.created_at DESC) FROM evidence_assets asset WHERE asset.response_evidence_id = r.id), '[]') AS assets,
  coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id', derivation.id, 'kind', derivation.kind, 'model', derivation.model,
    'promptVersion', derivation.prompt_version, 'status', derivation.status,
    'extractedText', derivation.extracted_text, 'confidence', derivation.confidence,
    'segments', derivation.segments, 'errorCode', derivation.error_code,
    'errorMessage', derivation.error_message, 'correctionReason', derivation.correction_reason, 'createdAt', derivation.created_at,
    'completedAt', derivation.completed_at
  ) ORDER BY derivation.created_at DESC) FROM evidence_derivations derivation WHERE derivation.response_evidence_id = r.id), '[]') AS derivations,
  (SELECT jsonb_build_object(
    'id', session.id, 'state', session.state, 'elapsedSeconds', session.elapsed_seconds,
    'helpCount', (SELECT count(*) FROM assessment_chat_messages help WHERE help.session_id = session.id AND help.role = 'assistant' AND help.help_type <> 'none'),
    'messages', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', message.id, 'sequence', message.sequence, 'role', message.role, 'content', message.content,
      'helpType', message.help_type, 'elapsedSeconds', message.elapsed_seconds, 'createdAt', message.created_at
    ) ORDER BY message.sequence) FROM assessment_chat_messages message WHERE message.session_id = session.id), '[]')
  ) FROM assessment_chat_sessions session WHERE session.response_evidence_id = r.id) AS chat`;

export function createEvidenceRepository(query: Query) {
  const listAttemptResponses = async (attemptId: string) => {
    const rows = await query(`SELECT ${responseColumns} FROM attempt_response_evidence r WHERE r.attempt_id = $1 ORDER BY r.question_id, r.created_at`, [attemptId]);
    return rows.map(responseRecord);
  };

  return {
    async getPolicy(ownerId: string): Promise<EvidencePolicy> {
      const rows = await query(`SELECT student_evidence_ai_enabled AS enabled, provider_id AS "providerId", acknowledgement,
        policy_version AS "policyVersion", acknowledged_at AS "acknowledgedAt",
        retention_days AS "retentionDays" FROM teacher_evidence_policies WHERE owner_id = $1`, [ownerId]);
      const row = rows[0];
      const providerId = row?.providerId == null ? "disabled" : String(row.providerId);
      return {
        enabled: Boolean(row?.enabled), providerId,
        acknowledgement: row?.acknowledgement == null ? null : String(row.acknowledgement),
        policyVersion: row?.policyVersion == null ? null : String(row.policyVersion), acknowledgedAt: timestamp(row?.acknowledgedAt),
        retentionDays: number(row?.retentionDays ?? 90), storageConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
        aiConfigured: providerId !== "disabled",
      };
    },

    async savePolicy(ownerId: string, input: unknown): Promise<EvidencePolicy> {
      const parsed = evidencePolicyInputSchema.safeParse(input);
      if (!parsed.success) throw new AppError(400, parsed.error.issues[0]?.message ?? "학생 증거 AI 사용 설정을 확인해 주세요.");
      const value = parsed.data;
      await query(`INSERT INTO teacher_evidence_policies (
        owner_id, student_evidence_ai_enabled, provider_id, acknowledgement, policy_version, acknowledged_at, retention_days, updated_at
      ) VALUES ($1, $2, $3, $4, $5, CASE WHEN $2 THEN now() ELSE NULL END, $6, now())
      ON CONFLICT (owner_id) DO UPDATE SET
        student_evidence_ai_enabled = excluded.student_evidence_ai_enabled,
        provider_id = excluded.provider_id,
        acknowledgement = excluded.acknowledgement,
        policy_version = excluded.policy_version,
        acknowledged_at = excluded.acknowledged_at,
        retention_days = excluded.retention_days,
        updated_at = now()`, [ownerId, value.enabled, value.providerId, value.enabled ? value.acknowledgement : null, value.enabled ? POLICY_VERSION : null, value.retentionDays]);
      return this.getPolicy(ownerId);
    },

    listAttemptResponses,

    async getStudentPolicy(attemptId: string) {
      const rows = await query(`SELECT coalesce(policy.student_evidence_ai_enabled, false) AS enabled,
        coalesce(policy.provider_id, 'disabled') AS "providerId"
        FROM student_attempts attempt
        JOIN assessments assessment ON assessment.id = attempt.assessment_id
        LEFT JOIN teacher_evidence_policies policy ON policy.owner_id = assessment.owner_id
        WHERE attempt.id = $1`, [attemptId]);
      if (!rows[0]) throw new AppError(404, "학생 참여 정보를 찾을 수 없습니다.");
      return {
        enabled: Boolean(rows[0].enabled),
        storageConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
        aiConfigured: rows[0].providerId !== "disabled",
      };
    },

    async listOwnedAttemptResponses(attemptId: string, ownerId: string) {
      const owned = await query(`SELECT s.id FROM student_attempts s JOIN assessments a ON a.id = s.assessment_id WHERE s.id = $1 AND a.owner_id = $2`, [attemptId, ownerId]);
      if (!owned[0]) throw new AppError(404, "학생 답안을 찾을 수 없습니다.");
      return listAttemptResponses(attemptId);
    },

    async createAsset(attemptId: string, input: {
      questionId: string; modality: "photo" | "speech"; blobPathname: string; originalFilename: string;
      mimeType: string; byteSize: number; sha256: string; identifiersRemovedConfirmed: boolean; durationSeconds?: number | null;
    }) {
      const responseId = randomUUID();
      const assetId = randomUUID();
      const rows = await query(`WITH authorized AS (
        SELECT s.id AS attempt_id, a.owner_id,
          coalesce(policy.retention_days, 90) AS retention_days
        FROM student_attempts s
        JOIN assessments a ON a.id = s.assessment_id
        LEFT JOIN teacher_evidence_policies policy ON policy.owner_id = a.owner_id
        WHERE s.id = $1 AND s.status = 'in_progress' AND a.status = 'published'
          AND (a.definition->'methods') ? $3
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.definition->'questions') question WHERE question->>'id' = $2)
      ), response AS (
        INSERT INTO attempt_response_evidence (id, attempt_id, question_id, modality, state)
        SELECT $4, attempt_id, $2, $3, 'ready' FROM authorized
        ON CONFLICT (attempt_id, question_id, modality) DO UPDATE SET state = 'ready', updated_at = now()
        RETURNING *
      ), asset AS (
        INSERT INTO evidence_assets (
          id, response_evidence_id, blob_pathname, original_filename, mime_type,
          byte_size, sha256, identifiers_removed_confirmed, duration_seconds, retention_until
        ) SELECT $5, response.id, $6, $7, $8, $9, $10, $11, $12,
          now() + make_interval(days => authorized.retention_days)
        FROM response CROSS JOIN authorized RETURNING id
      ) SELECT response.id FROM response JOIN asset ON true`, [
        attemptId, input.questionId, input.modality, responseId, assetId, input.blobPathname,
        input.originalFilename, input.mimeType, input.byteSize, input.sha256, input.identifiersRemovedConfirmed, input.durationSeconds ?? null,
      ]);
      if (!rows[0]) throw new AppError(409, "평가 상태·문항·허용된 응답 방식을 확인해 주세요.");
      return { responseId: String(rows[0].id), assetId };
    },

    async getAssetForStudent(assetId: string, attemptId: string) {
      const rows = await query(`SELECT asset.blob_pathname AS "blobPathname", asset.mime_type AS "mimeType"
        FROM evidence_assets asset JOIN attempt_response_evidence response ON response.id = asset.response_evidence_id
        WHERE asset.id = $1 AND response.attempt_id = $2`, [assetId, attemptId]);
      if (!rows[0]) throw new AppError(404, "비공개 원본을 찾을 수 없습니다.");
      return rows[0] as { blobPathname: string; mimeType: string };
    },

    async getAssetForTeacher(assetId: string, ownerId: string) {
      const rows = await query(`SELECT asset.blob_pathname AS "blobPathname", asset.mime_type AS "mimeType"
        FROM evidence_assets asset
        JOIN attempt_response_evidence response ON response.id = asset.response_evidence_id
        JOIN student_attempts attempt ON attempt.id = response.attempt_id
        JOIN assessments assessment ON assessment.id = attempt.assessment_id
        WHERE asset.id = $1 AND assessment.owner_id = $2`, [assetId, ownerId]);
      if (!rows[0]) throw new AppError(404, "비공개 원본을 찾을 수 없습니다.");
      return rows[0] as { blobPathname: string; mimeType: string };
    },

    async getProcessingContext(responseId: string, attemptId: string) {
      const rows = await query(`SELECT response.id AS "responseId", response.modality, asset.blob_pathname AS "blobPathname",
        asset.mime_type AS "mimeType", asset.sha256 AS "assetSha256",
        asset.identifiers_removed_confirmed AS "identifiersRemovedConfirmed", assessment.owner_id AS "ownerId",
        question->>'prompt' AS "questionPrompt", assessment.definition->>'learningGoal' AS "learningGoal",
        coalesce(policy.student_evidence_ai_enabled, false) AS "policyEnabled",
        coalesce(policy.provider_id, 'disabled') AS "providerId"
        FROM attempt_response_evidence response
        JOIN student_attempts attempt ON attempt.id = response.attempt_id
        JOIN assessments assessment ON assessment.id = attempt.assessment_id
        JOIN LATERAL jsonb_array_elements(assessment.definition->'questions') question ON question->>'id' = response.question_id
        JOIN LATERAL (
          SELECT * FROM evidence_assets candidate WHERE candidate.response_evidence_id = response.id ORDER BY candidate.created_at DESC LIMIT 1
        ) asset ON true
        LEFT JOIN teacher_evidence_policies policy ON policy.owner_id = assessment.owner_id
        WHERE response.id = $1 AND response.attempt_id = $2 AND attempt.status = 'in_progress'`, [responseId, attemptId]);
      if (!rows[0]) throw new AppError(404, "처리할 학생 증거를 찾을 수 없습니다.");
      if (!rows[0].policyEnabled) throw new AppError(409, "학교 확인을 거쳐 교사가 학생 증거 AI 분석을 활성화해야 합니다.");
      if (!rows[0].identifiersRemovedConfirmed) throw new AppError(409, "이름·번호가 제거된 답안 원본인지 먼저 확인해 주세요.");
      if (rows[0].providerId === "disabled") throw new AppError(409, "교사가 외부 AI 제공자를 선택해야 합니다.");
      return rows[0] as { responseId: string; modality: "photo" | "speech"; blobPathname: string; mimeType: string; assetSha256: string; identifiersRemovedConfirmed: boolean; ownerId: string; questionPrompt: string; learningGoal: string; policyEnabled: boolean; providerId: string };
    },

    async saveTeacherCorrection(responseId: string, attemptId: string, ownerId: string, input: unknown) {
      const parsed = teacherCorrectionInputSchema.safeParse(input);
      if (!parsed.success) throw new AppError(400, parsed.error.issues[0]?.message ?? "수정한 변환 내용과 이유를 확인해 주세요.");
      const id = randomUUID();
      const rows = await query(`WITH authorized AS (
        SELECT response.id AS response_id, response.attempt_id
        FROM attempt_response_evidence response
        JOIN student_attempts attempt ON attempt.id = response.attempt_id
        JOIN assessments assessment ON assessment.id = attempt.assessment_id
        WHERE response.id = $1 AND response.attempt_id = $2 AND assessment.owner_id = $3
          AND response.modality IN ('photo', 'speech')
          AND EXISTS (SELECT 1 FROM evidence_derivations source WHERE source.response_evidence_id = response.id AND source.status = 'complete')
      ), prior AS (
        SELECT derivation.id FROM evidence_derivations derivation JOIN authorized ON authorized.response_id = derivation.response_evidence_id
        WHERE derivation.status = 'complete' ORDER BY derivation.created_at DESC LIMIT 1
      ), inserted AS (
        INSERT INTO evidence_derivations (
          id, response_evidence_id, kind, model, prompt_version, status,
          extracted_text, confidence, segments, supersedes_id, correction_reason, completed_at
        ) SELECT $4, response_id, 'teacher_correction', 'teacher', 'manual-verification-v1', 'complete',
          $5, NULL, '[]'::jsonb, (SELECT id FROM prior), $6, now() FROM authorized
        RETURNING *
      ), verified AS (
        UPDATE learning_evidence evidence SET transformation_status = 'teacher_verified', teacher_verified = true,
          transformed_text = coalesce(evidence.transformed_text, evidence.original_text)
        FROM authorized
        WHERE evidence.attempt_id = authorized.attempt_id
          AND NOT EXISTS (
            SELECT 1 FROM attempt_response_evidence other
            WHERE other.attempt_id = authorized.attempt_id AND other.modality IN ('photo', 'speech')
              AND other.id <> authorized.response_id
              AND NOT EXISTS (
                SELECT 1 FROM evidence_derivations correction
                WHERE correction.response_evidence_id = other.id AND correction.kind = 'teacher_correction' AND correction.status = 'complete'
              )
          )
        RETURNING evidence.id
      ) SELECT inserted.id, EXISTS (SELECT 1 FROM verified) AS "learningEvidenceVerified" FROM inserted`,
      [responseId, attemptId, ownerId, id, parsed.data.text, parsed.data.reason]);
      if (!rows[0]) throw new AppError(404, "확인할 OCR·전사 결과를 찾을 수 없습니다.");
      return { id, learningEvidenceVerified: Boolean(rows[0].learningEvidenceVerified), reason: parsed.data.reason };
    },

    async beginDerivation(responseId: string, kind: "ocr" | "transcript", model: string, promptVersion: string) {
      const id = randomUUID();
      const rows = await query(`INSERT INTO evidence_derivations (id, response_evidence_id, kind, model, prompt_version)
        SELECT $1, response.id, $3, $4, $5 FROM attempt_response_evidence response WHERE response.id = $2 AND response.state <> 'submitted'
        RETURNING id`, [id, responseId, kind, model, promptVersion]);
      if (!rows[0]) throw new AppError(409, "제출된 증거는 다시 처리할 수 없습니다.");
      return id;
    },

    async completeDerivation(id: string, input: { text: string; confidence: number | null; segments?: unknown[] }) {
      const rows = await query(`WITH completed AS (
        UPDATE evidence_derivations SET status = 'complete', extracted_text = $2, confidence = $3,
          segments = $4::jsonb, completed_at = now() WHERE id = $1 AND status = 'pending' RETURNING response_evidence_id
      ) UPDATE attempt_response_evidence response SET state = 'ready', updated_at = now()
        FROM completed WHERE response.id = completed.response_evidence_id RETURNING response.id`, [id, input.text, input.confidence, JSON.stringify(input.segments ?? [])]);
      if (!rows[0]) throw new AppError(409, "변환 실행이 이미 완료되었습니다.");
    },

    async failDerivation(id: string, code: string, message: string) {
      await query(`WITH failed AS (
        UPDATE evidence_derivations SET status = 'error', error_code = $2, error_message = $3, completed_at = now()
        WHERE id = $1 AND status = 'pending' RETURNING response_evidence_id
      ) UPDATE attempt_response_evidence response SET state = 'error', updated_at = now()
        FROM failed WHERE response.id = failed.response_evidence_id`, [id, code.slice(0, 80), message.slice(0, 500)]);
    },

    async createChatSession(attemptId: string, questionId: string) {
      const responseId = randomUUID();
      const sessionId = randomUUID();
      const rows = await query(`WITH authorized AS (
        SELECT attempt.id AS attempt_id
        FROM student_attempts attempt JOIN assessments assessment ON assessment.id = attempt.assessment_id
        JOIN teacher_evidence_policies policy ON policy.owner_id = assessment.owner_id AND policy.student_evidence_ai_enabled
        WHERE attempt.id = $1 AND attempt.status = 'in_progress' AND assessment.status = 'published'
          AND (assessment.definition->'methods') ? 'chat'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(assessment.definition->'questions') question WHERE question->>'id' = $2)
      ), response AS (
        INSERT INTO attempt_response_evidence (id, attempt_id, question_id, modality, assistance_level, state)
        SELECT $3, attempt_id, $2, 'chat', 'independent', 'ready' FROM authorized
        ON CONFLICT (attempt_id, question_id, modality) DO UPDATE SET updated_at = now()
        RETURNING *
      ), session AS (
        INSERT INTO assessment_chat_sessions (id, response_evidence_id)
        SELECT $4, response.id FROM response
        ON CONFLICT (response_evidence_id) DO UPDATE SET elapsed_seconds = assessment_chat_sessions.elapsed_seconds
        RETURNING *
      ) SELECT session.id AS "sessionId", response.id AS "responseId" FROM session JOIN response ON response.id = session.response_evidence_id`, [attemptId, questionId, responseId, sessionId]);
      if (!rows[0]) throw new AppError(409, "교사가 챗봇 평가를 활성화했는지 확인해 주세요.");
      return rows[0] as { sessionId: string; responseId: string };
    },

    async appendStudentChatMessage(sessionId: string, attemptId: string, content: string, elapsedSeconds: number) {
      const id = randomUUID();
      const rows = await query(`WITH target AS (
        SELECT session.id, coalesce(max(message.sequence), 0) + 1 AS sequence
        FROM assessment_chat_sessions session
        JOIN attempt_response_evidence response ON response.id = session.response_evidence_id AND response.attempt_id = $2
        LEFT JOIN assessment_chat_messages message ON message.session_id = session.id
        WHERE session.id = $1 AND session.state = 'active'
        GROUP BY session.id HAVING count(message.id) < 40
      ), inserted AS (
        INSERT INTO assessment_chat_messages (id, session_id, sequence, role, content, elapsed_seconds)
        SELECT $3, id, sequence, 'student', $4, $5 FROM target RETURNING *
      ) UPDATE assessment_chat_sessions session SET elapsed_seconds = GREATEST(session.elapsed_seconds, $5)
        FROM inserted WHERE session.id = inserted.session_id
        RETURNING inserted.id, inserted.sequence`, [sessionId, attemptId, id, content, elapsedSeconds]);
      if (!rows[0]) throw new AppError(409, "대화가 종료되었거나 최대 대화 수에 도달했습니다.");
      return { id, sequence: number(rows[0].sequence) };
    },

    async getChatContext(sessionId: string, attemptId: string) {
      const rows = await query(`SELECT assessment.definition, response.id AS "responseId",
        response.question_id AS "questionId", assessment.owner_id AS "ownerId",
        jsonb_build_array(attempt.student_label, roster.student_ref, roster.display_name,
          curriculum.student_ref, curriculum.display_name) AS "studentIdentifiers",
        coalesce(policy.student_evidence_ai_enabled, false) AS "policyEnabled",
        coalesce(policy.provider_id, 'disabled') AS "providerId",
        coalesce((SELECT jsonb_agg(jsonb_build_object('role', message.role, 'content', message.content, 'helpType', message.help_type) ORDER BY message.sequence)
          FROM assessment_chat_messages message WHERE message.session_id = session.id), '[]') AS messages
        FROM assessment_chat_sessions session
        JOIN attempt_response_evidence response ON response.id = session.response_evidence_id AND response.attempt_id = $2
        JOIN student_attempts attempt ON attempt.id = response.attempt_id
        JOIN assessments assessment ON assessment.id = attempt.assessment_id
        LEFT JOIN class_students roster ON roster.id = attempt.class_student_id
        LEFT JOIN curriculum_students curriculum ON curriculum.id = attempt.curriculum_student_id
        LEFT JOIN teacher_evidence_policies policy ON policy.owner_id = assessment.owner_id
        WHERE session.id = $1 AND session.state = 'active'`, [sessionId, attemptId]);
      if (!rows[0]) throw new AppError(404, "진행 중인 챗봇 대화를 찾을 수 없습니다.");
      if (!rows[0].policyEnabled) throw new AppError(409, "학교 확인을 거쳐 교사가 학생 증거 AI 분석을 활성화해야 합니다.");
      if (rows[0].providerId === "disabled") throw new AppError(409, "교사가 외부 AI 제공자를 선택해야 합니다.");
      return rows[0] as { definition: { learningGoal: string; questions: Array<{ id: string; prompt: string; criterion: string; standardCode: string }> }; responseId: string; questionId: string; ownerId: string; studentIdentifiers: Array<string | null>; policyEnabled: boolean; providerId: string; messages: Array<{ role: "student" | "assistant"; content: string; helpType: string }> };
    },

    async appendAssistantChatMessage(sessionId: string, content: string, helpType: "none" | "prompt" | "step_hint" | "example", elapsedSeconds: number) {
      const id = randomUUID();
      const assistance = helpType === "example" ? "example" : helpType === "step_hint" ? "step_hint" : "teacher_prompt";
      const rows = await query(`WITH inserted AS (
        INSERT INTO assessment_chat_messages (id, session_id, sequence, role, content, help_type, elapsed_seconds)
        SELECT $2, session.id, coalesce((SELECT max(sequence) FROM assessment_chat_messages WHERE session_id = session.id), 0) + 1,
          'assistant', $3, $4, $5 FROM assessment_chat_sessions session WHERE session.id = $1 AND session.state = 'active'
        RETURNING session_id, sequence
      ) UPDATE attempt_response_evidence response SET assistance_level = $6, updated_at = now()
        FROM assessment_chat_sessions session JOIN inserted ON inserted.session_id = session.id
        WHERE response.id = session.response_evidence_id RETURNING inserted.sequence`, [sessionId, id, content, helpType, elapsedSeconds, assistance]);
      if (!rows[0]) throw new AppError(409, "대화 상태가 바뀌었습니다.");
      return { id, sequence: number(rows[0].sequence) };
    },

    async beginAiRun(input: {
      ownerId: string; responseEvidenceId: string; chatSessionId?: string | null;
      feature: "ocr" | "transcript" | "chat_coach"; model: string; promptVersion: string; inputHash: string;
    }) {
      const id = randomUUID();
      const rows = await query(`INSERT INTO evidence_ai_runs (
        id, owner_id, response_evidence_id, chat_session_id, feature, model, prompt_version, input_hash
      ) SELECT $1, $2, response.id, $4, $5, $6, $7, $8
        FROM attempt_response_evidence response
        JOIN student_attempts attempt ON attempt.id = response.attempt_id
        JOIN assessments assessment ON assessment.id = attempt.assessment_id AND assessment.owner_id = $2
        WHERE response.id = $3 RETURNING id`, [id, input.ownerId, input.responseEvidenceId, input.chatSessionId ?? null, input.feature, input.model, input.promptVersion, input.inputHash]);
      if (!rows[0]) throw new AppError(404, "AI 분석할 학생 증거를 찾을 수 없습니다.");
      return id;
    },

    async completeAiRun(id: string, input: { inputTokens?: number; outputTokens?: number; totalTokens?: number; latencyMs: number; providerMetadata?: unknown }) {
      await query(`UPDATE evidence_ai_runs SET status = 'complete', input_tokens = $2, output_tokens = $3,
        total_tokens = $4, latency_ms = $5, provider_metadata = $6::jsonb, completed_at = now()
        WHERE id = $1 AND status = 'pending'`, [id, input.inputTokens ?? null, input.outputTokens ?? null, input.totalTokens ?? null, input.latencyMs, JSON.stringify(input.providerMetadata ?? {})]);
    },

    async failAiRun(id: string, input: { code: string; message: string; latencyMs: number }) {
      await query(`UPDATE evidence_ai_runs SET status = 'error', error_code = $2, error_message = $3,
        latency_ms = $4, completed_at = now() WHERE id = $1 AND status = 'pending'`, [id, input.code.slice(0, 80), input.message.slice(0, 500), input.latencyMs]);
    },
  };
}

export type EvidenceRepository = ReturnType<typeof createEvidenceRepository>;
