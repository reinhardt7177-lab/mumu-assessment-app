import { getEvidenceRepository } from "../../../../../../db/connection";
import { apiError, privateJson, validateId } from "../../../../../../lib/http";
import { requireTeacher } from "../../../../../../lib/teacher-auth";

export async function GET(_request: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  try {
    const teacherId = await requireTeacher();
    return privateJson({ responses: await getEvidenceRepository().listOwnedAttemptResponses(validateId((await params).attemptId), teacherId) });
  } catch (error) { return apiError(error); }
}
