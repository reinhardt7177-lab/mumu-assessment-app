import { getDesignStudioRepository } from "../../../../../../../db/connection";
import { competencyUnpackSchema, basicCompetencyDraft } from "../../../../../../../lib/design-studio-domain";
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
    const selected = session.standards.filter(item => item.state === "selected");
    if (!selected.length) throw new AppError(409, "먼저 평가할 성취기준을 선택해 주세요.");
    const inputJson = { learningGoal: session.learningGoal, sourceText: session.source?.text.slice(0, 12000), standards: selected };
    try {
      const result = await runDesignGeneration({
        teacherId, sessionId, feature: "competency_unpack", promptVersion: "elementary-competency-v1",
        schemaName: "ElementaryCompetencyUnpack", schemaDescription: "초등 교육과정 성취기준을 관찰 가능한 성공 기준으로 풀어쓴 결과",
        schema: competencyUnpackSchema, inputJson,
        system: [
          "당신은 대한민국 초등학교 교육과정과 학생평가 전문가입니다.",
          "제공된 성취기준을 벗어나지 말고, '이해한다' 같은 보이지 않는 표현을 관찰 가능한 학생 수행으로 바꾸세요.",
          "성공 기준은 서로 겹치지 않게 하고 학생 답안에서 확인할 증거를 구체적으로 쓰세요.",
          "id는 criterion-1 형식의 영문 소문자·숫자·하이픈만 사용하세요.",
          "교사가 최종 검토할 초안이므로 모호한 추측은 피하세요.",
        ].join("\n"),
        prompt: `학습 목표: ${session.learningGoal}\n\n성취기준:\n${selected.map(item => `[${item.code}] ${item.domain}: ${item.content}`).join("\n")}\n\n수업자료:\n${session.source?.text.slice(0, 12000) ?? "직접 입력 자료 없음"}`,
      });
      const allowed = new Set(selected.map(item => item.code));
      if (result.output.successCriteria.some(item => !allowed.has(item.standardCode))) throw new DesignAiError(502, "invalid_standard_mapping", "AI가 선택하지 않은 성취기준을 연결해 기본 초안을 제공했습니다.");
      return privateJson({ session: await repository.saveCompetency(sessionId, teacherId, result.output, "ai"), generation: { id: result.generationId, model: result.model, cached: result.cached, fallback: false } });
    } catch (error) {
      if (!(error instanceof DesignAiError)) throw error;
      const draft = basicCompetencyDraft(session);
      return privateJson({ session: await repository.saveCompetency(sessionId, teacherId, draft, "basic_draft"), generation: { fallback: true, warning: error.message } });
    }
  } catch (error) { return apiError(error); }
}
