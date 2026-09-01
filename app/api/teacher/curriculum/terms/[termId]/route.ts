import { getGrowthRepository } from "../../../../../../db/connection";
import { requireTeacher } from "../../../../../../lib/teacher-auth";
import { apiError, privateJson, validateId } from "../../../../../../lib/http";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ termId: string }> }) {
  try {
    const owner = await requireTeacher();
    const { termId } = await params;
    const id = validateId(termId);
    const repository = getGrowthRepository();
    const [dashboard, workflow] = await Promise.all([
      repository.getDashboard(id, owner),
      repository.getWorkflow(id, owner),
    ]);
    return privateJson({ dashboard, workflow });
  } catch (error) { return apiError(error); }
}
