import { getClassroomRepository } from "../../../../../../../db/connection";
import { requireTeacher } from "../../../../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation, validateId } from "../../../../../../../lib/http";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ classId: string; studentId: string }> }) {
  try {
    const owner = await requireTeacher();
    const values = await params;
    return privateJson({
      student: await getClassroomRepository().updateStudent(
        validateId(values.classId),
        validateId(values.studentId),
        owner,
        await readMutation(request, 10_000),
      ),
    });
  } catch (error) { return apiError(error); }
}
