import { getDb } from '../config/database';
import { compositeScorer } from '../scoring/CompositeScorer';
import { logger } from '../utils/logger';

/**
 * 지정 종목 재채점 — 공시 이벤트 반영 등 전체 재계산 없이 경량으로 돌릴 때 쓴다.
 * (2026-07-26 ingest.ts 분할 — 800줄 규칙. 로직은 그대로 옮겼다.)
 */

/** 지정 종목만 재채점 (공시 이벤트 반영 — 전체 재계산 없이 경량) */
export async function rescoreTickers(tickers: string[]): Promise<void> {
  if (tickers.length === 0) return;
  const db = getDb();
  const { rows: stocks } = await db.query(
    `SELECT ticker, name, market, sector, market_cap FROM stocks WHERE ticker = ANY($1)`,
    [tickers],
  );
  for (const stock of stocks) {
    const result = await compositeScorer.score(stock, {});
    await db.query(
      `INSERT INTO stock_scores (ticker, total_score, breakdown, scored_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (ticker) DO UPDATE
         SET total_score = EXCLUDED.total_score, breakdown = EXCLUDED.breakdown, scored_at = NOW()`,
      [stock.ticker, result.total, JSON.stringify(result.breakdown)],
    );
  }
  logger.info(`공시 반영 재채점: ${stocks.length}개 종목`);
}
