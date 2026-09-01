import { cookies } from "next/headers";
import { getRepository } from "../../../../db/connection";
import { apiError, privateJson, validateCode } from "../../../../lib/http";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const code = validateCode((await params).code);
    const repo = getRepository();
    const assessment = await repo.getByCode(code);
    const token = (await cookies()).get(`mumu_attempt_${code}`)?.value;
    const [attempt, result] = token ? await Promise.all([repo.getAttempt(code, token), repo.studentResult(code, token)]) : [null, null];
    // Whitelist public fields: no owner, participant list, token hashes or unpublished reviews.
    return privateJson({ assessment: { id: assessment.id, shareCode: code, status: assessment.status, definition: assessment.definition, rosterRequired: Boolean(assessment.curriculumLink) }, attempt, result });
  } catch (error) { return apiError(error); }
}
