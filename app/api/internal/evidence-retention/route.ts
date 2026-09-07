import { getEvidenceRetentionRepository } from "../../../../db/connection";
import { authorizeRetention, cleanupExpiredEvidence } from "../../../../lib/evidence-retention";
import { removePrivateEvidence } from "../../../../lib/evidence-storage";
import { apiError, privateJson } from "../../../../lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST only: portable to any authenticated scheduler, not an ordinary browser GET.
// Deployment alone does not activate deletion; explicit operational opt-in is required.
export async function POST(request: Request) {
  try {
    authorizeRetention(request, process.env.EVIDENCE_RETENTION_SECRET, process.env.EVIDENCE_RETENTION_DELETE_ENABLED === "true");
    const result = await cleanupExpiredEvidence(getEvidenceRetentionRepository(), removePrivateEvidence, { execute: true });
    return privateJson(result, result.failed ? 503 : 200);
  } catch (error) { return apiError(error); }
}
