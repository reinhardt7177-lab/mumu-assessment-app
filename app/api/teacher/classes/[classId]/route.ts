import { getClassroomRepository } from "../../../../../db/connection";
import { requireTeacher } from "../../../../../lib/teacher-auth";
import { apiError, privateJson, validateId } from "../../../../../lib/http";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ classId: string }> }) {
  try {
    const owner = await requireTeacher();
    const classId = validateId((await params).classId);
    return privateJson({ detail: await getClassroomRepository().getClassroom(classId, owner) });
  } catch (error) { return apiError(error); }
}
