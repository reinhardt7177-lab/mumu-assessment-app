import { z } from "zod";

export const responseModalitySchema = z.enum(["photo", "speech", "chat", "screen"]);
export const assistanceLevelSchema = z.enum(["independent", "teacher_prompt", "step_hint", "example", "scaffolded"]);
export const helpTypeSchema = z.enum(["none", "prompt", "step_hint", "example"]);

export const evidencePolicyInputSchema = z.object({
  enabled: z.boolean(),
  providerId: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/).default("disabled"),
  acknowledgement: z.string().trim().max(1000).optional(),
  retentionDays: z.number().int().min(30).max(365).default(90),
}).superRefine((value, context) => {
  if (value.enabled && value.providerId === "disabled") {
    context.addIssue({ code: "custom", message: "외부 AI 제공자를 선택해 주세요." });
  }
  if (value.enabled && (value.acknowledgement?.length ?? 0) < 10) {
    context.addIssue({ code: "custom", message: "학생 증거의 외부 AI 전송에 관한 학교 확인 내용을 10자 이상 입력해 주세요." });
  }
});

export const chatMessageInputSchema = z.object({
  questionId: z.string().min(1).max(64),
  message: z.string().trim().min(1).max(2000),
  elapsedSeconds: z.number().int().min(0).max(86400),
});

export const teacherCorrectionInputSchema = z.object({
  text: z.string().trim().min(1).max(50000),
  reason: z.string().trim().min(5).max(1000),
});

export type EvidencePolicy = {
  enabled: boolean;
  providerId: string;
  acknowledgement: string | null;
  policyVersion: string | null;
  acknowledgedAt: string | null;
  retentionDays: number;
  storageConfigured: boolean;
  aiConfigured: boolean;
};

export type EvidenceAssetRecord = {
  id: string;
  responseEvidenceId: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  identifiersRemovedConfirmed: boolean;
  durationSeconds: number | null;
  createdAt: string;
};

export type EvidenceDerivationRecord = {
  id: string;
  responseEvidenceId: string;
  kind: "ocr" | "transcript" | "teacher_correction";
  model: string;
  promptVersion: string;
  status: "pending" | "complete" | "error";
  extractedText: string | null;
  confidence: number | null;
  segments: Array<{ text: string; startSecond?: number; endSecond?: number }>;
  errorCode: string | null;
  errorMessage: string | null;
  correctionReason: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type ChatMessageRecord = {
  id: string;
  sequence: number;
  role: "student" | "assistant";
  content: string;
  helpType: "none" | "prompt" | "step_hint" | "example";
  elapsedSeconds: number;
  createdAt: string;
};

export type ResponseEvidenceRecord = {
  id: string;
  attemptId: string;
  questionId: string;
  modality: "photo" | "speech" | "chat" | "screen";
  assistanceLevel: "independent" | "teacher_prompt" | "step_hint" | "example" | "scaffolded";
  state: "capturing" | "ready" | "submitted" | "error";
  assets: EvidenceAssetRecord[];
  derivations: EvidenceDerivationRecord[];
  chat: null | {
    id: string;
    state: "active" | "submitted";
    elapsedSeconds: number;
    helpCount: number;
    messages: ChatMessageRecord[];
  };
  createdAt: string;
  updatedAt: string;
};

export type StudentEvidencePayload = {
  policy: Pick<EvidencePolicy, "enabled" | "storageConfigured" | "aiConfigured">;
  responses: ResponseEvidenceRecord[];
};

export const ocrOutputSchema = z.object({
  text: z.string().trim().min(1).max(50000),
  confidence: z.number().min(0).max(1),
  uncertainParts: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
});

export const chatCoachOutputSchema = z.object({
  reply: z.string().trim().min(1).max(1200),
  helpType: helpTypeSchema,
  observedEvidence: z.string().trim().max(1000).default(""),
});

export const criterionRecommendationOutputSchema = z.object({
  suggestedLevel: z.enum(["상", "중", "하", "판단 보류"]),
  confidence: z.number().min(0).max(1),
  evidenceExcerpt: z.string().trim().min(1).max(3000),
  rationale: z.string().trim().min(5).max(5000),
  uncertainty: z.string().trim().min(1).max(3000),
  missingEvidence: z.string().trim().min(1).max(3000),
  constructCaution: z.string().trim().min(1).max(3000),
});

export const POLICY_VERSION = "student-evidence-ai-v1";
