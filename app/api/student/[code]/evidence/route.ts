import { cookies } from "next/headers";
import { getEvidenceRepository, getRepository } from "../../../../../db/connection";
import { AppError } from "../../../../../lib/assessment-domain";
import { removePrivateEvidence, storePrivateEvidence, validateEvidenceFile } from "../../../../../lib/evidence-storage";
import { apiError, privateJson, readFormDataMutation, validateCode } from "../../../../../lib/http";

export const runtime = "nodejs";
export const maxDuration = 30;

function safeOriginalFilename(value: string) {
  return Array.from(value, character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? "_" : character;
  }).join("").slice(0, 240);
}

async function studentAttempt(code: string) {
  const token = (await cookies()).get(`mumu_attempt_${code}`)?.value;
  if (!token) throw new AppError(401, "먼저 번호 또는 별칭으로 참여해 주세요.");
  return getRepository().getAttempt(code, token);
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const code = validateCode((await params).code);
    const attempt = await studentAttempt(code);
    const repository = getEvidenceRepository();
    const [responses, policy] = await Promise.all([
      repository.listAttemptResponses(attempt.id),
      repository.getStudentPolicy(attempt.id),
    ]);
    return privateJson({ responses, policy });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  let storedPathname: string | null = null;
  try {
    const code = validateCode((await params).code);
    const attempt = await studentAttempt(code);
    if (attempt.status !== "in_progress") throw new AppError(409, "이미 제출한 답안에는 파일을 추가할 수 없습니다.");
    const form = await readFormDataMutation(request, 3_500_000);
    const questionId = String(form.get("questionId") ?? "");
    const modality = String(form.get("modality") ?? "");
    const file = form.get("file");
    const durationValue = Number(form.get("durationSeconds") ?? 0);
    const identifiersRemovedConfirmed = form.get("identifiersRemoved") === "true";
    if (!/^[\w-]{1,64}$/.test(questionId) || (modality !== "photo" && modality !== "speech" && modality !== "screen") || !(file instanceof File)) {
      throw new AppError(400, "문항·응답 방식·파일을 확인해 주세요.");
    }
    if (!identifiersRemovedConfirmed) {
      const message = modality === "photo" ? "이름·번호가 보이지 않는 답안 영역만 촬영했는지 확인해 주세요." : modality === "speech" ? "녹음에 이름·번호를 말하지 않았는지 확인해 주세요." : "화면에 이름·번호·알림 등 개인정보가 보이지 않는지 확인해 주세요.";
      throw new AppError(400, message);
    }
    const maxDuration = modality === "screen" ? 30 : 180;
    const durationSeconds = (modality === "speech" || modality === "screen") && Number.isInteger(durationValue) && durationValue > 0 && durationValue <= maxDuration ? durationValue : null;
    const validated = await validateEvidenceFile(file, modality);
    const blob = await storePrivateEvidence({ attemptId: attempt.id, questionId, modality, bytes: validated.bytes, mimeType: validated.mimeType });
    storedPathname = blob.pathname;
    await getEvidenceRepository().createAsset(attempt.id, {
      questionId, modality, blobPathname: blob.pathname,
      originalFilename: safeOriginalFilename(file.name || `${modality}-answer`),
      mimeType: validated.mimeType, byteSize: file.size, sha256: validated.sha256, identifiersRemovedConfirmed, durationSeconds,
    });
    return privateJson({ responses: await getEvidenceRepository().listAttemptResponses(attempt.id) }, 201);
  } catch (error) {
    if (storedPathname) await removePrivateEvidence(storedPathname).catch(() => null);
    return apiError(error);
  }
}
