import { getGrowthRepository } from "../../../../../../../db/connection";
import { requireTeacher } from "../../../../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation, validateId } from "../../../../../../../lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ rubricId: string }> }) {
  try {
    const owner = await requireTeacher();
    await readMutation(request, 1_000);
    const { rubricId } = await params;
    return privateJson({ rubric: await getGrowthRepository().lockRubric(validateId(rubricId), owner) });
  } catch (error) { return apiError(error); }
}
