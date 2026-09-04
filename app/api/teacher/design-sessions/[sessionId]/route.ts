import { getDesignStudioRepository } from "../../../../../db/connection";
import { designDraftPatchSchema, verifyAlignmentCandidates } from "../../../../../lib/design-studio-domain";
import { AppError } from "../../../../../lib/assessment-domain";
import { requireTeacher } from "../../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation, validateId } from "../../../../../lib/http";

export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const teacherId = await requireTeacher();
    const { sessionId } = await params;
    return privateJson({ session: await getDesignStudioRepository().get(validateId(sessionId), teacherId) });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const teacherId = await requireTeacher();
    const { sessionId: rawId } = await params;
    const sessionId = validateId(rawId);
    const parsed = designDraftPatchSchema.safeParse(await readMutation(request, 80000));
    if (!parsed.success) throw new AppError(400, "수정할 평가 설계 내용을 확인해 주세요.");
    const input = parsed.data;
    const repository = getDesignStudioRepository();
    let session = await repository.get(sessionId, teacherId);
    if (input.title || input.learningGoal || input.currentStep) session = await repository.updateBasics(sessionId, teacherId, input);
    if (input.source) session = await repository.saveSource(sessionId, teacherId, input.source);
    if (input.standards) session = await repository.saveStandards(sessionId, teacherId, verifyAlignmentCandidates(session.grade, session.subject, input.standards));
    if (input.competency) session = await repository.saveCompetency(sessionId, teacherId, input.competency, "teacher");
    if (input.rubric || input.questions) {
      const rubric = input.rubric ?? session.blueprint?.rubric;
      const questions = input.questions ?? session.blueprint?.questions ?? [];
      if (!rubric) throw new AppError(409, "먼저 루브릭 초안을 만들어 주세요.");
      session = await repository.saveBlueprint(sessionId, teacherId, { rubric, questions, source: "teacher" });
    }
    if (input.validity) session = await repository.saveValidity(sessionId, teacherId, input.validity, "teacher");
    return privateJson({ session });
  } catch (error) { return apiError(error); }
}
