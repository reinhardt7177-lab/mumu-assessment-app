import { getGrowthRepository } from "../../../../../../../db/connection";
import { requireTeacher } from "../../../../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation, validateId } from "../../../../../../../lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ termId: string }> }) {
  try {
    const owner = await requireTeacher();
    const { termId } = await params;
    return privateJson({ judgement: await getGrowthRepository().saveSemesterJudgement(validateId(termId), owner, await readMutation(request)) }, 201);
  } catch (error) { return apiError(error); }
}
