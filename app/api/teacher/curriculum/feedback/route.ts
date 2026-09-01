import { getGrowthRepository } from "../../../../../db/connection";
import { requireTeacher } from "../../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation } from "../../../../../lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const owner = await requireTeacher();
    return privateJson({ feedback: await getGrowthRepository().createFeedback(owner, await readMutation(request)) }, 201);
  } catch (error) { return apiError(error); }
}
