import { createHash } from "node:crypto";
import { APICallError, generateText, Output } from "ai";
import type { z } from "zod";
import { getDesignStudioRepository, getRepository } from "../db/connection";
import type { DesignFeature } from "./design-studio-domain";

export class DesignAiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function safeMetadata(value: unknown) {
  try { return JSON.parse(JSON.stringify(value ?? {})); }
  catch { return {}; }
}

function classify(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 402) return new DesignAiError(402, "budget_exceeded", "AI 예산 한도에 도달해 기본 초안을 제공했습니다.");
    if (error.statusCode === 403) return new DesignAiError(403, "credits_required", "AI Gateway 크레딧 연결이 필요해 기본 초안을 제공했습니다.");
    if (error.statusCode === 429) return new DesignAiError(429, "rate_limited", "AI 요청이 많아 기본 초안을 제공했습니다.");
    if (error.statusCode === 503) return new DesignAiError(503, "provider_unavailable", "AI 서비스가 잠시 불안정해 기본 초안을 제공했습니다.");
    return new DesignAiError(502, `provider_${error.statusCode ?? "error"}`, "AI 결과를 검증하지 못해 기본 초안을 제공했습니다.");
  }
  if (/credit|free tier|payment/i.test(message)) return new DesignAiError(403, "credits_required", "AI Gateway 크레딧 연결이 필요해 기본 초안을 제공했습니다.");
  return new DesignAiError(500, "generation_failed", "AI 초안을 만들지 못해 기본 초안을 제공했습니다.");
}

export async function runDesignGeneration<T>(input: {
  teacherId: string;
  sessionId: string;
  feature: DesignFeature;
  promptVersion: string;
  schemaName: string;
  schemaDescription: string;
  schema: z.ZodType<T>;
  inputJson: Record<string, unknown>;
  system: string;
  prompt: string;
  maxOutputTokens?: number;
}) {
  const model = process.env.AI_MODEL ?? "openai/gpt-5.4-mini";
  const hash = createHash("sha256").update(JSON.stringify({ model, feature: input.feature, promptVersion: input.promptVersion, input: input.inputJson })).digest("hex");
  const designs = getDesignStudioRepository();
  const cached = await designs.findCompletedGeneration(input.teacherId, input.sessionId, input.feature, model, input.promptVersion, hash);
  if (cached) {
    const parsed = input.schema.safeParse(cached.output);
    if (parsed.success) return { output: parsed.data, generationId: String(cached.id), model, cached: true };
  }
  const configuredLimit = Number(process.env.AI_DESIGN_PER_HOUR ?? 40);
  const hourlyLimit = Number.isInteger(configuredLimit) && configuredLimit > 0 && configuredLimit <= 1000 ? configuredLimit : 40;
  await getRepository().consumeLimit(`ai-design:${input.teacherId}`, hourlyLimit, 3600);
  const generationId = await designs.beginGeneration(input.teacherId, input.sessionId, {
    feature: input.feature, model, promptVersion: input.promptVersion, inputHash: hash, inputJson: input.inputJson,
  });
  const startedAt = Date.now();
  try {
    const result = await generateText({
      model,
      output: Output.object({ name: input.schemaName, description: input.schemaDescription, schema: input.schema }),
      maxOutputTokens: input.maxOutputTokens ?? 2600,
      system: input.system,
      prompt: input.prompt,
      providerOptions: { gateway: { tags: [`feature:${input.feature}`, "scope:elementary-assessment"], user: input.teacherId } },
    });
    await designs.completeGeneration(generationId, input.teacherId, {
      output: result.output,
      usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens },
      latencyMs: Date.now() - startedAt,
      providerMetadata: safeMetadata(result.providerMetadata),
    });
    return { output: result.output, generationId, model, cached: false };
  } catch (error) {
    const classified = classify(error);
    await designs.failGeneration(generationId, input.teacherId, { code: classified.code, message: classified.message, latencyMs: Date.now() - startedAt }).catch(() => null);
    throw classified;
  }
}
