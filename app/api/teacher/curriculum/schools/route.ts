import { getGrowthRepository } from "../../../../../db/connection";
import { requireTeacher } from "../../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation } from "../../../../../lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const owner = await requireTeacher();
    return privateJson({ schools: await getGrowthRepository().listSchools(owner) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const owner = await requireTeacher();
    return privateJson({ school: await getGrowthRepository().createSchool(owner, await readMutation(request)) }, 201);
  } catch (error) { return apiError(error); }
}
