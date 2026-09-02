import { getClassroomRepository } from "../../../../db/connection";
import { requireTeacher } from "../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation } from "../../../../lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const owner = await requireTeacher();
    return privateJson({ classes: await getClassroomRepository().listClasses(owner) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const owner = await requireTeacher();
    return privateJson({ classroom: await getClassroomRepository().createClass(owner, await readMutation(request, 10_000)) }, 201);
  } catch (error) { return apiError(error); }
}
