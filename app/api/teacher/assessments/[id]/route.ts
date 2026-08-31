import { getRepository } from "../../../../../db/connection";
import { requireTeacher } from "../../../../../lib/teacher-auth";
import { apiError, privateJson, validateId } from "../../../../../lib/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const owner = await requireTeacher();
    const id = validateId((await params).id);
    const repo = getRepository();
    const [assessment, submissions] = await Promise.all([repo.getOwned(id, owner), repo.submissions(id, owner)]);
    return privateJson({ assessment, submissions });
  } catch (error) { return apiError(error); }
}
