import { createHash } from "node:crypto";
import { APICallError, generateText, Output } from "ai";
import { z } from "zod";
import { requireTeacher } from "../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation } from "../../../../lib/http";
import curriculum from "../../../../data/achievement-standards.2022.json";
import { getRepository } from "../../../../db/connection";

export const maxDuration = 30;
const promptVersion = "elementary-questions-v4";

const requestSchema = z.object({
  title: z.string().trim().max(120),
  subject: z.string().trim().min(2).max(30),
  learningGoal: z.string().trim().min(5).max(500),
  standards: z.array(z.object({
    code: z.string().trim().min(4).max(30),
    domain: z.string().trim().min(1).max(100),
    content: z.string().trim().min(5).max(600),
  })).min(1).max(5),
  count: z.number().int().min(1).max(5).default(3),
});

const questionItemSchema = z.object({
  prompt: z.string().trim().min(10).max(500).describe("학생에게 직접 제시할 명확한 평가 문항"),
  kind: z.enum(["선택형", "단답형", "서술형"]),
  standardCode: z.string().trim().min(4).max(30),
  criterion: z.enum(["개념 이해", "근거 제시", "논리적 설명"]),
  points: z.number().int().min(5).max(40),
  choices: z.array(z.string().trim().min(1).max(300)).max(8).describe("선택형 보기. 다른 유형은 빈 배열"),
  answerKey: z.array(z.string().trim().min(1).max(500)).max(10).describe("선택형 정답 1개 또는 단답형 인정 답안. 서술형은 빈 배열"),
});

const questionSchema = z.object({ questions: z.array(questionItemSchema) });

const safeProviderMetadata = (value: unknown) => {
  try { return JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>; }
  catch { return {}; }
};

const classifyGenerationError = (error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  if (errorMessage.includes("Free tier users")) return { status: 403, code: "credits_required", message: "AI 문항 생성을 사용하려면 Vercel AI Gateway 크레딧 연결이 필요합니다." };
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 402) return { status: 402, code: "budget_exceeded", message: "AI 사용 예산을 확인해 주세요." };
    if (error.statusCode === 403) return { status: 403, code: "credits_required", message: "AI 문항 생성을 사용하려면 Vercel AI Gateway 크레딧 연결이 필요합니다." };
    if (error.statusCode === 429) return { status: 429, code: "rate_limited", message: "요청이 많습니다. 잠시 뒤 다시 시도해 주세요." };
    if (error.statusCode === 503) return { status: 503, code: "provider_unavailable", message: "AI 서비스가 잠시 불안정합니다. 다시 시도해 주세요." };
    return { status: 502, code: `provider_${error.statusCode ?? "error"}`, message: "AI 문항 결과를 확인하지 못했습니다. 다시 시도해 주세요." };
  }
  return { status: 500, code: "generation_failed", message: "문항 초안을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
};

export async function POST(request: Request) {
  let teacherId: string;
  let body: unknown;
  try { teacherId = await requireTeacher(); body = await readMutation(request, 20000); }
  catch (error) { return apiError(error); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "평가 정보와 성취기준을 다시 확인해 주세요." }, { status: 400 });
  }

  const { title, subject, learningGoal, count } = parsed.data;
  const grade = Number(subject[0]);
  const gradeBand = grade <= 2 ? "1~2학년" : grade <= 4 ? "3~4학년" : "5~6학년";
  const standards = parsed.data.standards.map(item => curriculum.standards.find(s => s.code === item.code && s.subject === subject.split(" ")[1] && s.gradeBand === gradeBand));
  if (!/^[1-6]학년 /.test(subject) || standards.some(s => !s)) return Response.json({ error: "초등 학년군과 성취기준이 일치하지 않습니다." }, { status: 400 });
  const verifiedStandards = standards.filter(s => s !== undefined);
  const allowedCodes = new Set(verifiedStandards.map((standard) => standard.code));
  const standardsText = verifiedStandards
    .map((standard) => `- [${standard.code}] ${standard.domain}: ${standard.content}`)
    .join("\n");
  const model = process.env.AI_MODEL ?? "openai/gpt-5.6-luna";
  const generationInput = { title, subject, learningGoal, standards: verifiedStandards, count };
  const inputHash = createHash("sha256").update(JSON.stringify({ promptVersion, model, ...generationInput })).digest("hex");
  const repository = getRepository();
  try {
    const cached = await repository.findCompletedQuestionGeneration(teacherId, model, promptVersion, inputHash);
    const output = cached ? questionSchema.safeParse(cached.output) : null;
    if (cached && output?.success && output.data.questions.length === count) {
      return privateJson({ generationId: cached.id, model, questions: output.data.questions, usage: {
        inputTokens: cached.inputTokens, outputTokens: cached.outputTokens, totalTokens: cached.totalTokens,
      }, cached: true });
    }
  } catch (error) { return apiError(error); }

  const configuredLimit = Number(process.env.AI_QUESTIONS_PER_HOUR ?? 30);
  const hourlyLimit = Number.isInteger(configuredLimit) && configuredLimit > 0 && configuredLimit <= 1000 ? configuredLimit : 30;
  let generationId: string;
  try {
    await repository.consumeLimit(`ai-questions:${teacherId}`, hourlyLimit, 3600);
    generationId = (await repository.beginQuestionGeneration(teacherId, {
      model, promptVersion, inputHash, title, subject, learningGoal,
      standards: verifiedStandards, count,
    })).id;
  } catch (error) { return apiError(error); }

  const startedAt = Date.now();
  try {
    const allowedCodeValues = verifiedStandards.map(standard => standard.code) as [string, ...string[]];
    const generatedQuestionSchema = questionItemSchema.extend({
      standardCode: z.enum(allowedCodeValues).describe("선택한 성취기준 코드. 대괄호나 설명 없이 코드만 입력"),
    });
    const result = await generateText({
      model,
      output: Output.object({
        name: "ElementaryAssessmentQuestions",
        description: "초등학교 성취기준에 정렬된 교사용 평가 문항 초안",
        schema: z.object({ questions: z.array(generatedQuestionSchema).length(count) }),
      }),
      maxOutputTokens: 2600,
      system: [
        "당신은 대한민국 초등학교 교사를 돕는 학생평가 문항 설계 전문가입니다.",
        "반드시 제공된 2022 개정 교육과정 성취기준 범위 안에서만 문항을 만드세요.",
        "초등학생의 발달 수준에 맞는 쉬운 문장으로 쓰고, 정답을 문항에 노출하지 마세요.",
        "각 문항은 관찰 가능한 수행을 요구해야 하며 교사가 루브릭으로 판단할 수 있어야 합니다.",
        "kind는 선택형·단답형·서술형 중 학습 목표에 맞게 고르고, 설명·근거가 목표라면 서술형을 반드시 포함하세요.",
        "선택형은 prompt에 보기를 섞지 말고 choices에 서로 다른 보기 4개를 쓰며 answerKey에는 그중 정답 하나를 정확히 복사하세요.",
        "단답형은 choices를 비우고 answerKey에 허용할 정답 1~5개를 쓰세요. 서술형은 choices와 answerKey를 빈 배열로 쓰세요.",
      ].join("\n"),
      prompt: [
        `평가 이름: ${title || "새로운 학생 평가"}`,
        `학년·교과: ${subject}`,
        `학습 목표: ${learningGoal}`,
        "선택한 성취기준:",
        standardsText,
        `서로 겹치지 않는 평가 문항 ${count}개를 만드세요. standardCode에는 위 코드 중 하나를 대괄호 없이 정확히 복사하세요.`,
      ].join("\n"),
      providerOptions: {
        gateway: {
          tags: ["feature:question-generation", "scope:elementary"],
          user: teacherId,
        },
      },
    });

    const questions = result.output.questions;
    if (questions.some(question => !allowedCodes.has(question.standardCode))) {
      await repository.failQuestionGeneration(generationId, teacherId, {
        errorCode: "invalid_standard_mapping",
        errorMessage: "생성된 문항의 성취기준 연결을 검증하지 못했습니다.",
        latencyMs: Date.now() - startedAt,
      });
      return privateJson({ error: "생성된 문항의 성취기준 연결을 검증하지 못했습니다. 다시 생성해 주세요." }, 502);
    }
    if (questions.some(question =>
      (question.kind === "선택형" && (question.choices.length < 2 || question.answerKey.length !== 1 || !question.choices.includes(question.answerKey[0])))
      || (question.kind === "단답형" && question.answerKey.length < 1)
      || (question.kind === "서술형" && (question.choices.length > 0 || question.answerKey.length > 0))
    )) {
      await repository.failQuestionGeneration(generationId, teacherId, {
        errorCode: "invalid_question_type",
        errorMessage: "생성된 문항의 보기와 정답 구성을 검증하지 못했습니다.",
        latencyMs: Date.now() - startedAt,
      });
      return privateJson({ error: "문항 유형에 맞는 보기와 정답을 만들지 못했습니다. 다시 생성해 주세요." }, 502);
    }
    const completed = await repository.completeQuestionGeneration(generationId, teacherId, {
      output: { questions },
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
      },
      latencyMs: Date.now() - startedAt,
      providerMetadata: safeProviderMetadata(result.providerMetadata),
    });
    return privateJson({ generationId: completed.id, model, questions, usage: {
      inputTokens: completed.inputTokens, outputTokens: completed.outputTokens, totalTokens: completed.totalTokens,
    }, cached: false }, 201);
  } catch (error) {
    const failure = classifyGenerationError(error);
    await repository.failQuestionGeneration(generationId, teacherId, {
      errorCode: failure.code,
      errorMessage: failure.message,
      latencyMs: Date.now() - startedAt,
    }).catch(() => null);
    console.error("Question generation failed", { code: failure.code, type: error instanceof Error ? error.name : "UnknownError" });
    return privateJson({ error: failure.message }, failure.status);
  }
}
