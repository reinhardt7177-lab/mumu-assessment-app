import { EvidenceAiError } from "./provider-error";
import { registerEvidenceAiProvider, type EvidenceAiProvider } from "./provider";

const unavailable = async () => {
  throw new EvidenceAiError(503, "provider_disabled", "학생 증거 AI 제공자를 아직 선택하지 않았습니다.");
};

class DisabledProvider implements EvidenceAiProvider {
  readonly id = "disabled";
  readonly displayName = "외부 전송 안 함";
  readonly capabilities = new Set<"ocr" | "transcription" | "chat" | "criterion_recommendation">();
  modelFor = () => "disabled";
  ocr = unavailable;
  transcribe = unavailable;
  chat = unavailable;
  recommend = unavailable;
}

registerEvidenceAiProvider("disabled", () => new DisabledProvider());
