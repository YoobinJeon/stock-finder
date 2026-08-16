import { getDb } from '../config/database';
import { logger } from '../utils/logger';
import { fetchEtfList } from './sources/naverEtf';

/** 현재 KST 날짜 (YYYY-MM-DD) — scheduler.ts kstNow류와 동일 계산 방식 */
function kstToday(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * ETF 전종목(전 탭) 실시간 시세를 오늘 날짜로 스냅샷 적재.
 * ON CONFLICT (ticker, snap_date) DO UPDATE — 재실행해도 안전 (멱등).
 * 주말에도 함수 자체는 그대로 동작 (스킵 여부는 호출부/크론이 결정).
 * 행별 insert 실패는 건너뛰고 개수만 집계해 warn 1줄로 남긴다.
 * @returns 적재(삽입/갱신)된 행 수
 */
export async function snapshotEtfDaily(): Promise<number> {
  const db = getDb();
  const snapDate = kstToday();
  const items = await fetchEtfList();

  let saved = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await db.query(
        `INSERT INTO etf_daily_snapshots
           (ticker, snap_date, name, tab, close, change_pct, nav, deviation_pct,
            three_month_return, volume, amount, market_cap)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (ticker, snap_date) DO UPDATE SET
           name = EXCLUDED.name,
           tab = EXCLUDED.tab,
           close = EXCLUDED.close,
           change_pct = EXCLUDED.change_pct,
           nav = EXCLUDED.nav,
           deviation_pct = EXCLUDED.deviation_pct,
           three_month_return = EXCLUDED.three_month_return,
           volume = EXCLUDED.volume,
           amount = EXCLUDED.amount,
           market_cap = EXCLUDED.market_cap`,
        [
          item.ticker,
          snapDate,
          item.name,
          item.tab,
          item.price,
          item.changePct,
          item.nav,
          item.deviationPct,
          item.threeMonthReturn,
          item.volume,
          item.amount,
          item.marketCap,
        ],
      );
      saved += 1;
    } catch {
      failed += 1;
    }
  }

  if (failed > 0) {
    logger.warn(`ETF 스냅샷 저장 중 ${failed}건 실패 (전체 ${items.length}건)`);
  }
  logger.info(`ETF 스냅샷 저장 완료: ${saved}/${items.length}건 (${snapDate})`);
  return saved;
}
