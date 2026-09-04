import { getDesignStudioRepository } from "../../../../../../../db/connection";
import { basicRubricDraft, rubricDraftSchema } from "../../../../../../../lib/design-studio-domain";
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
    if (!session.competency) throw new AppError(409, "먼저 성공 기준을 생성하거나 입력해 주세요.");
    const selected = session.standards.filter(item => item.state === "selected");
    const inputJson = { learningGoal: session.learningGoal, standards: selected, competency: session.competency };
    try {
      const result = await runDesignGeneration({
        teacherId, sessionId, feature: "rubric_generation", promptVersion: "criterion-rubric-v1",
        schemaName: "CriterionReferencedRubric", schemaDescription: "성공 기준별 상·중·하 준거참조 루브릭",
        schema: rubricDraftSchema, inputJson,
        system: [
          "당신은 준거참조 루브릭 설계 전문가입니다.",
          "각 기준은 독립적이고 학생 답안에서 직접 관찰 가능해야 합니다.",
          "상·중·하는 '매우/조금' 같은 양적 표현이 아니라 정확성, 근거, 연결의 질적 차이로 서술하세요.",
          "낙인 표현을 쓰지 말고 '아직 드러나지 않음', '안내가 필요함'처럼 성장 가능성을 담으세요.",
          "id와 standardCode는 입력 성공 기준을 그대로 사용하세요.",
        ].join("\n"),
        prompt: `학습 목표: ${session.learningGoal}\n\n성취기준:\n${selected.map(item => `[${item.code}] ${item.content}`).join("\n")}\n\n성공 기준:\n${JSON.stringify(session.competency.successCriteria, null, 2)}`,
      });
      const allowed = new Set(selected.map(item => item.code));
      if (result.output.rubric.some(item => !allowed.has(item.standardCode))) throw new DesignAiError(502, "invalid_standard_mapping", "AI 루브릭의 성취기준 연결을 검증하지 못해 기본 초안을 제공했습니다.");
      return privateJson({ session: await repository.saveBlueprint(sessionId, teacherId, { rubric: result.output.rubric, questions: session.blueprint?.questions ?? [], source: "ai" }), generation: { id: result.generationId, model: result.model, cached: result.cached, fallback: false } });
    } catch (error) {
      if (!(error instanceof DesignAiError)) throw error;
      const rubric = basicRubricDraft(session.competency);
      return privateJson({ session: await repository.saveBlueprint(sessionId, teacherId, { rubric, questions: session.blueprint?.questions ?? [], source: "basic_draft" }), generation: { fallback: true, warning: error.message } });
    }
  } catch (error) { return apiError(error); }
}
