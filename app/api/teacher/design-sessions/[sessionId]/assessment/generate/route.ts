import { getDesignStudioRepository } from "../../../../../../../db/connection";
import { z } from "zod";
import { assessmentGenerationDraftSchema, defaultQuestionPlan, questionPlanSchema, matchesQuestionPlan } from "../../../../../../../lib/design-studio-domain";
import { DesignAiError, runDesignGeneration } from "../../../../../../../lib/design-studio-ai";
import { AppError, validateAssessment } from "../../../../../../../lib/assessment-domain";
import { requireTeacher } from "../../../../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation, validateId } from "../../../../../../../lib/http";

export const maxDuration = 45;

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const teacherId = await requireTeacher();
    const requestInput = z.object({ questionPlan: questionPlanSchema.optional() }).safeParse(await readMutation(request, 2000));
    if (!requestInput.success) throw new AppError(400, "유형별 문항 수의 합계를 1~20개로 설정해 주세요.");
    const questionPlan = requestInput.data.questionPlan ?? defaultQuestionPlan;
    const sessionId = validateId((await params).sessionId);
    const repository = getDesignStudioRepository();
    const session = await repository.get(sessionId, teacherId);
    const rubric = session.blueprint?.rubric;
    if (!rubric?.length) throw new AppError(409, "먼저 루브릭을 완성해 주세요.");
    const selected = session.standards.filter(item => item.state === "selected");
    const methods = session.blueprint?.methods ?? ["text"];
    if (questionPlan.말하기 > 0 && !methods.includes("speech")) throw new AppError(400, "말하기 문항을 생성하려면 먼저 오럴 테스트를 선택해 주세요.");
    const grading = session.blueprint?.grading ?? { upperThreshold: 80, middleThreshold: 50 };
    const inputJson = { learningGoal: session.learningGoal, grade: session.grade, subject: session.subject, standards: selected, rubric, methods, questionPlan };
    try {
      const result = await runDesignGeneration({
        teacherId, sessionId, feature: "assessment_generation", promptVersion: "evidence-centered-questions-v3",
        maxOutputTokens: Math.min(12000, Object.values(questionPlan).reduce((sum, count) => sum + count, 0) * 600 + 1500),
        schemaName: "EvidenceCenteredAssessment", schemaDescription: "성취기준과 루브릭에 정렬된 초등 유형별 평가 문항",
        schema: assessmentGenerationDraftSchema, inputJson,
        system: [
          "당신은 초등학교 증거중심 평가 문항 설계 전문가입니다.",
          "문항은 학생이 무엇을 알고 할 수 있는지 설명·근거·적용으로 드러내게 하세요.",
          "각 문항은 반드시 하나의 제공된 성취기준과 하나의 루브릭 기준에 연결하세요.",
          "학생의 발달 수준에 맞는 짧고 명확한 문장으로 쓰고 정답 단서를 문항 본문에 노출하지 마세요.",
          "kind는 교사가 지정한 유형별 개수를 정확하게 따르세요. 각 유형 안에서 학습 목표에 맞는 수행 증거를 확보하세요.",
          "선택형은 choices에 서로 다른 보기 4개를 쓰고 answerKey에는 그중 정답 하나를 정확히 복사하세요.",
          "단답형은 choices를 비우고 answerKey에 허용할 정답 1~5개를 쓰세요. 서술형·말하기는 choices와 answerKey를 비우세요.",
          "말하기는 오럴 테스트(speech)가 선택된 경우에만 사용하세요. 선택된 응답 방식은 맥락으로 활용하되 기기 조작이 성취를 대신 측정하지 않게 하세요.",
          `id는 question-1 형식만 사용하세요. 유형별 문항 수는 ${JSON.stringify(questionPlan)} 입니다.`,
        ].join("\n"),
        prompt: `${session.grade}학년 ${session.subject}\n학습 목표: ${session.learningGoal}\n응답 방식: ${methods.join(", ")}\n\n성취기준:\n${selected.map(item => `[${item.code}] ${item.content}`).join("\n")}\n\n루브릭:\n${JSON.stringify(rubric, null, 2)}`,
      });
      const questions = result.output.questions.map(question => ({ ...question, responseMethods: question.kind === "말하기" ? ["speech" as const] : methods.includes("text") ? ["text" as const] : methods }));
      try {
      const allowedCodes = new Set(selected.map(item => item.code));
      if (!matchesQuestionPlan(result.output.questions, questionPlan)) throw new DesignAiError(502, "question_count_mismatch", "요청한 유형별 문항 수와 AI 결과가 다릅니다.");
      const allowedPairs = new Set(rubric.map(item => `${item.standardCode}:${item.name}`));
      if (result.output.questions.some(item => !allowedCodes.has(item.standardCode) || !allowedPairs.has(`${item.standardCode}:${item.criterion}`))) {
        throw new DesignAiError(502, "invalid_question_mapping", "AI 문항과 루브릭 연결을 검증하지 못해 기본 초안을 제공했습니다.");
      }
      if (result.output.questions.some(item =>
        (item.kind === "선택형" && ((item.choices ?? []).length < 2 || (item.answerKey ?? []).length !== 1 || !(item.choices ?? []).includes((item.answerKey ?? [])[0])))
        || (item.kind === "단답형" && !(item.answerKey ?? []).length)
        || (item.kind === "말하기" && !methods.includes("speech"))
      )) {
        throw new DesignAiError(502, "invalid_question_type", "AI가 만든 보기·정답 또는 응답 방식이 맞지 않아 기본 초안을 제공했습니다.");
      }
      validateAssessment({ title: session.title, subject: `${session.grade}학년 ${session.subject}`, learningGoal: session.learningGoal, type: "독립 수행평가", standardCodes: selected.map(item => item.code), questions, rubric, methods, grading });
      } catch (error) {
        await repository.rejectGeneration(result.generationId, teacherId, "요청한 문항 수·유형·루브릭 연결 검증에 실패했습니다.");
        throw error;
      }
      return privateJson({ session: await repository.saveBlueprint(sessionId, teacherId, { rubric, questions, methods, grading, source: "ai" }), generation: { id: result.generationId, model: result.model, cached: result.cached, fallback: false } });
    } catch (error) {
      if (!(error instanceof DesignAiError)) throw error;
      throw new AppError(error.status, "문항 초안 생성을 완료하지 못했습니다. 기존 문항은 유지되며 설정을 확인한 뒤 다시 시도할 수 있습니다.");
    }
  } catch (error) { return apiError(error); }
}
