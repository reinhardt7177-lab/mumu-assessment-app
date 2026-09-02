import { z } from "zod";
import { getClassroomRepository } from "../../../../../../db/connection";
import { AppError } from "../../../../../../lib/assessment-domain";
import { requireTeacher } from "../../../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation, validateId } from "../../../../../../lib/http";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ distributionId: string }> }) {
  try {
    const owner = await requireTeacher();
    const input = z.object({ status: z.literal("closed") }).strict().safeParse(await readMutation(request, 2000));
    if (!input.success) throw new AppError(400, "배포 마감 상태를 확인해 주세요.");
    const id = validateId((await params).distributionId);
    return privateJson({ distribution: await getClassroomRepository().closeDistribution(id, owner) });
  } catch (error) { return apiError(error); }
}
