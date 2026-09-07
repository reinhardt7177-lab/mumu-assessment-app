import { timingSafeEqual } from "node:crypto";
import { AppError } from "./assessment-domain";

export function authorizeRetention(request: Request, secret: string | undefined, enabled: boolean) {
  if (!secret || secret.length < 32) throw new AppError(503, "원본 정리 인증 설정이 필요합니다.");
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AppError(401, "원본 정리 권한이 없습니다.");
  if (!enabled) throw new AppError(409, "원본 자동 삭제가 아직 활성화되지 않았습니다.");
}

type RetentionRepository = {
  listExpired(limit: number): Promise<Array<{ id: string; pathname: string }>>;
  recordDeleted(assetId: string): Promise<void>;
};

export async function cleanupExpiredEvidence(repository: RetentionRepository, remove: (pathname: string) => Promise<void>, options: { execute: boolean; limit?: number; maxDurationMs?: number }) {
  const candidates = await repository.listExpired(options.limit ?? 20);
  const result = { examined: candidates.length, deleted: 0, failed: 0, deferred: 0, dryRun: !options.execute };
  if (!options.execute) return result;
  const deadline = Date.now() + (options.maxDurationMs ?? 40_000);
  for (let index = 0; index < candidates.length; index++) {
    if (Date.now() >= deadline) { result.deferred = candidates.length - index; break; }
    const item = candidates[index];
    try {
      // Scope deletion to this app's private originals, never URLs or arbitrary Blob paths.
      if (!item.pathname.startsWith("student-evidence/") || item.pathname.includes("..") || item.pathname.includes("\\")) throw new Error("Unexpected evidence path");
      await remove(item.pathname);
      await repository.recordDeleted(item.id);
      result.deleted++;
    } catch {
      // Do not log filenames/student content/credentials. No tombstone means the next run retries.
      result.failed++;
    }
  }
  return result;
}
