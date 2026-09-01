import { getGrowthRepository } from "../../../../../../../db/connection";
import { requireTeacher } from "../../../../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation, validateId } from "../../../../../../../lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ unitStandardId: string }> }) {
  try {
    const owner = await requireTeacher();
    const { unitStandardId } = await params;
    return privateJson({ rubric: await getGrowthRepository().createRubric(validateId(unitStandardId), owner, await readMutation(request)) }, 201);
  } catch (error) { return apiError(error); }
}
