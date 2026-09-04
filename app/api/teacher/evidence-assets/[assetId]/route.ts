import { getEvidenceRepository } from "../../../../../db/connection";
import { streamPrivateEvidence } from "../../../../../lib/evidence-storage";
import { apiError, validateId } from "../../../../../lib/http";
import { requireTeacher } from "../../../../../lib/teacher-auth";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const teacherId = await requireTeacher();
    const asset = await getEvidenceRepository().getAssetForTeacher(validateId((await params).assetId), teacherId);
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
