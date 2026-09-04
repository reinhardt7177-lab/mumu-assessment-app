import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { getEvidenceRepository, getRepository } from "../../../../../../db/connection";
import { AppError } from "../../../../../../lib/assessment-domain";
import { chatCoachOutputSchema, chatMessageInputSchema } from "../../../../../../lib/evidence-domain";
import {
  classifyProviderError,
  EvidenceAiError,
  resolveEvidenceAiProvider,
} from "../../../../../../lib/evidence-ai";
import { redactStudentIdentifiers } from "../../../../../../lib/evidence-redaction";
import { apiError, privateJson, readMutation, validateCode } from "../../../../../../lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

const CHAT_PROMPT_VERSION = "assessment-chat-coach-v1";
const chatInputSchema = chatMessageInputSchema.extend({ sessionId: z.string().uuid().optional() });

function anonymousId(attemptId: string) {
  return createHash("sha256").update(`mumu-evidence:${attemptId}`).digest("hex").slice(0, 32);
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const evidenceRepo = getEvidenceRepository();
  const startedAt = Date.now();
  let runId: string | null = null;
  try {
    const code = validateCode((await params).code);
    const input = chatInputSchema.safeParse(await readMutation(request, 5_000));
    if (!input.success) throw new AppError(400, input.error.issues[0]?.message ?? "대화 내용을 확인해 주세요.");
    const token = (await cookies()).get(`mumu_attempt_${code}`)?.value;
    if (!token) throw new AppError(401, "먼저 번호 또는 별칭으로 참여해 주세요.");

    const repository = getRepository();
    const attempt = await repository.getAttempt(code, token);
    if (attempt.status !== "in_progress") throw new AppError(409, "제출한 답안에서는 대화를 이어갈 수 없습니다.");

    const session = input.data.sessionId
      ? { sessionId: input.data.sessionId }
      : await evidenceRepo.createChatSession(attempt.id, input.data.questionId);
    await evidenceRepo.appendStudentChatMessage(session.sessionId, attempt.id, input.data.message, input.data.elapsedSeconds);
    const context = await evidenceRepo.getChatContext(session.sessionId, attempt.id);
    if (context.questionId !== input.data.questionId) throw new AppError(409, "문항과 대화 기록이 일치하지 않습니다.");
    const question = context.definition.questions.find(item => item.id === context.questionId);
    if (!question) throw new AppError(409, "평가 문항을 찾을 수 없습니다.");

    const provider = resolveEvidenceAiProvider(context.providerId);
    if (!provider.capabilities.has("chat")) throw new AppError(503, "선택한 AI 제공자가 평가 챗봇을 지원하지 않습니다.");
    const configuredLimit = Number(process.env.EVIDENCE_AI_HOURLY_LIMIT ?? 60);
    const hourlyLimit = Number.isInteger(configuredLimit) && configuredLimit >= 1 && configuredLimit <= 1_000 ? configuredLimit : 60;
    await repository.consumeLimit(`evidence-ai:${context.ownerId}`, hourlyLimit, 3_600);

    const model = provider.modelFor("chat");
    const inputHash = createHash("sha256").update(JSON.stringify({
      sessionId: session.sessionId,
      messageCount: context.messages.length,
      lastMessage: context.messages.at(-1)?.content,
      model,
      promptVersion: CHAT_PROMPT_VERSION,
    })).digest("hex");
    runId = await evidenceRepo.beginAiRun({
      ownerId: context.ownerId,
      responseEvidenceId: context.responseId,
      chatSessionId: session.sessionId,
      feature: "chat_coach",
      model,
      promptVersion: CHAT_PROMPT_VERSION,
      inputHash,
    });

    const result = await provider.chat({
      learningGoal: context.definition.learningGoal,
      questionPrompt: question.prompt,
      anonymousSubjectId: anonymousId(attempt.id),
      messages: context.messages.map(message => ({ ...message, content: redactStudentIdentifiers(message.content, context.studentIdentifiers) })),
    }, chatCoachOutputSchema);
    await evidenceRepo.appendAssistantChatMessage(
      session.sessionId,
      result.output.reply,
      result.output.helpType,
      input.data.elapsedSeconds,
    );
    await evidenceRepo.completeAiRun(runId, {
      ...result.usage,
      latencyMs: Date.now() - startedAt,
      providerMetadata: result.providerMetadata,
    });

    return privateJson({
      sessionId: session.sessionId,
      observedEvidence: result.output.observedEvidence,
      responses: await evidenceRepo.listAttemptResponses(attempt.id),
    });
  } catch (error) {
    if (error instanceof AppError) {
      if (runId) await evidenceRepo.failAiRun(runId, { code: "request_rejected", message: error.message, latencyMs: Date.now() - startedAt }).catch(() => null);
      return apiError(error);
    }
    const providerError = error instanceof EvidenceAiError ? error : classifyProviderError(error);
    if (runId) await evidenceRepo.failAiRun(runId, { code: providerError.code, message: providerError.message, latencyMs: Date.now() - startedAt }).catch(() => null);
    return apiError(new AppError(providerError.status, providerError.message));
  }
}