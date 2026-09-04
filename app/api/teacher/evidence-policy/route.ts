import { getEvidenceRepository } from "../../../../db/connection";
import { AppError } from "../../../../lib/assessment-domain";
import { evidencePolicyInputSchema } from "../../../../lib/evidence-domain";
import { EvidenceAiError, listEvidenceAiProviders, resolveEvidenceAiProvider } from "../../../../lib/evidence-ai";
import { requireTeacher } from "../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation } from "../../../../lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const teacherId = await requireTeacher();
    return privateJson({
      policy: await getEvidenceRepository().getPolicy(teacherId),
      providers: listEvidenceAiProviders(),
    });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request) {
  try {
    const teacherId = await requireTeacher();
    const input = evidencePolicyInputSchema.safeParse(await readMutation(request, 5_000));
    if (!input.success) throw new AppError(400, input.error.issues[0]?.message ?? "학생 증거 AI 사용 설정을 확인해 주세요.");
    if (input.data.enabled) {
      try { resolveEvidenceAiProvider(input.data.providerId); }
      catch (error) {
        if (error instanceof EvidenceAiError) throw new AppError(error.status, error.message);
        throw error;
      }
    }
    return privateJson({ policy: await getEvidenceRepository().savePolicy(teacherId, input.data) });
  } catch (error) { return apiError(error); }
}