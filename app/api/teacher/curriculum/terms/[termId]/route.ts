import { getGrowthRepository } from "../../../../../../db/connection";
import { requireTeacher } from "../../../../../../lib/teacher-auth";
import { apiError, privateJson, validateId } from "../../../../../../lib/http";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ termId: string }> }) {
  try {
    const owner = await requireTeacher();
    const { termId } = await params;
    return privateJson({ dashboard: await getGrowthRepository().getDashboard(validateId(termId), owner) });
  } catch (error) { return apiError(error); }
}
