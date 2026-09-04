import { getDesignStudioRepository } from "../../../../../../../db/connection";
import { suggestAlignedStandards } from "../../../../../../../lib/design-studio-domain";
import { requireTeacher } from "../../../../../../../lib/teacher-auth";
import { apiError, privateJson, validateId } from "../../../../../../../lib/http";

export async function POST(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const teacherId = await requireTeacher();
    const sessionId = validateId((await params).sessionId);
    const repository = getDesignStudioRepository();
    const session = await repository.get(sessionId, teacherId);
    const standards = suggestAlignedStandards({ grade: session.grade, subject: session.subject, learningGoal: session.learningGoal, sourceText: session.source?.text ?? "" });
    return privateJson({ session: await repository.saveStandards(sessionId, teacherId, standards), method: "official-curriculum-keyword-alignment" });
  } catch (error) { return apiError(error); }
}
