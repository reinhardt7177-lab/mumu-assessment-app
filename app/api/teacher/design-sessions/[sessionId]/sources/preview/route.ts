import { extractCurriculumDocument } from "../../../../../../../lib/curriculum-import";
import { AppError } from "../../../../../../../lib/assessment-domain";
import { getDesignStudioRepository } from "../../../../../../../db/connection";
import { requireTeacher } from "../../../../../../../lib/teacher-auth";
import { apiError, privateJson, readFormDataMutation, validateId } from "../../../../../../../lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const teacherId = await requireTeacher();
    const sessionId = validateId((await params).sessionId);
    await getDesignStudioRepository().get(sessionId, teacherId);
    const form = await readFormDataMutation(request);
    const file = form.get("file");
    if (!(file instanceof Blob) || typeof (file as File).name !== "string") throw new AppError(400, "수업안 또는 교육과정 문서를 선택해 주세요.");
    const extracted = await extractCurriculumDocument(file as File);
    if (extracted.text.length < 5) throw new AppError(422, "문서에서 글자를 추출하지 못했습니다. 이미지형 PDF는 OCR 변환 후 다시 올려 주세요.");
    return privateJson({ source: { kind: "upload", fileName: (file as File).name, mimeType: file.type || "application/octet-stream", sha256: extracted.sha256, text: extracted.text.slice(0, 50000) }, extraction: { characterCount: extracted.text.length } });
  } catch (error) { return apiError(error); }
}
