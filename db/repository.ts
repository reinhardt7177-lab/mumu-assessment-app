import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AppError, validateAnswers, validateAssessmentCreate, validateReview, type AssessmentRecord, type AttemptRecord, type ReviewRecord } from "../lib/assessment-domain";

export type Query = <T extends Record<string, unknown>>(text: string, parameters?: unknown[]) => Promise<T[]>;
export type QuestionGenerationRecord = {
  id: string;
  ownerId: string;
  model: string;
  promptVersion: string;
  inputHash: string;
  title: string;
  subject: string;
  learningGoal: string;
  standards: unknown[];
  requestedCount: number;
  status: "pending" | "complete" | "error";
  output: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};
const assessmentColumns = (status = "a.status", distribution = "NULL::jsonb") => `a.id, a.owner_id AS "ownerId", a.share_code AS "shareCode", a.definition, ${status} AS status, a.version, a.created_at AS "createdAt",
  (SELECT jsonb_build_object('eventId', event.id, 'termId', u.term_id, 'unitId', u.id, 'unitTitle', u.title)
    FROM assessment_events event JOIN curriculum_units u ON u.id = event.unit_id
    WHERE event.assessment_id = a.id LIMIT 1) AS "curriculumLink", ${distribution} AS distribution`;
const attemptColumns = `s.id, s.assessment_id AS "assessmentId", s.curriculum_student_id AS "curriculumStudentId",
  s.distribution_id AS "distributionId", s.class_student_id AS "classStudentId", s.student_label AS "studentLabel",
  s.answers, s.revision, s.status, s.time_spent_seconds AS "timeSpentSeconds", s.saved_at AS "savedAt", s.submitted_at AS "submittedAt"`;
const questionGenerationColumns = `id, owner_id AS "ownerId", model, prompt_version AS "promptVersion",
  input_hash AS "inputHash", title, subject, learning_goal AS "learningGoal", standards,
  requested_count AS "requestedCount", status, output, input_tokens AS "inputTokens",
  output_tokens AS "outputTokens", total_tokens AS "totalTokens", latency_ms AS "latencyMs",
  error_code AS "errorCode", error_message AS "errorMessage", created_at AS "createdAt",
  completed_at AS "completedAt"`;
const timestamp = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const assessmentRecord = (r: Record<string, unknown>) => ({ ...r, curriculumLink: r.curriculumLink ?? null, distribution: r.distribution ?? null, createdAt: timestamp(r.createdAt), submittedCount: Number(r.submittedCount ?? 0), pendingCount: Number(r.pendingCount ?? 0) }) as AssessmentRecord;
const attemptRecord = (r: Record<string, unknown>) => ({ ...r, savedAt: timestamp(r.savedAt), submittedAt: r.submittedAt ? timestamp(r.submittedAt) : null }) as AttemptRecord;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const nullableNumber = (value: unknown) => value === null || value === undefined ? null : Number(value);
const questionGenerationRecord = (row: Record<string, unknown>) => ({
  ...row,
  standards: Array.isArray(row.standards) ? row.standards : [],
  requestedCount: Number(row.requestedCount),
  inputTokens: nullableNumber(row.inputTokens),
  outputTokens: nullableNumber(row.outputTokens),
  totalTokens: nullableNumber(row.totalTokens),
  latencyMs: nullableNumber(row.latencyMs),
  createdAt: timestamp(row.createdAt),
  completedAt: row.completedAt ? timestamp(row.completedAt) : null,
}) as QuestionGenerationRecord;

export function createAssessmentRepository(query: Query) {
  async function getOwned(id: string, ownerId: string) {
    const rows = await query(`SELECT ${assessmentColumns()} FROM assessments a WHERE a.id = $1 AND a.owner_id = $2`, [id, ownerId]);
    if (!rows[0]) throw new AppError(404, "평가를 찾을 수 없거나 접근 권한이 없습니다.");
    return assessmentRecord(rows[0]);
  }
  async function getByCode(code: string) {
    const accessStatus = `CASE WHEN d.id IS NOT NULL THEN
      CASE WHEN a.status = 'closed' OR d.status = 'closed' OR (d.closes_at IS NOT NULL AND d.closes_at <= now()) THEN 'closed' ELSE 'published' END
      ELSE a.status END`;
    const distribution = `CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', d.id, 'classId', c.id, 'className', c.name, 'schoolYear', c.school_year, 'grade', c.grade,
      'instructions', d.instructions, 'closesAt', d.closes_at,
      'totalStudents', (SELECT count(*)::int FROM class_students roster WHERE roster.class_id = c.id AND roster.active)
    ) END`;
    const rows = await query(`SELECT ${assessmentColumns(accessStatus, distribution)}
      FROM assessments a
      LEFT JOIN assessment_distributions d ON d.assessment_id = a.id AND d.share_code = $1
      LEFT JOIN teacher_classes c ON c.id = d.class_id
      WHERE (a.share_code = $1 AND a.status IN ('published', 'closed'))
        OR (d.id IS NOT NULL AND a.status IN ('published', 'closed') AND d.status IN ('open', 'closed'))`, [code]);
    if (!rows[0]) throw new AppError(404, "아직 공개되지 않았거나 존재하지 않는 평가입니다.");
    return assessmentRecord(rows[0]);
  }
  async function getAttempt(code: string, token: string) {
    const rows = await query(`SELECT ${attemptColumns}
      FROM student_attempts s
      JOIN assessments a ON a.id = s.assessment_id
      LEFT JOIN assessment_distributions d ON d.id = s.distribution_id
      WHERE s.token_hash = $2
        AND ((s.distribution_id IS NULL AND a.share_code = $1) OR d.share_code = $1)`, [code, hashToken(token)]);
    if (!rows[0]) throw new AppError(401, "이 기기의 참여 정보가 없습니다. 선생님께 문의해 주세요.");
    return attemptRecord(rows[0]);
  }
  return {
    getOwned, getByCode, getAttempt,
    async consumeLimit(key: string, limit: number, windowSeconds: number) {
      const rows = await query(`INSERT INTO request_limits (key, bucket, requests)
        VALUES ($1, floor(extract(epoch FROM now()) / $3)::bigint, 1)
        ON CONFLICT (key) DO UPDATE SET bucket = EXCLUDED.bucket,
        requests = CASE WHEN request_limits.bucket = EXCLUDED.bucket THEN request_limits.requests + 1 ELSE 1 END
        WHERE request_limits.bucket <> EXCLUDED.bucket OR request_limits.requests < $2
        RETURNING requests`, [key, limit, windowSeconds]);
      if (!rows[0]) throw new AppError(429, "이 기능의 시간당 요청 한도에 도달했습니다. 잠시 뒤 다시 시도해 주세요.");
    },
    async findCompletedQuestionGeneration(ownerId: string, model: string, promptVersion: string, inputHash: string) {
      const rows = await query(`SELECT ${questionGenerationColumns}
        FROM ai_question_generation_runs
        WHERE owner_id = $1 AND model = $2 AND prompt_version = $3 AND input_hash = $4 AND status = 'complete'
        ORDER BY created_at DESC LIMIT 1`, [ownerId, model, promptVersion, inputHash]);
      return rows[0] ? questionGenerationRecord(rows[0]) : null;
    },
    async listQuestionGenerations(ownerId: string, limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new AppError(400, "조회할 AI 문항 이력 수를 확인해 주세요.");
      const rows = await query(`SELECT ${questionGenerationColumns}
        FROM ai_question_generation_runs
        WHERE owner_id = $1 AND status = 'complete'
        ORDER BY created_at DESC LIMIT $2`, [ownerId, limit]);
      return rows.map(questionGenerationRecord);
    },
    async getQuestionGeneration(id: string, ownerId: string) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new AppError(404, "AI 문항 생성 이력을 찾을 수 없습니다.");
      }
      const rows = await query(`SELECT ${questionGenerationColumns}
        FROM ai_question_generation_runs WHERE id = $1 AND owner_id = $2 AND status = 'complete'`, [id, ownerId]);
      if (!rows[0]) throw new AppError(404, "AI 문항 생성 이력을 찾을 수 없거나 접근 권한이 없습니다.");
      return questionGenerationRecord(rows[0]);
    },
    async beginQuestionGeneration(ownerId: string, input: {
      model: string;
      promptVersion: string;
      inputHash: string;
      title: string;
      subject: string;
      learningGoal: string;
      standards: unknown[];
      count: number;
    }) {
      if (!ownerId || !input.model || input.model.length > 120 || !input.promptVersion || input.promptVersion.length > 80 || !/^[0-9a-f]{64}$/.test(input.inputHash)
        || !Number.isInteger(input.count) || input.count < 1 || input.count > 5 || !Array.isArray(input.standards) || input.standards.length < 1) {
        throw new AppError(400, "AI 문항 생성 실행 정보를 확인해 주세요.");
      }
      const rows = await query(`INSERT INTO ai_question_generation_runs (
        id, owner_id, model, prompt_version, input_hash, title, subject, learning_goal, standards, requested_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      RETURNING ${questionGenerationColumns}`, [randomUUID(), ownerId, input.model, input.promptVersion, input.inputHash,
        input.title, input.subject, input.learningGoal, JSON.stringify(input.standards), input.count]);
      return questionGenerationRecord(rows[0]);
    },
    async completeQuestionGeneration(id: string, ownerId: string, input: {
      output: unknown;
      usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      latencyMs: number;
      providerMetadata?: Record<string, unknown>;
    }) {
      const usage = input.usage;
      const values = [usage.inputTokens, usage.outputTokens, usage.totalTokens, input.latencyMs].filter(value => value !== undefined);
      if (!input.output || values.some(value => !Number.isInteger(value) || Number(value) < 0)) throw new AppError(400, "AI 문항 생성 결과와 사용량을 확인해 주세요.");
      const rows = await query(`UPDATE ai_question_generation_runs SET status = 'complete', output = $3::jsonb,
        input_tokens = $4, output_tokens = $5, total_tokens = $6, latency_ms = $7,
        provider_metadata = $8::jsonb, completed_at = now()
        WHERE id = $1 AND owner_id = $2 AND status = 'pending'
        RETURNING ${questionGenerationColumns}`, [id, ownerId, JSON.stringify(input.output), usage.inputTokens ?? null,
        usage.outputTokens ?? null, usage.totalTokens ?? null, input.latencyMs, JSON.stringify(input.providerMetadata ?? {})]);
      if (!rows[0]) throw new AppError(409, "AI 문항 생성 실행이 이미 완료되었거나 접근할 수 없습니다.");
      return questionGenerationRecord(rows[0]);
    },
    async failQuestionGeneration(id: string, ownerId: string, input: { errorCode: string; errorMessage: string; latencyMs: number }) {
      if (!input.errorCode || input.errorCode.length > 80 || !input.errorMessage || input.errorMessage.length > 500 || !Number.isInteger(input.latencyMs) || input.latencyMs < 0) {
        throw new AppError(400, "AI 문항 생성 실패 기록을 확인해 주세요.");
      }
      const rows = await query(`UPDATE ai_question_generation_runs SET status = 'error', error_code = $3,
        error_message = $4, latency_ms = $5, completed_at = now()
        WHERE id = $1 AND owner_id = $2 AND status = 'pending'
        RETURNING ${questionGenerationColumns}`, [id, ownerId, input.errorCode, input.errorMessage, input.latencyMs]);
      return rows[0] ? questionGenerationRecord(rows[0]) : null;
    },
    async list(ownerId: string) {
      const rows = await query(`SELECT ${assessmentColumns()},
        (SELECT count(*) FROM student_attempts s WHERE s.assessment_id = a.id AND s.status = 'submitted') AS "submittedCount",
        (SELECT count(*) FROM student_attempts s LEFT JOIN teacher_reviews r ON r.attempt_id = s.id WHERE s.assessment_id = a.id AND s.status = 'submitted' AND (r.state IS NULL OR r.state = 'draft')) AS "pendingCount"
        FROM assessments a WHERE a.owner_id = $1 ORDER BY a.created_at DESC LIMIT 200`, [ownerId]);
      return rows.map(assessmentRecord);
    },
    async create(ownerId: string, input: unknown) {
      if (!ownerId) throw new AppError(401, "교사 로그인이 필요합니다.");
      const { definition, curriculumLink } = validateAssessmentCreate(input);
      const id = randomUUID();
      const shareCode = randomBytes(8).toString("hex").toUpperCase();
      if (!curriculumLink) {
        await query(`INSERT INTO assessments (id, owner_id, share_code, definition) VALUES ($1, $2, $3, $4::jsonb)`, [id, ownerId, shareCode, JSON.stringify(definition)]);
        return getOwned(id, ownerId);
      }
      const rows = await query(`WITH authorized AS (
        SELECT u.id FROM curriculum_units u
        JOIN curriculum_terms t ON t.id = u.term_id
        WHERE u.id = $5 AND t.owner_id = $2 AND t.status <> 'closed'
          AND concat(t.grade, '학년 ', t.subject) = $6
          AND (SELECT count(*) FROM unit_standards us
            WHERE us.unit_id = u.id AND us.standard_code IN (SELECT jsonb_array_elements_text($7::jsonb))) = $8
          AND NOT EXISTS (
            SELECT 1 FROM unit_standards us
            WHERE us.unit_id = u.id AND us.standard_code IN (SELECT jsonb_array_elements_text($7::jsonb))
              AND NOT EXISTS (SELECT 1 FROM rubric_versions rv WHERE rv.unit_standard_id = us.id AND rv.state = 'locked')
          )
      ), inserted_assessment AS (
        INSERT INTO assessments (id, owner_id, share_code, definition)
        SELECT $1, $2, $3, $4::jsonb FROM authorized RETURNING id
      ), inserted_event AS (
        INSERT INTO assessment_events (id, unit_id, assessment_id, event_type, title, context, occurred_at, created_by)
        SELECT $9, authorized.id, inserted_assessment.id, $10, $11, $12, $13::timestamptz, $2
        FROM authorized CROSS JOIN inserted_assessment RETURNING id
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $14, $2, $2, 'assessment.linked', 'assessment_event', id,
          jsonb_build_object('assessmentId', $1::uuid, 'unitId', $5::uuid, 'standardCount', $8::int)
        FROM inserted_event
      ) SELECT id FROM inserted_assessment`, [
        id, ownerId, shareCode, JSON.stringify(definition), curriculumLink.unitId, definition.subject,
        JSON.stringify(definition.standardCodes), definition.standardCodes.length, randomUUID(),
        curriculumLink.eventType, definition.title, curriculumLink.context, curriculumLink.occurredAt, randomUUID(),
      ]);
      if (!rows[0]) throw new AppError(409, "선택한 단원·성취기준과 잠긴 루브릭 연결을 확인해 주세요.");
      return getOwned(id, ownerId);
    },
    async setStatus(id: string, ownerId: string, status: "published" | "closed") {
      const assessment = await getOwned(id, ownerId);
      if (assessment.status === status) return assessment;
      if (status === "published" && assessment.definition.methods.some(m => m !== "text")) throw new AppError(409, "사진·녹음·대화 저장 연결 전에는 글쓰기 평가만 배포할 수 있습니다.");
      const from = status === "published" ? "draft" : "published";
      const rows = await query(`UPDATE assessments AS a SET status = $3, published_at = CASE WHEN $3 = 'published' THEN now() ELSE published_at END, closed_at = CASE WHEN $3 = 'closed' THEN now() ELSE NULL END WHERE a.id = $1 AND a.owner_id = $2 AND a.status = $4 RETURNING a.id`, [id, ownerId, status, from]);
      if (!rows[0]) throw new AppError(409, "평가 상태가 변경되었습니다. 새로고침해 주세요. 마감한 평가는 다시 열 수 없습니다.");
      return getOwned(id, ownerId);
    },
    async startAttempt(code: string, studentLabel: string) {
      const label = studentLabel.trim();
      if (!label || label.length > 40) throw new AppError(400, "번호 또는 별칭을 1~40자로 입력해 주세요.");
      const token = randomBytes(32).toString("base64url");
      const rows = await query(`WITH access AS (
        SELECT a.id AS assessment_id, NULL::uuid AS distribution_id, NULL::uuid AS class_id, u.term_id
        FROM assessments a
        LEFT JOIN assessment_events event ON event.assessment_id = a.id
        LEFT JOIN curriculum_units u ON u.id = event.unit_id
        WHERE a.share_code = $2 AND a.status = 'published'
        UNION ALL
        SELECT a.id, d.id, d.class_id, u.term_id
        FROM assessment_distributions d
        JOIN assessments a ON a.id = d.assessment_id
        LEFT JOIN assessment_events event ON event.assessment_id = a.id
        LEFT JOIN curriculum_units u ON u.id = event.unit_id
        WHERE d.share_code = $2 AND d.status = 'open' AND a.status = 'published'
          AND (d.closes_at IS NULL OR d.closes_at > now())
      ), resolved AS (
        SELECT access.assessment_id, access.distribution_id, roster.id AS class_student_id,
          curriculum.id AS curriculum_student_id,
          CASE WHEN access.distribution_id IS NOT NULL THEN roster.display_name
            WHEN access.term_id IS NOT NULL THEN curriculum.display_name ELSE $3 END AS student_label
        FROM access
        LEFT JOIN class_students roster ON roster.class_id = access.class_id
          AND roster.student_ref = $3 AND roster.active
        LEFT JOIN curriculum_students curriculum ON curriculum.term_id = access.term_id
          AND curriculum.active AND (
            (access.distribution_id IS NOT NULL AND (curriculum.class_student_id = roster.id OR curriculum.student_ref = roster.student_ref))
            OR (access.distribution_id IS NULL AND curriculum.student_ref = $3)
          )
        WHERE (access.distribution_id IS NULL AND access.term_id IS NULL)
          OR (access.distribution_id IS NULL AND access.term_id IS NOT NULL AND curriculum.id IS NOT NULL)
          OR (access.distribution_id IS NOT NULL AND roster.id IS NOT NULL AND (access.term_id IS NULL OR curriculum.id IS NOT NULL))
      ), inserted AS (
        INSERT INTO student_attempts AS s (
          id, assessment_id, distribution_id, class_student_id, curriculum_student_id, student_label, token_hash
        )
        SELECT $1, assessment_id, distribution_id, class_student_id, curriculum_student_id, student_label, $4 FROM resolved
        ON CONFLICT DO NOTHING
        RETURNING s.*
      ) SELECT ${attemptColumns} FROM inserted s`, [randomUUID(), code, label, hashToken(token)]);
      if (!rows[0]) throw new AppError(409, "평가 상태, 학생 참조 번호 또는 이미 시작한 참여 기록을 확인해 주세요.");
      return { token, attempt: attemptRecord(rows[0]) };
    },
    async saveAttempt(code: string, token: string, input: { answers: unknown; revision: number; timeSpentSeconds: number; submit?: boolean }) {
      const [assessment, existing] = await Promise.all([getByCode(code), getAttempt(code, token)]);
      // Retrying a successful submission never creates a second response or rewrites it.
      if (existing.status === "submitted" && input.submit) return existing;
      if (existing.status === "submitted") throw new AppError(409, "이미 제출한 답안은 수정할 수 없습니다.");
      if (assessment.status !== "published") throw new AppError(409, "마감된 평가는 더 이상 저장할 수 없습니다.");
      if (!Number.isInteger(input.revision) || !Number.isInteger(input.timeSpentSeconds) || input.timeSpentSeconds < 0 || input.timeSpentSeconds > 86400) throw new AppError(400, "저장 정보가 올바르지 않습니다.");
      const answers = validateAnswers(input.answers, assessment.definition, Boolean(input.submit));
      const rows = await query(`WITH saved AS (
        UPDATE student_attempts AS s SET answers = $3::jsonb, revision = s.revision + 1, saved_at = now(),
          time_spent_seconds = GREATEST(s.time_spent_seconds, $5), status = $6,
          submitted_at = CASE WHEN $6 = 'submitted' THEN now() ELSE NULL END
        FROM assessments a WHERE s.assessment_id = a.id AND s.token_hash = $2
          AND a.status = 'published' AND s.status = 'in_progress' AND s.revision = $4
          AND (
            (s.distribution_id IS NULL AND a.share_code = $1)
            OR EXISTS (
              SELECT 1 FROM assessment_distributions distribution
              WHERE distribution.id = s.distribution_id AND distribution.share_code = $1
                AND distribution.status = 'open'
                AND (distribution.closes_at IS NULL OR distribution.closes_at > now())
            )
          )
        RETURNING s.*
      ), linked AS (
        SELECT s.*, a.owner_id, a.definition, event.id AS event_id
        FROM saved s JOIN assessments a ON a.id = s.assessment_id
        LEFT JOIN assessment_events event ON event.assessment_id = a.id
      ), evidence AS (
        INSERT INTO learning_evidence (
          id, student_id, event_id, attempt_id, modality, source_kind, assistance_level,
          original_text, transformation_status, teacher_verified, collected_at, created_by
        )
        SELECT $7, linked.curriculum_student_id, linked.event_id, linked.id, 'text', 'student_response',
          CASE WHEN linked.definition->>'type' = '독립 수행평가' THEN 'independent' ELSE 'scaffolded' END,
          jsonb_build_object(
            'format', 'mumu.text.answers.v1', 'assessmentId', linked.assessment_id,
            'assessmentTitle', linked.definition->>'title',
            'answers', (
              SELECT coalesce(jsonb_agg(jsonb_build_object(
                'questionId', question->>'id', 'standardCode', question->>'standardCode',
                'criterion', question->>'criterion', 'prompt', question->>'prompt',
                'answer', linked.answers->>(question->>'id')
              ) ORDER BY ordinality), '[]'::jsonb)
              FROM jsonb_array_elements(linked.definition->'questions') WITH ORDINALITY AS item(question, ordinality)
            )
          )::text, 'original', false, linked.submitted_at, linked.owner_id
        FROM linked
        WHERE linked.status = 'submitted' AND linked.curriculum_student_id IS NOT NULL AND linked.event_id IS NOT NULL
        ON CONFLICT (attempt_id) WHERE attempt_id IS NOT NULL DO NOTHING
        RETURNING id, student_id, event_id, attempt_id, assistance_level
      ), audit AS (
        INSERT INTO curriculum_audit_events (id, owner_id, actor_id, event_type, entity_type, entity_id, metadata)
        SELECT $8, linked.owner_id, linked.owner_id, 'evidence.imported', 'learning_evidence', evidence.id,
          jsonb_build_object('attemptId', evidence.attempt_id, 'studentId', evidence.student_id,
            'eventId', evidence.event_id, 'assistanceLevel', evidence.assistance_level)
        FROM evidence JOIN linked ON linked.id = evidence.attempt_id
      ) SELECT ${attemptColumns} FROM saved s`,
      [code, hashToken(token), JSON.stringify(answers), input.revision, input.timeSpentSeconds,
        input.submit ? "submitted" : "in_progress", randomUUID(), randomUUID()]);
      if (!rows[0]) {
        const latest = await getAttempt(code, token);
        if (input.submit && latest.status === "submitted") return latest;
        throw new AppError(409, "다른 탭에서 답안이 바뀌었거나 평가가 마감되었습니다. 내용을 복사해 둔 뒤 새로고침해 주세요.");
      }
      return attemptRecord(rows[0]);
    },
    async submissions(id: string, ownerId: string, distributionId?: string) {
      await getOwned(id, ownerId);
      const rows = await query(`SELECT ${attemptColumns}, r.result AS review, r.updated_at AS "reviewUpdatedAt" FROM student_attempts s
        JOIN assessments a ON a.id = s.assessment_id LEFT JOIN teacher_reviews r ON r.attempt_id = s.id
        WHERE a.id = $1 AND a.owner_id = $2 AND s.status = 'submitted'
          AND ($3::uuid IS NULL OR EXISTS (
            SELECT 1 FROM assessment_distributions distribution
            JOIN teacher_classes classroom ON classroom.id = distribution.class_id
            WHERE distribution.id = $3 AND distribution.assessment_id = a.id
              AND classroom.owner_id = $2 AND s.distribution_id = distribution.id
          ))
        ORDER BY s.submitted_at DESC`, [id, ownerId, distributionId ?? null]);
      return rows.map(r => ({ ...attemptRecord(r), review: r.review ? { ...(r.review as object), attemptId: r.id, updatedAt: timestamp(r.reviewUpdatedAt) } as ReviewRecord : null }));
    },
    async saveReview(id: string, attemptId: string, ownerId: string, input: unknown) {
      const assessment = await getOwned(id, ownerId);
      const result = validateReview(input, assessment.definition);
      const rows = await query(`WITH authorized AS (
        SELECT s.id FROM student_attempts s JOIN assessments a ON a.id = s.assessment_id
        WHERE a.id = $1 AND a.owner_id = $2 AND s.id = $3 AND s.status = 'submitted'
      ), saved AS (
        INSERT INTO teacher_reviews (attempt_id, reviewer_id, result, state)
        SELECT id, $2, $4::jsonb, $5 FROM authorized WHERE $5 <> 'published' OR EXISTS (SELECT 1 FROM teacher_reviews prior WHERE prior.attempt_id = authorized.id AND prior.state = 'final')
        ON CONFLICT (attempt_id) DO UPDATE SET reviewer_id = EXCLUDED.reviewer_id, result = EXCLUDED.result, state = EXCLUDED.state, revision = teacher_reviews.revision + 1, updated_at = now()
        WHERE teacher_reviews.state <> 'published' AND (EXCLUDED.state <> 'published' OR (teacher_reviews.state = 'final' AND teacher_reviews.result - 'state' = EXCLUDED.result - 'state'))
        RETURNING attempt_id, result, updated_at
      ), audit AS (
        INSERT INTO review_events (id, attempt_id, reviewer_id, result) SELECT $6, attempt_id, $2, result FROM saved
      ) SELECT attempt_id AS "attemptId", result, updated_at AS "updatedAt" FROM saved`, [id, ownerId, attemptId, JSON.stringify(result), result.state, randomUUID()]);
      if (!rows[0]) throw new AppError(409, "저장할 수 없습니다. 제출 여부를 확인하고, 공개 전에는 변경한 점수와 피드백을 먼저 최종 확정해 주세요. 공개된 결과는 잠깁니다.");
      return { ...result, attemptId, updatedAt: timestamp(rows[0].updatedAt) };
    },
    async studentResult(code: string, token: string): Promise<ReviewRecord | null> {
      const rows = await query(`SELECT r.attempt_id AS "attemptId", r.result, r.updated_at AS "updatedAt" FROM teacher_reviews r
        JOIN student_attempts s ON s.id = r.attempt_id
        JOIN assessments a ON a.id = s.assessment_id
        LEFT JOIN assessment_distributions distribution ON distribution.id = s.distribution_id
        WHERE s.token_hash = $2 AND r.state = 'published'
          AND ((s.distribution_id IS NULL AND a.share_code = $1) OR distribution.share_code = $1)`, [code, hashToken(token)]);
      return rows[0] ? { ...(rows[0].result as Omit<ReviewRecord, "attemptId" | "updatedAt">), attemptId: String(rows[0].attemptId), updatedAt: timestamp(rows[0].updatedAt) } : null;
    },
  };
}
