import { getGrowthRepository } from "../../../../../../../db/connection";
import { requireTeacher } from "../../../../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation, validateId } from "../../../../../../../lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ evidenceId: string }> }) {
  try {
    const owner = await requireTeacher();
    const { evidenceId } = await params;
    return privateJson({ judgement: await getGrowthRepository().saveJudgement(validateId(evidenceId), owner, await readMutation(request)) }, 201);
  } catch (error) { return apiError(error); }
}
