import { getDesignStudioRepository } from "../../../../db/connection";
import { designSessionCreateSchema } from "../../../../lib/design-studio-domain";
import { AppError } from "../../../../lib/assessment-domain";
import { requireTeacher } from "../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation } from "../../../../lib/http";

export async function GET() {
  try { const teacherId = await requireTeacher(); return privateJson({ sessions: await getDesignStudioRepository().list(teacherId) }); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const teacherId = await requireTeacher();
    const parsed = designSessionCreateSchema.safeParse(await readMutation(request, 60000));
    if (!parsed.success) throw new AppError(400, "평가 이름·학년·교과·학습 목표·수업자료를 확인해 주세요.");
    const input = parsed.data;
    return privateJson({ session: await getDesignStudioRepository().create(teacherId, input) }, 201);
  } catch (error) { return apiError(error); }
}
