import { APICallError } from "ai";

export class EvidenceAiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function classifyProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 402) return new EvidenceAiError(402, "budget_exceeded", "AI 사용 예산 한도에 도달했습니다.");
    if (error.statusCode === 403) return new EvidenceAiError(403, "credits_required", "선택한 AI 제공자의 크레딧 또는 연결 권한이 필요합니다.");
    if (error.statusCode === 429) return new EvidenceAiError(429, "rate_limited", "AI 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.");
    if (error.statusCode === 503) return new EvidenceAiError(503, "provider_unavailable", "AI 제공자가 잠시 응답하지 않습니다.");
    return new EvidenceAiError(502, `provider_${error.statusCode ?? "error"}`, "AI 결과를 안전하게 처리하지 못했습니다.");
  }
  if (/credit|free tier|payment/i.test(message)) return new EvidenceAiError(403, "credits_required", "선택한 AI 제공자의 크레딧 연결이 필요합니다.");
  return new EvidenceAiError(500, "generation_failed", "AI 분석을 완료하지 못했습니다.");
}
