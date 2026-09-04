import { cookies } from "next/headers";
import { getEvidenceRepository, getRepository } from "../../../../../../../db/connection";
import { AppError } from "../../../../../../../lib/assessment-domain";
import { streamPrivateEvidence } from "../../../../../../../lib/evidence-storage";
import { apiError, validateCode, validateId } from "../../../../../../../lib/http";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ code: string; assetId: string }> }) {
  try {
    const { code: rawCode, assetId: rawAssetId } = await params;
    const code = validateCode(rawCode);
    const token = (await cookies()).get(`mumu_attempt_${code}`)?.value;
    if (!token) throw new AppError(401, "학생 참여 정보가 필요합니다.");
    const attempt = await getRepository().getAttempt(code, token);
    const asset = await getEvidenceRepository().getAssetForStudent(validateId(rawAssetId), attempt.id);
    const blob = await streamPrivateEvidence(asset.blobPathname);
    return new Response(blob.stream, { headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "ETag": blob.etag,
    } });
  } catch (error) { return apiError(error); }
}
