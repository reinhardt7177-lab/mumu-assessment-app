import { getGrowthRepository } from "../../../../../../../db/connection";
import { requireTeacher } from "../../../../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation, validateId } from "../../../../../../../lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ unitId: string }> }) {
  try {
    const owner = await requireTeacher();
    const { unitId } = await params;
    return privateJson({ event: await getGrowthRepository().createEvent(validateId(unitId), owner, await readMutation(request)) }, 201);
  } catch (error) { return apiError(error); }
}
