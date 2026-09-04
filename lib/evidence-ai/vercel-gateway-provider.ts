import { gateway } from "@ai-sdk/gateway";
import { generateText, Output, transcribe } from "ai";
import {
  registerEvidenceAiProvider,
  type ChatRequest,
  type CriterionRequest,
  type EvidenceAiProvider,
  type OcrRequest,
  type ProviderResult,
  type TranscriptionOutput,
  type TranscriptionRequest,
} from "./provider";

function metadata(value: unknown) {
  try { return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>; }
  catch { return {}; }
}

function usage(value: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) {
  return { inputTokens: value.inputTokens, outputTokens: value.outputTokens, totalTokens: value.totalTokens };
}

class VercelGatewayProvider implements EvidenceAiProvider {
  readonly id = "vercel-gateway";
  readonly displayName = "Vercel AI Gateway";
  readonly capabilities = new Set<"ocr" | "transcription" | "chat" | "criterion_recommendation">(["ocr", "transcription", "chat", "criterion_recommendation"]);
  modelFor(capability: "ocr" | "transcription" | "chat" | "criterion_recommendation") {
    if (capability === "ocr") return process.env.EVIDENCE_OCR_MODEL ?? process.env.AI_MODEL ?? "openai/gpt-5.4-mini";
    if (capability === "transcription") return process.env.EVIDENCE_TRANSCRIPTION_MODEL ?? "openai/gpt-4o-mini-transcribe";
    if (capability === "chat") return process.env.EVIDENCE_CHAT_MODEL ?? process.env.AI_MODEL ?? "openai/gpt-5.4-mini";
    return process.env.EVIDENCE_SCORING_MODEL ?? process.env.AI_MODEL ?? "openai/gpt-5.4-mini";
  }

  async ocr<T>(request: OcrRequest, schema: Parameters<EvidenceAiProvider["ocr"]>[1]): Promise<ProviderResult<T>> {
    const model = this.modelFor("ocr");
    const result = await generateText({
      model,
      output: Output.object({ name: "HandwritingExtraction", description: "학생 손글씨 사진의 충실한 OCR 결과", schema }),
      maxOutputTokens: 3000,
      system: [
        "당신은 초등학생 손글씨를 있는 그대로 옮기는 OCR 보조 도구입니다.",
        "내용을 고치거나 정답을 보충하거나 평가하지 마세요.",
        "읽을 수 없는 부분은 [판독 불가]로 표시하고 confidence를 낮추세요.",
        "문단과 수식의 순서를 가능한 한 보존하세요.",
      ].join("\n"),
      messages: [{ role: "user", content: [
        { type: "text", text: `학습 목표: ${request.learningGoal}\n문항: ${request.questionPrompt}\n사진 속 학생 답안을 원문 그대로 전사하세요.` },
        { type: "file", mediaType: request.mimeType, data: request.bytes },
      ] }],
      providerOptions: { gateway: { tags: ["feature:student-ocr", "scope:elementary-assessment"], user: request.anonymousSubjectId } },
    });
    return { output: result.output as T, model, usage: usage(result.usage), providerMetadata: metadata(result.providerMetadata) };
  }

  async transcribe(request: TranscriptionRequest): Promise<ProviderResult<TranscriptionOutput>> {
    const model = this.modelFor("transcription");
    const result = await transcribe({
      model: gateway.transcriptionModel(model as never),
      audio: request.bytes,
      providerOptions: { gateway: { tags: ["feature:student-transcript", "scope:elementary-assessment"], user: request.anonymousSubjectId } },
    });
    return {
      model,
      output: {
        text: result.text,
        confidence: null,
        segments: result.segments.map(segment => ({ text: segment.text, startSecond: segment.startSecond, endSecond: segment.endSecond })),
      },
      usage: {},
      providerMetadata: metadata(result.providerMetadata),
    };
  }

  async chat<T>(request: ChatRequest, schema: Parameters<EvidenceAiProvider["chat"]>[1]): Promise<ProviderResult<T>> {
    const model = this.modelFor("chat");
    const transcript = request.messages.map(message => `${message.role === "student" ? "학생" : "도우미"}: ${message.content}`).join("\n");
    const result = await generateText({
      model,
      output: Output.object({ name: "AssessmentChatCoach", description: "답을 대신하지 않는 소크라테스식 평가 대화", schema }),
      maxOutputTokens: 700,
      system: [
        "당신은 초등학생 평가 중 사고를 드러내도록 돕는 대화형 질문자입니다.",
        "정답, 모범 문장, 완성 답안을 직접 주지 마세요.",
        "먼저 학생이 한 말을 짧게 확인하고, 한 번에 질문 하나만 하세요.",
        "도움 유형은 none, prompt, step_hint, example 중 실제 제공 수준으로 기록하세요.",
        "example은 학생이 명시적으로 예시를 요청했을 때만 쓰고, 평가 문항과 다른 맥락의 예시만 드세요.",
        "학생의 철자나 말투를 성취 수준으로 판단하지 마세요.",
      ].join("\n"),
      prompt: `학습 목표: ${request.learningGoal}\n평가 문항: ${request.questionPrompt}\n\n지금까지 대화:\n${transcript}\n\n학생의 생각을 더 분명히 드러내는 다음 응답을 만드세요.`,
      providerOptions: { gateway: { tags: ["feature:assessment-chat", "scope:elementary-assessment"], user: request.anonymousSubjectId } },
    });
    return { output: result.output as T, model, usage: usage(result.usage), providerMetadata: metadata(result.providerMetadata) };
  }

  async recommend<T>(request: CriterionRequest, schema: Parameters<EvidenceAiProvider["recommend"]>[1]): Promise<ProviderResult<T>> {
    const model = this.modelFor("criterion_recommendation");
    const result = await generateText({
      model,
      output: Output.object({ name: "CriterionRecommendation", description: "학생 증거에 근거한 준거참조 수준 추천", schema }),
      maxOutputTokens: 2200,
      system: [
        "당신은 대한민국 초등학교 준거참조 학생평가 보조자입니다.",
        "제공된 한 가지 평가 요소만 판단하고 학생 전체 능력을 단정하지 마세요.",
        "상·중·하는 루브릭 기술문과 증거의 질적 일치로 추천하세요. 점수 평균이나 글 길이로 판단하지 마세요.",
        "evidenceExcerpt에는 제공된 학생 증거의 짧은 원문 구절만 그대로 인용하세요.",
        "OCR·전사 미확인, 증거 부족, 상충 증거가 있으면 판단 보류를 우선하세요.",
        "도움을 받은 수행은 독립 수행과 분리하고 constructCaution에 영향 가능성을 적으세요.",
        "AI 추천이며 최종 확정자는 교사입니다.",
      ].join("\n"),
      prompt: [
        `${request.grade}학년 ${request.subject} · ${request.unitTitle}`,
        `성취기준 [${request.standardCode}] ${request.standardContent}`,
        `평가 맥락: ${request.eventTitle} - ${request.eventContext}`,
        `응답 방식: ${request.modality}, 도움 수준: ${request.assistanceLevel}, 변환본 교사 확인: ${request.teacherVerified ? "예" : "아니오"}`,
        `평가 요소: ${request.criterionName} - ${request.criterionDescription}`,
        `상: ${request.high}\n중: ${request.middle}\n하: ${request.low}`,
        `학생 증거:\n${request.evidenceText}`,
      ].join("\n\n"),
      providerOptions: { gateway: { tags: ["feature:criterion-recommendation", "scope:elementary-assessment"], user: request.anonymousSubjectId } },
    });
    return { output: result.output as T, model, usage: usage(result.usage), providerMetadata: metadata(result.providerMetadata) };
  }
}

registerEvidenceAiProvider("vercel-gateway", () => new VercelGatewayProvider());