import { getDesignStudioRepository } from "../../../../../../../db/connection";
import { assessmentDraftSchema, basicQuestionDraft } from "../../../../../../../lib/design-studio-domain";
import { DesignAiError, runDesignGeneration } from "../../../../../../../lib/design-studio-ai";
import { AppError } from "../../../../../../../lib/assessment-domain";
import { requireTeacher } from "../../../../../../../lib/teacher-auth";
import { apiError, privateJson, validateId } from "../../../../../../../lib/http";

export const maxDuration = 45;

export async function POST(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const teacherId = await requireTeacher();
    const sessionId = validateId((await params).sessionId);
    const repository = getDesignStudioRepository();
    const session = await repository.get(sessionId, teacherId);
    const rubric = session.blueprint?.rubric;
    if (!rubric?.length) throw new AppError(409, "먼저 루브릭을 완성해 주세요.");
    const selected = session.standards.filter(item => item.state === "selected");
    const inputJson = { learningGoal: session.learningGoal, grade: session.grade, subject: session.subject, standards: selected, rubric };
    try {
      const result = await runDesignGeneration({
        teacherId, sessionId, feature: "assessment_generation", promptVersion: "evidence-centered-questions-v1",
        schemaName: "EvidenceCenteredAssessment", schemaDescription: "성취기준과 루브릭에 정렬된 초등 서술형 평가 문항",
        schema: assessmentDraftSchema, inputJson,
        system: [
          "당신은 초등학교 증거중심 평가 문항 설계 전문가입니다.",
          "문항은 학생이 무엇을 알고 할 수 있는지 설명·근거·적용으로 드러내게 하세요.",
          "각 문항은 반드시 하나의 제공된 성취기준과 하나의 루브릭 기준에 연결하세요.",
          "학생의 발달 수준에 맞는 짧고 명확한 문장으로 쓰고 정답 단서를 노출하지 마세요.",
          "현재 배포 가능 응답은 글쓰기뿐이므로 사진·녹음·챗봇 사용을 요구하지 마세요.",
          "id는 question-1 형식만 사용하고, 총 2~5문항으로 구성하세요.",
        ].join("\n"),
        prompt: `${session.grade}학년 ${session.subject}\n학습 목표: ${session.learningGoal}\n\n성취기준:\n${selected.map(item => `[${item.code}] ${item.content}`).join("\n")}\n\n루브릭:\n${JSON.stringify(rubric, null, 2)}`,
      });
      const allowedCodes = new Set(selected.map(item => item.code));
      const allowedPairs = new Set(rubric.map(item => `${item.standardCode}:${item.name}`));
      if (result.output.questions.some(item => !allowedCodes.has(item.standardCode) || !allowedPairs.has(`${item.standardCode}:${item.criterion}`))) {
        throw new DesignAiError(502, "invalid_question_mapping", "AI 문항과 루브릭 연결을 검증하지 못해 기본 초안을 제공했습니다.");
      }
      return privateJson({ session: await repository.saveBlueprint(sessionId, teacherId, { rubric, questions: result.output.questions, source: "ai" }), generation: { id: result.generationId, model: result.model, cached: result.cached, fallback: false } });
    } catch (error) {
      if (!(error instanceof DesignAiError)) throw error;
      const questions = basicQuestionDraft(rubric);
      return privateJson({ session: await repository.saveBlueprint(sessionId, teacherId, { rubric, questions, source: "basic_draft" }), generation: { fallback: true, warning: error.message } });
    }
  } catch (error) { return apiError(error); }
}
