import { getDb } from '../config/database';
import { fetchYahooChart } from './sources/yahooPrices';
import { fetchKisDailyPrices } from './sources/kisDailyPrice';

/**
 * 일봉 시세 수집 — KIS 정본, Yahoo 폴백.
 * (2026-07-26 ingest.ts 분할 — 800줄 규칙. 로직은 그대로 옮겼다.)
 */

/** 1년 일봉(약 245영업일)을 여유 있게 덮는 달력 일수 */
const PRICE_LOOKBACK_DAYS = 400;

/**
 * 1년 일봉을 멀티로우 INSERT로 저장 (MomentumEngine용 ~250 영업일).
 *
 * 원천은 KIS 수정주가가 정본이고 Yahoo는 폴백이다(2026-07-26 Phase 2 전환). Yahoo를 뒤로 민
 * 이유는 실측 결측이다 — 6개 종목 전부에서 2025-09-19 거래일이 통째로 빠져 있었고 KIS에는 있었다.
 * KIS가 null(키 미설정·토큰 실패·조회 오류)을 줄 때만 Yahoo로 내려간다. 빈 배열은
 * "정상 응답이나 데이터 없음"(신규 상장 등)이므로 폴백하지 않는다.
 */
export async function ingestPrices(ticker: string, market: string): Promise<void> {
  const kisRows = await fetchKisDailyPrices(ticker, { days: PRICE_LOOKBACK_DAYS });
  const rows = kisRows ?? (await fetchYahooChart(ticker, market, '1y', '1d'));
  if (rows.length === 0) return;

  const db = getDb();
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      const b = j * 7;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`);
      params.push(ticker, r.trade_date, r.open, r.high, r.low, r.close, r.volume);
    });
    await db.query(
      `INSERT INTO stock_prices (ticker, trade_date, open, high, low, close, volume)
       VALUES ${values.join(', ')}
       ON CONFLICT (ticker, trade_date) DO UPDATE
         SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
             close = EXCLUDED.close, volume = EXCLUDED.volume`,
      params,
    );
  }
}
