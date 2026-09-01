import { getRepository } from "../../../../../../db/connection";
import { requireTeacher } from "../../../../../../lib/teacher-auth";
import { apiError, privateJson, validateId } from "../../../../../../lib/http";

export async function GET(_request: Request, { params }: { params: Promise<{ generationId: string }> }) {
  try {
    const owner = await requireTeacher();
    const generationId = validateId((await params).generationId);
    const { id, title, subject, learningGoal, requestedCount, output, createdAt } = await getRepository().getQuestionGeneration(generationId, owner);
    return privateJson({ generation: { id, title, subject, learningGoal, requestedCount, output, createdAt } });
  } catch (error) { return apiError(error); }
}
