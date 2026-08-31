import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AppError, validateAnswers, validateAssessment, validateReview, type AssessmentRecord, type AttemptRecord, type ReviewRecord } from "../lib/assessment-domain";

export type Query = <T extends Record<string, unknown>>(text: string, parameters?: unknown[]) => Promise<T[]>;
const assessmentColumns = `a.id, a.owner_id AS "ownerId", a.share_code AS "shareCode", a.definition, a.status, a.version, a.created_at AS "createdAt"`;
const attemptColumns = `s.id, s.assessment_id AS "assessmentId", s.student_label AS "studentLabel", s.answers, s.revision, s.status, s.time_spent_seconds AS "timeSpentSeconds", s.saved_at AS "savedAt", s.submitted_at AS "submittedAt"`;
const timestamp = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const assessmentRecord = (r: Record<string, unknown>) => ({ ...r, createdAt: timestamp(r.createdAt), submittedCount: Number(r.submittedCount ?? 0), pendingCount: Number(r.pendingCount ?? 0) }) as AssessmentRecord;
const attemptRecord = (r: Record<string, unknown>) => ({ ...r, savedAt: timestamp(r.savedAt), submittedAt: r.submittedAt ? timestamp(r.submittedAt) : null }) as AttemptRecord;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createAssessmentRepository(query: Query) {
  async function getOwned(id: string, ownerId: string) {
    const rows = await query(`SELECT ${assessmentColumns} FROM assessments a WHERE a.id = $1 AND a.owner_id = $2`, [id, ownerId]);
    if (!rows[0]) throw new AppError(404, "평가를 찾을 수 없거나 접근 권한이 없습니다.");
    return assessmentRecord(rows[0]);
  }
  async function getByCode(code: string) {
    const rows = await query(`SELECT ${assessmentColumns} FROM assessments a WHERE a.share_code = $1 AND a.status IN ('published', 'closed')`, [code]);
    if (!rows[0]) throw new AppError(404, "아직 공개되지 않았거나 존재하지 않는 평가입니다.");
    return assessmentRecord(rows[0]);
  }
  async function getAttempt(code: string, token: string) {
    const rows = await query(`SELECT ${attemptColumns} FROM student_attempts s JOIN assessments a ON a.id = s.assessment_id WHERE a.share_code = $1 AND s.token_hash = $2`, [code, hashToken(token)]);
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
    async list(ownerId: string) {
      const rows = await query(`SELECT ${assessmentColumns},
        (SELECT count(*) FROM student_attempts s WHERE s.assessment_id = a.id AND s.status = 'submitted') AS "submittedCount",
        (SELECT count(*) FROM student_attempts s LEFT JOIN teacher_reviews r ON r.attempt_id = s.id WHERE s.assessment_id = a.id AND s.status = 'submitted' AND (r.state IS NULL OR r.state = 'draft')) AS "pendingCount"
        FROM assessments a WHERE a.owner_id = $1 ORDER BY a.created_at DESC LIMIT 200`, [ownerId]);
      return rows.map(assessmentRecord);
    },
    async create(ownerId: string, input: unknown) {
      if (!ownerId) throw new AppError(401, "교사 로그인이 필요합니다.");
      const definition = validateAssessment(input);
      const rows = await query(`INSERT INTO assessments AS a (id, owner_id, share_code, definition) VALUES ($1, $2, $3, $4::jsonb) RETURNING ${assessmentColumns}`, [randomUUID(), ownerId, randomBytes(8).toString("hex").toUpperCase(), JSON.stringify(definition)]);
      return assessmentRecord(rows[0]);
    },
    async setStatus(id: string, ownerId: string, status: "published" | "closed") {
      const assessment = await getOwned(id, ownerId);
      if (assessment.status === status) return assessment;
      if (status === "published" && assessment.definition.methods.some(m => m !== "text")) throw new AppError(409, "사진·녹음·대화 저장 연결 전에는 글쓰기 평가만 배포할 수 있습니다.");
      const from = status === "published" ? "draft" : "published";
      const rows = await query(`UPDATE assessments AS a SET status = $3, published_at = CASE WHEN $3 = 'published' THEN now() ELSE published_at END, closed_at = CASE WHEN $3 = 'closed' THEN now() ELSE NULL END WHERE a.id = $1 AND a.owner_id = $2 AND a.status = $4 RETURNING ${assessmentColumns}`, [id, ownerId, status, from]);
      if (!rows[0]) throw new AppError(409, "평가 상태가 변경되었습니다. 새로고침해 주세요. 마감한 평가는 다시 열 수 없습니다.");
      return assessmentRecord(rows[0]);
    },
    async startAttempt(code: string, studentLabel: string) {
      const label = studentLabel.trim();
      if (!label || label.length > 40) throw new AppError(400, "번호 또는 별칭을 1~40자로 입력해 주세요.");
      const token = randomBytes(32).toString("base64url");
      // The published check and insertion share one database statement.
      const rows = await query(`INSERT INTO student_attempts AS s (id, assessment_id, student_label, token_hash)
        SELECT $1, a.id, $3, $4 FROM assessments a WHERE a.share_code = $2 AND a.status = 'published'
        RETURNING ${attemptColumns}`, [randomUUID(), code, label, hashToken(token)]);
      if (!rows[0]) throw new AppError(409, "평가가 마감되었거나 아직 공개되지 않았습니다.");
      return { token, attempt: attemptRecord(rows[0]) };
    },
    async saveAttempt(code: string, token: string, input: { answers: unknown; revision: number; timeSpentSeconds: number; submit?: boolean }) {
      const [assessment, existing] = await Promise.all([getByCode(code), getAttempt(code, token)]);
      // Retrying a successful submission never creates a second response or rewrites it.
      if (existing.status === "submitted" && input.submit) return existing;
      if (existing.status === "submitted") throw new AppError(409, "이미 제출한 답안은 수정할 수 없습니다.");
      if (!Number.isInteger(input.revision) || !Number.isInteger(input.timeSpentSeconds) || input.timeSpentSeconds < 0 || input.timeSpentSeconds > 86400) throw new AppError(400, "저장 정보가 올바르지 않습니다.");
      const answers = validateAnswers(input.answers, assessment.definition, Boolean(input.submit));
      const rows = await query(`UPDATE student_attempts AS s SET answers = $3::jsonb, revision = s.revision + 1, saved_at = now(),
        time_spent_seconds = GREATEST(s.time_spent_seconds, $5), status = $6, submitted_at = CASE WHEN $6 = 'submitted' THEN now() ELSE NULL END
        FROM assessments a WHERE s.assessment_id = a.id AND a.share_code = $1 AND s.token_hash = $2
        AND a.status = 'published' AND s.status = 'in_progress' AND s.revision = $4 RETURNING ${attemptColumns}`,
      [code, hashToken(token), JSON.stringify(answers), input.revision, input.timeSpentSeconds, input.submit ? "submitted" : "in_progress"]);
      if (!rows[0]) {
        const latest = await getAttempt(code, token);
        if (input.submit && latest.status === "submitted") return latest;
        throw new AppError(409, "다른 탭에서 답안이 바뀌었거나 평가가 마감되었습니다. 내용을 복사해 둔 뒤 새로고침해 주세요.");
      }
      return attemptRecord(rows[0]);
    },
    async submissions(id: string, ownerId: string) {
      await getOwned(id, ownerId);
      const rows = await query(`SELECT ${attemptColumns}, r.result AS review, r.updated_at AS "reviewUpdatedAt" FROM student_attempts s
        JOIN assessments a ON a.id = s.assessment_id LEFT JOIN teacher_reviews r ON r.attempt_id = s.id
        WHERE a.id = $1 AND a.owner_id = $2 AND s.status = 'submitted' ORDER BY s.submitted_at DESC`, [id, ownerId]);
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
        JOIN student_attempts s ON s.id = r.attempt_id JOIN assessments a ON a.id = s.assessment_id
        WHERE a.share_code = $1 AND s.token_hash = $2 AND r.state = 'published'`, [code, hashToken(token)]);
      return rows[0] ? { ...(rows[0].result as Omit<ReviewRecord, "attemptId" | "updatedAt">), attemptId: String(rows[0].attemptId), updatedAt: timestamp(rows[0].updatedAt) } : null;
    },
  };
}
