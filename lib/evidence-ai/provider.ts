import type { z } from "zod";
import { EvidenceAiError } from "./provider-error";

export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type ProviderResult<T> = {
  output: T;
  model: string;
  usage: ProviderUsage;
  providerMetadata: Record<string, unknown>;
};

export type OcrRequest = {
  bytes: Uint8Array;
  mimeType: string;
  questionPrompt: string;
  learningGoal: string;
  anonymousSubjectId: string;
};

export type TranscriptionRequest = {
  bytes: Uint8Array;
  mimeType: string;
  anonymousSubjectId: string;
};

export type ChatRequest = {
  learningGoal: string;
  questionPrompt: string;
  anonymousSubjectId: string;
  messages: Array<{ role: "student" | "assistant"; content: string; helpType: string }>;
};

export type CriterionRequest = {
  grade: number;
  subject: string;
  standardCode: string;
  standardContent: string;
  unitTitle: string;
  eventTitle: string;
  eventContext: string;
  modality: string;
  assistanceLevel: string;
  evidenceText: string;
  teacherVerified: boolean;
  criterionName: string;
  criterionDescription: string;
  high: string;
  middle: string;
  low: string;
  anonymousSubjectId: string;
};

export type TranscriptionOutput = {
  text: string;
  confidence: number | null;
  segments: Array<{ text: string; startSecond?: number; endSecond?: number }>;
};

export interface EvidenceAiProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ReadonlySet<"ocr" | "transcription" | "chat" | "criterion_recommendation">;
  modelFor(capability: "ocr" | "transcription" | "chat" | "criterion_recommendation"): string;
  ocr<T>(request: OcrRequest, schema: z.ZodType<T>): Promise<ProviderResult<T>>;
  transcribe(request: TranscriptionRequest): Promise<ProviderResult<TranscriptionOutput>>;
  chat<T>(request: ChatRequest, schema: z.ZodType<T>): Promise<ProviderResult<T>>;
  recommend<T>(request: CriterionRequest, schema: z.ZodType<T>): Promise<ProviderResult<T>>;
}

const providers = new Map<string, () => EvidenceAiProvider>();

export function registerEvidenceAiProvider(id: string, factory: () => EvidenceAiProvider) {
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(id)) throw new Error("Invalid evidence AI provider id");
  providers.set(id, factory);
}

export function resolveEvidenceAiProvider(selectedId?: string) {
  const id = selectedId?.trim() || process.env.EVIDENCE_AI_PROVIDER?.trim() || "disabled";
  const factory = providers.get(id);
  if (!factory) throw new EvidenceAiError(503, "provider_not_registered", `선택한 학생 증거 AI 제공자(${id})가 등록되지 않았습니다.`);
  return factory();
}

export function listEvidenceAiProviders() {
  return [...providers.values()].map(factory => {
    const provider = factory();
    return { id: provider.id, displayName: provider.displayName, capabilities: [...provider.capabilities] };
  }).filter(provider => provider.id !== "disabled");
}

export function evidenceAiProviderConfigured(selectedId?: string) {
  const id = selectedId?.trim() || process.env.EVIDENCE_AI_PROVIDER?.trim() || "disabled";
  return id !== "disabled" && providers.has(id);
}
