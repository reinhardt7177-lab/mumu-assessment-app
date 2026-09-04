import { getDesignStudioRepository, getRepository } from "../../../../../../db/connection";
import { toAssessmentDefinition } from "../../../../../../lib/design-studio-domain";
import { requireTeacher } from "../../../../../../lib/teacher-auth";
import { apiError, privateJson, validateId } from "../../../../../../lib/http";

export async function POST(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const teacherId = await requireTeacher();
    const sessionId = validateId((await params).sessionId);
    const repository = getDesignStudioRepository();
    const session = await repository.get(sessionId, teacherId);
    const assessmentId = await repository.approve(sessionId, teacherId, toAssessmentDefinition(session));
    return privateJson({ session: await repository.get(sessionId, teacherId), assessment: await getRepository().getOwned(assessmentId, teacherId) });
  } catch (error) { return apiError(error); }
}
