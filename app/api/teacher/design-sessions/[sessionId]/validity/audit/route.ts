import { getDesignStudioRepository } from "../../../../../../../db/connection";
import { runDeterministicValidityAudit, validityAuditSchema, type ValidityAudit } from "../../../../../../../lib/design-studio-domain";
import { DesignAiError, runDesignGeneration } from "../../../../../../../lib/design-studio-ai";
import { AppError } from "../../../../../../../lib/assessment-domain";
import { requireTeacher } from "../../../../../../../lib/teacher-auth";
import { apiError, privateJson, validateId } from "../../../../../../../lib/http";

export const maxDuration = 45;

function mergeAudit(ai: ValidityAudit, baseline: ValidityAudit): ValidityAudit {
  const threats = [...baseline.threats, ...ai.threats].filter((item, index, all) => all.findIndex(other => other.issue === item.issue) === index).slice(0, 12);
  const blocked = baseline.blocked || ai.blocked || threats.some(item => item.severity === "major");
  return validityAuditSchema.parse({
    ...ai,
    blocked,
    fitForPurpose: !blocked && ai.fitForPurpose,
    overall: blocked ? "재설계 필요" : threats.length ? "보완 후 적합" : "적합",
    threats,
    recommendations: [...new Set([...baseline.recommendations, ...ai.recommendations])].slice(0, 12),
  });
}

export async function POST(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const teacherId = await requireTeacher();
    const sessionId = validateId((await params).sessionId);
    const repository = getDesignStudioRepository();
    const session = await repository.get(sessionId, teacherId);
    if (!session.blueprint?.rubric.length || !session.blueprint.questions.length) throw new AppError(409, "루브릭과 평가 문항을 모두 완성해 주세요.");
    const baseline = runDeterministicValidityAudit({ learningGoal: session.learningGoal, standards: session.standards, rubric: session.blueprint.rubric, questions: session.blueprint.questions, methods: session.blueprint.methods });
    const inputJson = { learningGoal: session.learningGoal, grade: session.grade, subject: session.subject, standards: session.standards.filter(item => item.state === "selected"), rubric: session.blueprint.rubric, questions: session.blueprint.questions, methods: session.blueprint.methods };
    try {
      const result = await runDesignGeneration({
        teacherId, sessionId, feature: "validity_audit", promptVersion: "classroom-validity-v2",
        schemaName: "AssessmentValidityAudit", schemaDescription: "구인·내용·신뢰도·결과 타당도를 점검한 교사용 평가 품질 감사",
        schema: validityAuditSchema, inputJson,
        system: [
          "당신은 Messick의 타당도 관점과 교실평가 원리를 적용하는 평가 품질 검토자입니다.",
          "이 평가는 무엇을 측정하는지가 아니라 결과를 어떤 목적으로 해석·사용할 수 있는지를 검토하세요.",
          "구인 무관 변인, 구인 과소대표, 채점자 간 신뢰도, 학생 집단별 불공정 장벽, 표면학습 유발 가능성을 확인하세요.",
          "성취기준 또는 루브릭 연결 누락, 채점 불가능한 문항은 major이며 blocked=true로 하세요.",
          "객관식·단답형·서술형·말하기의 조합이 의도한 학습을 충분히 표집하는지, 문항 유형과 응답 방식이 맞는지도 확인하세요.",
          "비판만 하지 말고 교사가 바로 고칠 수 있는 문장으로 권고하세요.",
        ].join("\n"),
        prompt: `평가 목적: 초등 교실의 형성평가 및 단원 성취 판단\n${JSON.stringify(inputJson, null, 2)}`,
        maxOutputTokens: 3200,
      });
      const validity = mergeAudit(result.output, baseline);
      return privateJson({ session: await repository.saveValidity(sessionId, teacherId, validity, "ai"), generation: { id: result.generationId, model: result.model, cached: result.cached, fallback: false } });
    } catch (error) {
      if (!(error instanceof DesignAiError)) throw error;
      return privateJson({ session: await repository.saveValidity(sessionId, teacherId, baseline, "basic_draft"), generation: { fallback: true, warning: error.message } });
    }
  } catch (error) { return apiError(error); }
}
