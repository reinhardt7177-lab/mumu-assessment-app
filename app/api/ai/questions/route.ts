import { APICallError, generateText, Output } from "ai";
import { z } from "zod";
import { requireTeacher } from "../../../../lib/teacher-auth";
import { apiError, readMutation } from "../../../../lib/http";
import curriculum from "../../../../data/achievement-standards.2022.json";
import { getRepository } from "../../../../db/connection";

export const maxDuration = 30;

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

const questionSchema = z.object({
  questions: z.array(z.object({
    prompt: z.string().trim().min(10).max(500).describe("학생에게 직접 제시할 명확한 평가 문항"),
    kind: z.enum(["서술형", "선택형"]),
    standardCode: z.string().trim().min(4).max(30),
    criterion: z.enum(["개념 이해", "근거 제시", "논리적 설명"]),
    points: z.number().int().min(5).max(40),
  })),
});

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
  const configuredLimit = Number(process.env.AI_QUESTIONS_PER_HOUR ?? 30);
  const hourlyLimit = Number.isInteger(configuredLimit) && configuredLimit > 0 && configuredLimit <= 1000 ? configuredLimit : 30;
  try { await getRepository().consumeLimit(`ai-questions:${teacherId}`, hourlyLimit, 3600); }
  catch (error) { return apiError(error); }
  const allowedCodes = new Set(verifiedStandards.map((standard) => standard.code));
  const standardsText = verifiedStandards
    .map((standard) => `- [${standard.code}] ${standard.domain}: ${standard.content}`)
    .join("\n");

  try {
    const result = await generateText({
      model: process.env.AI_MODEL ?? "openai/gpt-5.6-luna",
      output: Output.object({
        name: "ElementaryAssessmentQuestions",
        description: "초등학교 성취기준에 정렬된 교사용 평가 문항 초안",
        schema: questionSchema.extend({ questions: questionSchema.shape.questions.length(count) }),
      }),
      maxOutputTokens: 1800,
      system: [
        "당신은 대한민국 초등학교 교사를 돕는 학생평가 문항 설계 전문가입니다.",
        "반드시 제공된 2022 개정 교육과정 성취기준 범위 안에서만 문항을 만드세요.",
        "초등학생의 발달 수준에 맞는 쉬운 문장으로 쓰고, 정답을 문항에 노출하지 마세요.",
        "각 문항은 관찰 가능한 수행을 요구해야 하며 교사가 루브릭으로 판단할 수 있어야 합니다.",
        "현재는 글로 답하는 평가만 배포하므로 녹음, 사진 제출, 말하기 수행을 요구하지 마세요.",
        "선택형은 보기가 필요한 경우 문항 본문에 ①~④ 보기를 함께 포함하세요.",
      ].join("\n"),
      prompt: [
        `평가 이름: ${title || "새로운 학생 평가"}`,
        `학년·교과: ${subject}`,
        `학습 목표: ${learningGoal}`,
        "선택한 성취기준:",
        standardsText,
        `서로 겹치지 않는 평가 문항 ${count}개를 만드세요. standardCode에는 위 코드 중 하나만 사용하세요.`,
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
      return Response.json({ error: "생성된 문항의 성취기준 연결을 검증하지 못했습니다. 다시 생성해 주세요." }, { status: 502 });
    }

    return Response.json({
      model: process.env.AI_MODEL ?? "openai/gpt-5.6-luna",
      questions,
      usage: result.usage,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.includes("Free tier users")) {
      return Response.json({ error: "Luna 모델을 사용하려면 Vercel AI Gateway 유료 크레딧 연결이 필요합니다." }, { status: 403 });
    }
    if (APICallError.isInstance(error)) {
      if (error.statusCode === 402) return Response.json({ error: "AI 사용 예산을 확인해 주세요." }, { status: 402 });
      if (error.statusCode === 403) return Response.json({ error: "Luna 모델을 사용하려면 Vercel AI Gateway 유료 크레딧 연결이 필요합니다." }, { status: 403 });
      if (error.statusCode === 429) return Response.json({ error: "요청이 많습니다. 잠시 뒤 다시 시도해 주세요." }, { status: 429 });
      if (error.statusCode === 503) return Response.json({ error: "AI 서비스가 잠시 불안정합니다. 다시 시도해 주세요." }, { status: 503 });
    }
    console.error("Question generation failed", errorMessage);
    return Response.json({ error: "문항 초안을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요." }, { status: 500 });
  }
}
