import { AppError } from "../lib/assessment-domain";
import type { Query } from "./repository";

export function createEvidenceRetentionRepository(query: Query) {
  return {
    async listExpired(limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError(400, "정리 개수는 1~100개여야 합니다.");
      return query<{ id: string; pathname: string }>(`SELECT a.id, a.blob_pathname AS pathname
        FROM evidence_assets a WHERE a.retention_until <= now()
          AND NOT EXISTS (SELECT 1 FROM evidence_asset_deletions d WHERE d.asset_id = a.id)
        ORDER BY a.retention_until, a.id LIMIT $1`, [limit]);
    },
    async recordDeleted(assetId: string) {
      // Only mark an already-expired original after the storage adapter confirms removal.
      const rows = await query(`INSERT INTO evidence_asset_deletions (asset_id, reason)
        SELECT id, 'retention_expired' FROM evidence_assets WHERE id = $1 AND retention_until <= now()
        ON CONFLICT (asset_id) DO NOTHING RETURNING asset_id`, [assetId]);
      if (!rows.length) {
        const existing = await query(`SELECT asset_id FROM evidence_asset_deletions WHERE asset_id = $1`, [assetId]);
        if (!existing.length) throw new AppError(409, "만료되지 않은 원본은 삭제 처리할 수 없습니다.");
      }
    },
  };
}
