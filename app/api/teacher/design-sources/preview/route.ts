import { AppError } from "../../../../../lib/assessment-domain";
import { extractCurriculumDocument } from "../../../../../lib/curriculum-import";
import { requireTeacher } from "../../../../../lib/teacher-auth";
import { apiError, privateJson, readFormDataMutation } from "../../../../../lib/http";

export const runtime = "nodejs";

const subjects = ["국어", "사회", "수학", "과학", "도덕", "영어"] as const;

function firstMatch(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  return match?.[1]?.replace(/^[\s:：·-]+|[\s]+$/g, "").slice(0, 1000) ?? "";
}

function analyzeSource(fileName: string, text: string) {
  const sample = (fileName + "\n" + text.slice(0, 12000)).replace(/\u0000/g, "");
  const detectedGrade = Number(firstMatch(sample, /([1-6])\s*학년/));
  const grade = detectedGrade >= 1 && detectedGrade <= 6 ? detectedGrade : 6;
  const subject = subjects.find(item => new RegExp("(^|[\\s·_()\[\]-])" + item + "(과|[\\s·_()\[\]-]|$)", "m").test(sample)) ?? "사회";
  const unit = firstMatch(sample, /(?:단원(?:명)?|수업\s*주제|주제)\s*[:：]?\s*([^\r\n]{2,100})/i);
  const goal = firstMatch(sample, /(?:학습\s*목표|성취\s*목표|평가\s*목표|평가\s*중점)\s*[:：]?\s*([^\r\n]{5,500})/i);
  const baseName = fileName.replace(/\.[^.]+$/, "").replace(/[+_]+/g, " ").trim().slice(0, 100);
  const rawTitle = unit || baseName || "새 수업";
  const title = /평가/.test(rawTitle) ? rawTitle : rawTitle + " 평가";
  const learningGoal = goal || "업로드한 수업자료의 핵심 개념을 이해하고 구체적인 근거를 들어 설명한다.";
  const warnings: string[] = [];
  if (!detectedGrade) warnings.push("학년을 명확히 찾지 못해 6학년으로 제안했습니다.");
  if (!goal) warnings.push("학습 목표를 명확히 찾지 못해 기본 문구를 제안했습니다.");

  return { title: title.slice(0, 120), grade, subject, learningGoal: learningGoal.slice(0, 1000), warnings };
}

export async function POST(request: Request) {
  try {
    await requireTeacher();
    const form = await readFormDataMutation(request);
    const file = form.get("file");
    if (!(file instanceof Blob) || typeof (file as File).name !== "string") {
      throw new AppError(400, "지도안 또는 평가계획 파일을 선택해 주세요.");
    }
    const sourceFile = file as File;
    const extracted = await extractCurriculumDocument(sourceFile);
    if (extracted.text.length < 5) {
      throw new AppError(422, "문서에서 글자를 추출하지 못했습니다. 이미지형 PDF는 OCR 변환 후 다시 올려 주세요.");
    }
    const text = extracted.text.slice(0, 50000);
    return privateJson({
      source: {
        kind: "upload",
        fileName: sourceFile.name,
        mimeType: sourceFile.type || "application/octet-stream",
        sha256: extracted.sha256,
        text,
      },
      analysis: analyzeSource(sourceFile.name, text),
      extraction: { characterCount: extracted.text.length },
    });
  } catch (error) {
    return apiError(error);
  }
}
