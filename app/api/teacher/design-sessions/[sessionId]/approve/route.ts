import { getDesignStudioRepository, getRepository } from "../../../../../../db/connection";
import { toAssessmentDefinition } from "../../../../../../lib/design-studio-domain";
import { curriculumAssessmentLinkSchema, AppError } from "../../../../../../lib/assessment-domain";
import { requireTeacher } from "../../../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation, validateId } from "../../../../../../lib/http";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const teacherId = await requireTeacher();
    const sessionId = validateId((await params).sessionId);
    const repository = getDesignStudioRepository();
    const session = await repository.get(sessionId, teacherId);
    const link = curriculumAssessmentLinkSchema.safeParse(await readMutation(request, 5000));
    if (!link.success) throw new AppError(400, "성장 기록을 연결할 학급 단원과 평가 시기를 선택해 주세요.");
    const assessmentId = await repository.approveInUnit(sessionId, teacherId, toAssessmentDefinition(session), link.data);
    return privateJson({ session: await repository.get(sessionId, teacherId), assessment: await getRepository().getOwned(assessmentId, teacherId) });
  } catch (error) { return apiError(error); }
}
