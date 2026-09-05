import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createAssessmentRepository, type Query } from "../db/repository";
import { createEvidenceRepository } from "../db/evidence-repository";
import type { AssessmentDefinition } from "../lib/assessment-domain";
import { AppError } from "../lib/assessment-domain";
import { redactStudentIdentifiers } from "../lib/evidence-redaction";

const migrationNames = [
  "0001_assessment_core.sql", "0002_curriculum_growth.sql", "0003_ai_assessment_suggestions.sql",
  "0004_assessment_growth_bridge.sql", "0005_school_curriculum_plans.sql",
  "0006_teacher_classes_and_distributions.sql", "0007_design_studio.sql", "0008_multimodal_evidence.sql", "0009_screen_recording_evidence.sql",
];
const schema = (await Promise.all(migrationNames.map(name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8")))).join("\n");
const adapter = (db: PGlite): Query => async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;
const definition = (): AssessmentDefinition => ({
  title: "합성 멀티모달 평가", subject: "6학년 사회", learningGoal: "민주주의의 의미를 자신의 근거와 함께 설명한다.", type: "독립 수행평가",
  standardCodes: ["6사01-01"], questions: [{ id: "q1", prompt: "민주주의의 의미를 근거와 함께 설명하세요.", kind: "서술형", standardCode: "6사01-01", criterion: "개념과 근거", points: 20 }],
  methods: ["photo", "chat"], rubric: [{ name: "개념과 근거", high: "민주주의의 의미와 근거를 구체적으로 연결해 설명한다.", middle: "민주주의의 의미를 설명하고 근거를 일부 제시한다.", low: "관련 낱말을 제시하지만 의미와 근거의 연결은 아직 드러나지 않는다." }],
  grading: { upperThreshold: 80, middleThreshold: 50 },
});

let pg: PGlite;
let assessments: ReturnType<typeof createAssessmentRepository>;
let evidence: ReturnType<typeof createEvidenceRepository>;
const teacher = `teacher-synthetic-${crypto.randomUUID()}`;
const previousBlobToken = process.env.BLOB_READ_WRITE_TOKEN;

before(async () => {
  process.env.BLOB_READ_WRITE_TOKEN = "synthetic-test-token";
  pg = await PGlite.create();
  await pg.exec(schema);
  const query = adapter(pg);
  assessments = createAssessmentRepository(query);
  evidence = createEvidenceRepository(query);
});
after(async () => {
  if (previousBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = previousBlobToken;
  await pg.close();
});

test("학교 승인 OFF에서는 외부 AI 처리 컨텍스트를 만들지 않는다", async () => {
  const assessment = await assessments.create(teacher, definition());
  await assert.rejects(assessments.setStatus(assessment.id, teacher, "published"), status(409));
  const policy = await evidence.getPolicy(teacher);
  assert.equal(policy.enabled, false);
  assert.equal(policy.providerId, "disabled");
});

test("선택 제공자·식별정보 제거 확인·OCR·챗봇·복합 제출·교사 확인본을 이력으로 보존한다", async () => {
  await evidence.savePolicy(teacher, {
    enabled: true,
    providerId: "vercel-gateway",
    acknowledgement: "합성 자료만 사용하는 학교 내부 검증 승인 기록입니다.",
    retentionDays: 30,
  });
  const [draft] = await assessments.list(teacher);
  const assessment = await assessments.setStatus(draft.id, teacher, "published");
  const { token, attempt } = await assessments.startAttempt(assessment.shareCode, "합성학생 99번");
  const asset = await evidence.createAsset(attempt.id, {
    questionId: "q1", modality: "photo", blobPathname: `synthetic/${crypto.randomUUID()}.png`,
    originalFilename: "answer-only.png", mimeType: "image/png", byteSize: 128,
    sha256: "a".repeat(64), identifiersRemovedConfirmed: true,
  });
  const context = await evidence.getProcessingContext(asset.responseId, attempt.id);
  assert.equal(context.providerId, "vercel-gateway");
  assert.equal(context.identifiersRemovedConfirmed, true);
  assert.equal(context.ownerId, teacher);

  const derivationId = await evidence.beginDerivation(asset.responseId, "ocr", "synthetic/ocr", "ocr-test-v1");
  await evidence.completeDerivation(derivationId, { text: "시민이 함께 결정에 참여하는 제도입니다.", confidence: 0.92 });
  const chat = await evidence.createChatSession(attempt.id, "q1");
  await evidence.appendStudentChatMessage(chat.sessionId, attempt.id, "왜 함께 결정하는지가 중요하다고 생각해요.", 25);
  await evidence.appendAssistantChatMessage(chat.sessionId, "그 중요성을 보여주는 이유를 한 가지 더 말해 볼까요?", "prompt", 31);

  const beforeSubmit = await evidence.listAttemptResponses(attempt.id);
  assert.equal(beforeSubmit.length, 2);
  assert.equal(beforeSubmit.find(item => item.modality === "photo")?.derivations[0]?.extractedText, "시민이 함께 결정에 참여하는 제도입니다.");
  assert.equal(beforeSubmit.find(item => item.modality === "chat")?.chat?.helpCount, 1);

  const submitted = await assessments.saveAttempt(assessment.shareCode, token, { answers: {}, revision: attempt.revision, timeSpentSeconds: 45, submit: true });
  assert.equal(submitted.status, "submitted");
  const afterSubmit = await evidence.listAttemptResponses(attempt.id);
  assert.ok(afterSubmit.every(item => item.state === "submitted"));
  assert.equal(afterSubmit.find(item => item.modality === "chat")?.chat?.state, "submitted");

  const correction = await evidence.saveTeacherCorrection(asset.responseId, attempt.id, teacher, {
    text: "시민이 공동의 문제를 함께 결정하는 제도입니다.",
    reason: "합성 손글씨 원본과 대조해 빠진 낱말을 수정함",
  });
  assert.equal(correction.learningEvidenceVerified, false);
  const corrected = await evidence.listOwnedAttemptResponses(attempt.id, teacher);
  assert.equal(corrected.find(item => item.modality === "photo")?.derivations[0]?.kind, "teacher_correction");
  assert.match(corrected.find(item => item.modality === "photo")?.derivations[0]?.correctionReason ?? "", /원본과 대조/);
});

test("평가 전체에 허용해도 문항에서 해제한 사진·챗봇 응답은 서버에서 차단", async () => {
  const owner = `synthetic-method-${crypto.randomUUID()}`;
  await evidence.savePolicy(owner, { enabled: true, providerId: "vercel-gateway", acknowledgement: "합성 자료로 문항별 제출 허용 범위를 검증합니다.", retentionDays: 30 });
  const base = definition();
  const assessment = await assessments.create(owner, { ...base, questions: [
    { ...base.questions[0], responseMethods: ["photo"] },
    { ...base.questions[0], id: "q2", responseMethods: ["chat"] },
  ] });
  await assessments.setStatus(assessment.id, owner, "published");
  const { attempt } = await assessments.startAttempt(assessment.shareCode, "합성검증");
  await assert.rejects(evidence.createChatSession(attempt.id, "q1"), status(409));
  await assert.rejects(evidence.createAsset(attempt.id, { questionId: "q2", modality: "photo", blobPathname: "synthetic/blocked.png", originalFilename: "blocked.png", mimeType: "image/png", byteSize: 128, sha256: "b".repeat(64), identifiersRemovedConfirmed: true }), status(409));
  assert.ok((await evidence.createChatSession(attempt.id, "q2")).sessionId);
});

test("학생 식별 문자열은 외부 전송 직전에 문맥을 보존하며 마스킹한다", () => {
  const redacted = redactStudentIdentifiers("제 이름은 합성학생이고 학번 99, 99번입니다. 답은 99명이 아닙니다.", ["합성학생", "99"]);
  assert.equal(redacted.includes("합성학생"), false);
  assert.equal(redacted.includes("학번 99"), false);
  assert.equal(redacted.includes("99번"), false);
  assert.equal(redacted.includes("99명이"), true);
});
