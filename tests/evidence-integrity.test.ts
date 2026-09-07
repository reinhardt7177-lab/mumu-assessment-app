import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createAssessmentRepository, type Query } from "../db/repository";
import { createEvidenceRepository } from "../db/evidence-repository";
import { createEvidenceRetentionRepository } from "../db/evidence-retention-repository";
import { AppError, type AssessmentDefinition } from "../lib/assessment-domain";
import { activeEvidenceAsset, currentEvidenceDerivations, transformCapability } from "../lib/evidence-domain";
import { authorizeRetention, cleanupExpiredEvidence } from "../lib/evidence-retention";

// Only in-memory PostgreSQL and fake deletion functions. No Blob, live DB or AI.
const directory = new URL("../db/migrations/", import.meta.url);
const migrations = await Promise.all((await readdir(directory)).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort().map(name => readFile(new URL(name, directory), "utf8")));
let pg: PGlite;
let assessments: ReturnType<typeof createAssessmentRepository>;
let evidence: ReturnType<typeof createEvidenceRepository>;
let query: Query;
const owner = "integrity-synthetic-teacher";
const previousBlob = process.env.BLOB_READ_WRITE_TOKEN;
const rejected = (error: unknown) => error instanceof AppError && error.status >= 400 && error.status < 500;
before(async () => {
  process.env.BLOB_READ_WRITE_TOKEN = "synthetic-no-network";
  pg = await PGlite.create();
  await pg.exec(migrations.join("\n"));
  query = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
  assessments = createAssessmentRepository(query); evidence = createEvidenceRepository(query);
  await evidence.savePolicy(owner, { enabled: true, providerId: "vercel-gateway", acknowledgement: "로컬 합성 DB에서만 실행하는 진단용 승인 기록입니다.", retentionDays: 30 });
});
after(async () => { if (previousBlob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = previousBlob; await pg.close(); });

async function setup(method: "photo" | "speech" | "screen") {
  const definition: AssessmentDefinition = { title: "합성 원본 연결 평가", subject: "6학년 사회", learningGoal: "민주주의의 의미를 근거와 함께 설명한다.", type: "독립 수행평가",
    standardCodes: ["6사01-01"], methods: [method], questions: [{ id: "q1", prompt: "민주주의의 의미를 근거와 함께 설명하세요.", kind: "서술형", standardCode: "6사01-01", criterion: "개념과 근거", points: 20, responseMethods: [method] }],
    rubric: [{ name: "개념과 근거", high: "의미와 구체적 근거를 연결하여 설명한다.", middle: "의미를 설명하고 근거를 일부 제시한다.", low: "낱말은 제시하지만 근거의 연결은 드러나지 않는다." }], grading: { upperThreshold: 80, middleThreshold: 50 } };
  const draft = await assessments.create(owner, definition);
  const assessment = await assessments.setStatus(draft.id, owner, "published");
  const { attempt, token } = await assessments.startAttempt(assessment.shareCode, "합성별칭");
  const addAsset = () => evidence.createAsset(attempt.id, { questionId: "q1", modality: method, blobPathname: `student-evidence/${attempt.id}/q1/${randomUUID()}`, originalFilename: "synthetic-only", mimeType: method === "photo" ? "image/png" : method === "speech" ? "audio/webm" : "video/webm", byteSize: 128, sha256: "a".repeat(64), identifiersRemovedConfirmed: true });
  return { assessment, attempt, token, addAsset, asset: await addAsset() };
}
async function expire(fixture: Awaited<ReturnType<typeof setup>>) {
  const id = randomUUID();
  await query(`INSERT INTO evidence_assets (id, response_evidence_id, blob_pathname, original_filename, mime_type, byte_size, sha256, identifiers_removed_confirmed, retention_until)
    VALUES ($1,$2,$3,'expired.png','image/png',128,$4,true,now() - interval '1 day')`, [id, fixture.asset.responseId, `student-evidence/expired/${id}`, "b".repeat(64)]);
  await query(`UPDATE attempt_response_evidence SET active_asset_id = $1 WHERE id = $2`, [id, fixture.asset.responseId]);
  return id;
}

for (const method of ["photo", "speech"] as const) test(`${method}: 새 원본은 이전 변환으로 제출 불가, 새 변환 후 제출 성공`, async () => {
  const f = await setup(method); const kind = method === "photo" ? "ocr" : "transcript";
  const old = await evidence.beginDerivation(f.asset.responseId, kind, "synthetic/model", "v1", f.asset.assetId);
  await evidence.completeDerivation(old, { text: "원본 A의 수행", confidence: 0.9 });
  const second = await f.addAsset();
  let responses = await evidence.listAttemptResponses(f.attempt.id);
  assert.equal(responses[0].assets.length, 2);
  assert.equal(activeEvidenceAsset(responses[0])?.id, second.assetId);
  assert.equal(currentEvidenceDerivations(responses[0]).length, 0);
  const submit = () => assessments.saveAttempt(f.assessment.shareCode, f.token, { answers: {}, revision: f.attempt.revision, timeSpentSeconds: 10, submit: true });
  await assert.rejects(submit(), rejected);
  await assert.rejects(evidence.beginDerivation(second.responseId, kind, "synthetic/model", "v1", f.asset.assetId), rejected);
  const current = await evidence.beginDerivation(second.responseId, kind, "synthetic/model", "v1", second.assetId);
  await evidence.completeDerivation(current, { text: "원본 B의 수행", confidence: 0.8 });
  await assert.rejects(query(`UPDATE evidence_derivations SET source_asset_id = $1 WHERE id = $2`, [f.asset.assetId, current]));
  assert.equal((await submit()).status, "submitted");
  responses = await evidence.listAttemptResponses(f.attempt.id);
  assert.equal(currentEvidenceDerivations(responses[0])[0].extractedText, "원본 B의 수행");
  await assert.rejects(evidence.saveTeacherCorrection(second.responseId, f.attempt.id, owner, { sourceAssetId: f.asset.assetId, text: "잘못된 원본 확인", reason: "이전 원본을 대조한 잘못된 요청" }), rejected);
  await evidence.saveTeacherCorrection(second.responseId, f.attempt.id, owner, { sourceAssetId: second.assetId, text: "B 교사 확인본", reason: "현재 원본 B와 대조해 확인함" });
  assert.equal(currentEvidenceDerivations((await evidence.listAttemptResponses(f.attempt.id))[0])[0].sourceAssetId, second.assetId);
  await assert.rejects(f.addAsset(), rejected);
});

test("늦게 끝난 이전 원본 변환과 제출 후 실패 콜백은 현재 응답을 바꾸지 않음", async () => {
  const f = await setup("photo");
  const old = await evidence.beginDerivation(f.asset.responseId, "ocr", "synthetic/model", "v1", f.asset.assetId);
  const current = await f.addAsset();
  await assert.rejects(evidence.completeDerivation(old, { text: "늦은 A", confidence: 0.8 }), rejected);
  const currentId = await evidence.beginDerivation(current.responseId, "ocr", "synthetic/model", "v1", current.assetId);
  await evidence.completeDerivation(currentId, { text: "현재 B", confidence: 0.9 });
  const pending = await evidence.beginDerivation(current.responseId, "ocr", "synthetic/model", "v2", current.assetId);
  await assessments.saveAttempt(f.assessment.shareCode, f.token, { answers: {}, revision: f.attempt.revision, timeSpentSeconds: 10, submit: true });
  await assert.rejects(evidence.completeDerivation(pending, { text: "늦은 B 재변환", confidence: 0.9 }), rejected);
  await evidence.failDerivation(old, "stale", "교체된 원본");
  await evidence.failDerivation(pending, "submitted", "이미 제출됨");
  const response = (await evidence.listAttemptResponses(f.attempt.id))[0];
  assert.equal(response.state, "submitted");
  assert.equal(currentEvidenceDerivations(response).filter(item => item.status === "complete")[0].extractedText, "현재 B");
});

test("제출 검사와 저장 사이의 원본 교체를 버전 검사로 차단", async () => {
  const f = await setup("photo");
  const id = await evidence.beginDerivation(f.asset.responseId, "ocr", "synthetic/model", "v1", f.asset.assetId);
  await evidence.completeDerivation(id, { text: "사진 A", confidence: 0.9 });
  let replaced = false;
  const interleaved: Query = async (sql, params) => {
    if (!replaced && sql.includes("WITH saved AS") && sql.includes("UPDATE student_attempts AS s")) { replaced = true; await f.addAsset(); }
    return query(sql, params);
  };
  await assert.rejects(createAssessmentRepository(interleaved).saveAttempt(f.assessment.shareCode, f.token, { answers: {}, revision: f.attempt.revision, timeSpentSeconds: 10, submit: true }), rejected);
  assert.equal(replaced, true);
  assert.equal((await assessments.getAttempt(f.assessment.shareCode, f.token)).status, "in_progress");
});

test("화면 녹화는 컨텍스트·변환 생성·제공자 분기에서 모두 차단", async () => {
  const f = await setup("screen");
  assert.equal(transformCapability("screen"), null);
  assert.equal(transformCapability("speech"), "transcription");
  await assert.rejects(evidence.getProcessingContext(f.asset.responseId, f.attempt.id), rejected);
  await assert.rejects(evidence.beginDerivation(f.asset.responseId, "transcript", "synthetic/model", "v1", f.asset.assetId), rejected);
  assert.equal((await assessments.saveAttempt(f.assessment.shareCode, f.token, { answers: {}, revision: f.attempt.revision, timeSpentSeconds: 10, submit: true })).status, "submitted");
});

test("만료 원본은 교사·학생 열람, 변환, 신규 제출에서 차단", async () => {
  const f = await setup("photo"); const expired = await expire(f);
  await assert.rejects(evidence.getAssetForStudent(expired, f.attempt.id), rejected);
  await assert.rejects(evidence.getAssetForTeacher(expired, owner), rejected);
  await assert.rejects(evidence.getProcessingContext(f.asset.responseId, f.attempt.id), rejected);
  await assert.rejects(evidence.beginDerivation(f.asset.responseId, "ocr", "synthetic/model", "v1", expired), rejected);
  assert.equal(activeEvidenceAsset((await evidence.listAttemptResponses(f.attempt.id))[0]), null);
  await assert.rejects(assessments.saveAttempt(f.assessment.shareCode, f.token, { answers: {}, revision: f.attempt.revision, timeSpentSeconds: 10, submit: true }), rejected);
});

test("만료 원본 정리: dry-run 무삭제, 실패 재시도, 성공 감사·중복 방지", async () => {
  const f = await setup("photo"); const expired = await expire(f);
  const repository = createEvidenceRetentionRepository(query); let called = 0;
  const fail = async () => { called++; throw new Error("Synthetic storage outage"); };
  const dry = await cleanupExpiredEvidence(repository, fail, { execute: false });
  assert.equal(dry.dryRun, true); assert.equal(called, 0);
  const failed = await cleanupExpiredEvidence(repository, fail, { execute: true });
  assert.ok(failed.failed > 0);
  assert.ok((await repository.listExpired()).some(item => item.id === expired));
  await assert.rejects(repository.recordDeleted(f.asset.assetId), rejected);
  const success = await cleanupExpiredEvidence(repository, async () => { called++; }, { execute: true });
  assert.equal(success.failed, 0); assert.ok(success.deleted > 0);
  assert.equal((await repository.listExpired()).some(item => item.id === expired), false);
  await repository.recordDeleted(expired); // Idempotent after storage removal succeeded.
  assert.equal((await query(`SELECT * FROM evidence_asset_deletions WHERE asset_id = $1`, [expired])).length, 1);
  await assert.rejects(query(`DELETE FROM evidence_asset_deletions WHERE asset_id = $1`, [expired]));
});

test("정리 작업은 비밀키와 별도 활성화가 필요하고 다른 경로는 삭제하지 않음", async () => {
  const secret = "synthetic-secret-".repeat(4);
  const request = (auth?: string) => new Request("https://mumu.test/api/internal/evidence-retention", { method: "POST", headers: auth ? { authorization: auth } : {} });
  assert.throws(() => authorizeRetention(request(), secret, true), rejected);
  assert.throws(() => authorizeRetention(request(`Bearer ${secret}`), secret, false), rejected);
  authorizeRetention(request(`Bearer ${secret}`), secret, true);
  let removed = false;
  const result = await cleanupExpiredEvidence({ listExpired: async () => [{ id: "fake", pathname: "unrelated/original.png" }], recordDeleted: async () => {} }, async () => { removed = true; }, { execute: true });
  assert.equal(removed, false); assert.equal(result.failed, 1);
});

test("구버전 이관은 단일 원본만 연결하고 복수 원본 OCR을 추측하지 않음", async () => {
  const legacy = await PGlite.create();
  try {
    await legacy.exec(migrations.slice(0, -1).join("\n"));
    const assessmentId = randomUUID(), attemptId = randomUUID();
    await legacy.query(`INSERT INTO assessments (id, owner_id, share_code, definition) VALUES ($1, 'synthetic-owner', $2, '{}'::jsonb)`, [assessmentId, randomUUID()]);
    await legacy.query(`INSERT INTO student_attempts (id, assessment_id, student_label, token_hash) VALUES ($1, $2, '합성', $3)`, [attemptId, assessmentId, randomUUID()]);
    const single = randomUUID(), multiple = randomUUID();
    const one = randomUUID(), two = randomUUID(), three = randomUUID();
    for (const [id, question] of [[single, 'q1'], [multiple, 'q2']]) await legacy.query(`INSERT INTO attempt_response_evidence (id, attempt_id, question_id, modality) VALUES ($1, $2, $3, 'photo')`, [id, attemptId, question]);
    for (const [id, response, age] of [[one, single, 3], [two, multiple, 2], [three, multiple, 1]]) {
      await legacy.query(`INSERT INTO evidence_assets (id,response_evidence_id,blob_pathname,original_filename,mime_type,byte_size,sha256,retention_until,created_at)
        VALUES ($1,$2,$3,'synthetic.png','image/png',128,$4,now() + interval '30 days',now() - make_interval(days => $5))`, [id, response, `student-evidence/legacy/${id}`, "a".repeat(64), age]);
    }
    for (const response of [single, multiple]) await legacy.query(`INSERT INTO evidence_derivations (id,response_evidence_id,kind,model,prompt_version,status,extracted_text,completed_at)
      VALUES ($1,$2,'ocr','synthetic/model','v1','complete','합성 과거 변환',now())`, [randomUUID(), response]);
    await legacy.exec(migrations.at(-1)!);
    const rows = await legacy.query<{ response_evidence_id: string; source_asset_id: string | null }>(`SELECT response_evidence_id, source_asset_id FROM evidence_derivations`);
    assert.equal(rows.rows.find(item => item.response_evidence_id === single)?.source_asset_id, one);
    assert.equal(rows.rows.find(item => item.response_evidence_id === multiple)?.source_asset_id, null);
    assert.equal((await legacy.query(`SELECT * FROM evidence_assets`)).rows.length, 3);
  } finally { await legacy.close(); }
});
