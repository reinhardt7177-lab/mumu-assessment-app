import { getClassroomRepository } from "../../../../../../db/connection";
import { requireTeacher } from "../../../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation, validateId } from "../../../../../../lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ classId: string }> }) {
  try {
    const owner = await requireTeacher();
    const classId = validateId((await params).classId);
    return privateJson({ students: await getClassroomRepository().addStudents(classId, owner, await readMutation(request, 80_000)) }, 201);
  } catch (error) { return apiError(error); }
}
