import { previewCurriculumDocument } from "../../../../../../lib/curriculum-import";
import { AppError } from "../../../../../../lib/assessment-domain";
import { validateImportContext } from "../../../../../../lib/school-curriculum-domain";
import { requireTeacher } from "../../../../../../lib/teacher-auth";
import { apiError, privateJson, readFormDataMutation } from "../../../../../../lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireTeacher();
    const form = await readFormDataMutation(request);
    const file = form.get("file");
    if (!(file instanceof Blob) || typeof (file as File).name !== "string") throw new AppError(400, "가져올 문서를 선택해 주세요.");
    const context = validateImportContext({
      documentKind: form.get("documentKind"),
      schoolYear: form.get("schoolYear"),
      grade: form.get("grade"),
      semester: form.get("semester"),
      subject: form.get("subject"),
    });
    return privateJson({ preview: await previewCurriculumDocument(file as File, context) });
  } catch (error) { return apiError(error); }
}
