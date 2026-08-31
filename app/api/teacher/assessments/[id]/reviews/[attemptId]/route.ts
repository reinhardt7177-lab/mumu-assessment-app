import { getRepository } from "../../../../../../../db/connection";
import { requireTeacher } from "../../../../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation, validateId } from "../../../../../../../lib/http";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; attemptId: string }> }) {
  try {
    const owner = await requireTeacher();
    const { id, attemptId } = await params;
    return privateJson({ review: await getRepository().saveReview(validateId(id), validateId(attemptId), owner, await readMutation(request)) });
  } catch (error) { return apiError(error); }
}
