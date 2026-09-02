import { getClassroomRepository } from "../../../../db/connection";
import { requireTeacher } from "../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation, validateId } from "../../../../lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const owner = await requireTeacher();
    const rawClassId = new URL(request.url).searchParams.get("classId");
    const classId = rawClassId ? validateId(rawClassId) : undefined;
    return privateJson({ distributions: await getClassroomRepository().listDistributions(owner, classId) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const owner = await requireTeacher();
    return privateJson({ distribution: await getClassroomRepository().createDistribution(owner, await readMutation(request, 20_000)) }, 201);
  } catch (error) { return apiError(error); }
}
