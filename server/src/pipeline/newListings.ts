import type { Db } from '../config/database';
import { fetchNewListings } from './sources/naverNewListings';
import { logger } from '../utils/logger';

/**
 * 네이버 신규상장 목록 → stocks.listed_at 동기화.
 * 변경분(NULL이거나 값이 다른 경우)만 UPDATE — 매 호출 전체 재수집이라도 대부분 no-op.
 */
export async function syncNewListings(db: Db): Promise<{ updated: number }> {
  const rows = await fetchNewListings();

  let updated = 0;
  for (const r of rows) {
    const { rows: changed } = await db.query(
      `UPDATE stocks SET listed_at = $1
       WHERE ticker = $2 AND (listed_at IS NULL OR listed_at <> $1)
       RETURNING ticker`,
      [r.listedAt, r.ticker],
    );
    if (changed.length > 0) updated++;
  }

  if (updated > 0) logger.info(`신규상장 상장일 동기화: ${updated}건 갱신 (조회 ${rows.length}건)`);
  return { updated };
}
