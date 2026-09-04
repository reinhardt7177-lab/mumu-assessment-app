import { getEvidenceRepository } from "../../../../../../../../db/connection";
import { apiError, privateJson, readMutation, validateId } from "../../../../../../../../lib/http";
import { requireTeacher } from "../../../../../../../../lib/teacher-auth";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ attemptId: string; responseId: string }> }) {
  try {
    const teacherId = await requireTeacher();
    const { attemptId, responseId } = await params;
    const repository = getEvidenceRepository();
    const correction = await repository.saveTeacherCorrection(
      validateId(responseId),
      validateId(attemptId),
      teacherId,
      await readMutation(request, 55_000),
    );
    return privateJson({
      correction,
      responses: await repository.listOwnedAttemptResponses(attemptId, teacherId),
    }, 201);
  } catch (error) { return apiError(error); }
}