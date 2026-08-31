import { z } from "zod";
import { getRepository } from "../../../../../../db/connection";
import { requireTeacher } from "../../../../../../lib/teacher-auth";
import { AppError } from "../../../../../../lib/assessment-domain";
import { apiError, privateJson, readMutation, validateId } from "../../../../../../lib/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const owner = await requireTeacher();
    const id = validateId((await params).id);
    const input = z.object({ status: z.enum(["published", "closed"]) }).safeParse(await readMutation(request));
    if (!input.success) throw new AppError(400, "변경할 평가 상태를 확인해 주세요.");
    return privateJson({ assessment: await getRepository().setStatus(id, owner, input.data.status) });
  } catch (error) { return apiError(error); }
}
