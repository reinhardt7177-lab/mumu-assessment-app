import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { getEvidenceRepository, getRepository } from "../../../../../../../db/connection";
import { AppError } from "../../../../../../../lib/assessment-domain";
import { ocrOutputSchema } from "../../../../../../../lib/evidence-domain";
import {
  classifyProviderError,
  EvidenceAiError,
  resolveEvidenceAiProvider,
} from "../../../../../../../lib/evidence-ai";
import { readPrivateEvidence } from "../../../../../../../lib/evidence-storage";
import { apiError, privateJson, readMutation, validateCode, validateId } from "../../../../../../../lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const OCR_PROMPT_VERSION = "student-handwriting-ocr-v1";
const TRANSCRIPT_PROMPT_VERSION = "student-speech-transcript-v1";

function anonymousId(attemptId: string) {
  return createHash("sha256").update(`mumu-evidence:${attemptId}`).digest("hex").slice(0, 32);
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string; responseId: string }> }) {
  const evidenceRepo = getEvidenceRepository();
  const startedAt = Date.now();
  let derivationId: string | null = null;
  let runId: string | null = null;
  try {
    await readMutation(request, 1_000);
    const { code: rawCode, responseId: rawResponseId } = await params;
    const code = validateCode(rawCode);
    const responseId = validateId(rawResponseId);
    const token = (await cookies()).get(`mumu_attempt_${code}`)?.value;
    if (!token) throw new AppError(401, "먼저 번호 또는 별칭으로 참여해 주세요.");

    const repository = getRepository();
    const attempt = await repository.getAttempt(code, token);
    if (attempt.status !== "in_progress") throw new AppError(409, "제출한 답안은 다시 변환할 수 없습니다.");

    // Ownership and the teacher's school-approval setting are checked again at transmission time.
    const context = await evidenceRepo.getProcessingContext(responseId, attempt.id);
    const provider = resolveEvidenceAiProvider(context.providerId);
    const capability = context.modality === "photo" ? "ocr" : "transcription";
    if (!provider.capabilities.has(capability)) throw new AppError(503, "선택한 AI 제공자가 이 응답 방식을 지원하지 않습니다.");

    const configuredLimit = Number(process.env.EVIDENCE_AI_HOURLY_LIMIT ?? 60);
    const hourlyLimit = Number.isInteger(configuredLimit) && configuredLimit >= 1 && configuredLimit <= 1_000 ? configuredLimit : 60;
    await repository.consumeLimit(`evidence-ai:${context.ownerId}`, hourlyLimit, 3_600);

    const model = provider.modelFor(capability);
    const promptVersion = context.modality === "photo" ? OCR_PROMPT_VERSION : TRANSCRIPT_PROMPT_VERSION;
    const inputHash = createHash("sha256").update(JSON.stringify({
      responseId,
      assetSha256: context.assetSha256,
      capability,
      model,
      promptVersion,
    })).digest("hex");

    derivationId = await evidenceRepo.beginDerivation(responseId, capability === "ocr" ? "ocr" : "transcript", model, promptVersion);
    runId = await evidenceRepo.beginAiRun({
      ownerId: context.ownerId,
      responseEvidenceId: responseId,
      feature: capability === "ocr" ? "ocr" : "transcript",
      model,
      promptVersion,
      inputHash,
    });

    const asset = await readPrivateEvidence(context.blobPathname);
    if (asset.mimeType !== context.mimeType) throw new AppError(409, "저장된 원본의 파일 형식을 확인할 수 없습니다.");
    const subjectId = anonymousId(attempt.id);

    if (context.modality === "photo") {
      const result = await provider.ocr({
        bytes: asset.bytes,
        mimeType: context.mimeType,
        learningGoal: context.learningGoal,
        questionPrompt: context.questionPrompt,
        anonymousSubjectId: subjectId,
      }, ocrOutputSchema);
      await evidenceRepo.completeDerivation(derivationId, {
        text: result.output.text,
        confidence: result.output.confidence,
      });
      await evidenceRepo.completeAiRun(runId, {
        ...result.usage,
        latencyMs: Date.now() - startedAt,
        providerMetadata: result.providerMetadata,
      });
    } else {
      const result = await provider.transcribe({
        bytes: asset.bytes,
        mimeType: context.mimeType,
        anonymousSubjectId: subjectId,
      });
      await evidenceRepo.completeDerivation(derivationId, {
        text: result.output.text,
        confidence: result.output.confidence,
        segments: result.output.segments,
      });
      await evidenceRepo.completeAiRun(runId, {
        ...result.usage,
        latencyMs: Date.now() - startedAt,
        providerMetadata: result.providerMetadata,
      });
    }

    return privateJson({ responses: await evidenceRepo.listAttemptResponses(attempt.id) });
  } catch (error) {
    if (error instanceof AppError) {
      if (runId) await evidenceRepo.failAiRun(runId, { code: "request_rejected", message: error.message, latencyMs: Date.now() - startedAt }).catch(() => null);
      if (derivationId) await evidenceRepo.failDerivation(derivationId, "request_rejected", error.message).catch(() => null);
      return apiError(error);
    }
    const providerError = error instanceof EvidenceAiError ? error : classifyProviderError(error);
    if (runId) await evidenceRepo.failAiRun(runId, { code: providerError.code, message: providerError.message, latencyMs: Date.now() - startedAt }).catch(() => null);
    if (derivationId) await evidenceRepo.failDerivation(derivationId, providerError.code, providerError.message).catch(() => null);
    return apiError(new AppError(providerError.status, providerError.message));
  }
}