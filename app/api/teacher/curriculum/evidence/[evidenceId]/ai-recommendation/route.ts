import { createHash } from "node:crypto";
import { z } from "zod";
import { getEvidenceRepository, getGrowthRepository, getRepository } from "../../../../../../../db/connection";
import { AppError } from "../../../../../../../lib/assessment-domain";
import { criterionRecommendationOutputSchema } from "../../../../../../../lib/evidence-domain";
import {
  classifyProviderError,
  EvidenceAiError,
  resolveEvidenceAiProvider,
} from "../../../../../../../lib/evidence-ai";
import { redactStudentIdentifiers } from "../../../../../../../lib/evidence-redaction";
import { apiError, privateJson, readMutation, validateId } from "../../../../../../../lib/http";
import { requireTeacher } from "../../../../../../../lib/teacher-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROMPT_VERSION = "criterion-recommendation-v1";
const inputSchema = z.object({ rubricCriterionId: z.string().uuid() });

export async function POST(request: Request, { params }: { params: Promise<{ evidenceId: string }> }) {
  const startedAt = Date.now();
  const growthRepo = getGrowthRepository();
  let runId: string | null = null;
  let ownerId: string | null = null;
  try {
    ownerId = await requireTeacher();
    const evidenceId = validateId((await params).evidenceId);
    const input = inputSchema.safeParse(await readMutation(request, 2_000));
    if (!input.success) throw new AppError(400, "AI 추천을 받을 루브릭 평가 요소를 확인해 주세요.");

    const policy = await getEvidenceRepository().getPolicy(ownerId);
    if (!policy.enabled) throw new AppError(409, "학교 확인을 거쳐 학생 증거 AI 분석을 먼저 활성화해 주세요.");
    const provider = resolveEvidenceAiProvider(policy.providerId);
    if (!provider.capabilities.has("criterion_recommendation")) throw new AppError(503, "선택한 AI 제공자가 루브릭 추천 평가를 지원하지 않습니다.");

    const context = await growthRepo.getAiSuggestionContext(evidenceId, input.data.rubricCriterionId, ownerId);
    const evidenceText = redactStudentIdentifiers(context.evidenceText, context.studentIdentifiers).slice(0, 60_000);
    if (!evidenceText.trim()) throw new AppError(409, "식별정보를 제외한 뒤 평가할 학생 증거가 남아 있지 않습니다.");
    const model = provider.modelFor("criterion_recommendation");
    const inputHash = createHash("sha256").update(JSON.stringify({
      evidenceId,
      rubricCriterionId: input.data.rubricCriterionId,
      evidenceText,
      model,
      promptVersion: PROMPT_VERSION,
    })).digest("hex");
    const cached = await growthRepo.findCompletedAiSuggestion(evidenceId, input.data.rubricCriterionId, ownerId, model, PROMPT_VERSION, inputHash);
    if (cached) return privateJson({ suggestion: cached, cached: true });

    const configuredLimit = Number(process.env.EVIDENCE_AI_HOURLY_LIMIT ?? 60);
    const hourlyLimit = Number.isInteger(configuredLimit) && configuredLimit >= 1 && configuredLimit <= 1_000 ? configuredLimit : 60;
    await getRepository().consumeLimit(`evidence-ai:${ownerId}`, hourlyLimit, 3_600);
    const run = await growthRepo.beginAiSuggestion(evidenceId, input.data.rubricCriterionId, ownerId, model, PROMPT_VERSION, inputHash);
    runId = run.id;

    const result = await provider.recommend({
      grade: context.grade,
      subject: context.subject,
      standardCode: context.standardCode,
      standardContent: context.standardContent,
      unitTitle: context.unitTitle,
      eventTitle: context.eventTitle,
      eventContext: context.eventContext,
      modality: context.modality,
      assistanceLevel: context.assistanceLevel,
      evidenceText,
      teacherVerified: context.teacherVerified,
      criterionName: context.criterionName,
      criterionDescription: context.criterionDescription,
      high: context.high,
      middle: context.middle,
      low: context.low,
      anonymousSubjectId: createHash("sha256").update(`mumu-student:${context.studentId}`).digest("hex").slice(0, 32),
    }, criterionRecommendationOutputSchema);
    const suggestion = await growthRepo.completeAiSuggestion(runId, ownerId, {
      ...result.output,
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
      providerMetadata: result.providerMetadata,
    });
    return privateJson({ suggestion, cached: false }, 201);
  } catch (error) {
    if (runId && ownerId) {
      const failure = error instanceof EvidenceAiError ? error : classifyProviderError(error);
      await growthRepo.failAiSuggestion(runId, ownerId, {
        errorCode: failure.code,
        errorMessage: failure.message,
        latencyMs: Date.now() - startedAt,
      }).catch(() => null);
    }
    if (error instanceof AppError) return apiError(error);
    const providerError = error instanceof EvidenceAiError ? error : classifyProviderError(error);
    return apiError(new AppError(providerError.status, providerError.message));
  }
}