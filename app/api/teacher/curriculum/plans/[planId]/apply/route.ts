import { getGrowthRepository } from "../../../../../../../db/connection";
import { requireTeacher } from "../../../../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation, validateId } from "../../../../../../../lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const owner = await requireTeacher();
    const { planId } = await params;
    return privateJson({ term: await getGrowthRepository().applySchoolPlan(validateId(planId), owner, await readMutation(request)) }, 201);
  } catch (error) { return apiError(error); }
}
