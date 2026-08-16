import { Router, Request, Response } from 'express';
import { getDb } from '../../../config/database';
import { asyncHandler } from '../../../utils/asyncHandler';
import { createTtlCache } from '../../../utils/ttlCache';
import {
  rankStocks,
  aggregateSectorRs,
  calcPeriodReturns,
  isRankable,
  type StockRsRow,
  RS_OFFSET_TODAY as RN_TODAY,
  RS_OFFSET_1M as RN_1M,
  RS_OFFSET_3M as RN_3M,
  RS_OFFSET_6M as RN_6M,
  RS_OFFSET_12M as RN_12M,
} from '../../../pipeline/rsRanking';

const router = Router();

interface PivotRow {
  ticker: string;
  name: string;
  sector: string | null;
  market_cap: string | number | null;
  market: string;
  c0: string | number | null;
  c1m: string | number | null;
  c3m: string | number | null;
  c6m: string | number | null;
  c12m: string | number | null;
  has_break: string | number;
}

const toNum = (v: string | number | null): number | null => (v == null ? null : Number(v));

// 10분 캐시 + single-flight — RS는 stock_prices 일봉 마감 기준이라 장중에도 하루 한 번만 바뀌고,
// 만료 시 동시 요청이 무거운 전체 피벗을 각자 돌리지 않게 in-flight 하나를 공유(ttlCache).
const rsCache = createTtlCache(10 * 60 * 1000, buildRsData);

router.get('/rs', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await rsCache.get());
}));

/** RS 랭킹 데이터 계산 (전체 stock_prices 피벗 → 백분위 → 섹터 집계). 무거운 작업 — single-flight로 보호. */
async function buildRsData(): Promise<unknown> {
  const db = getDb();

  const [{ rows: pivotRows }, { rows: asOfRows }] = await Promise.all([
    db.query(
      // has_break: 12M 창 안에 연속 거래일 종가 비율이 [0.6, 1.4] 밖인 날이 있으면 1 —
      // 감자·거래정지 재개 등 가격 불연속 판정 (KRX 제한폭 ±30% 근거, priceRepair와 동일 기준).
      // 진짜 연속 급등주(예: 브이엠 12M +872%)는 일별 브레이크가 없으므로 걸리지 않는다.
      `WITH ranked AS (
         SELECT p.ticker, p.trade_date, p.close,
                LAG(p.close) OVER (PARTITION BY p.ticker ORDER BY p.trade_date) AS prev_close,
                ROW_NUMBER() OVER (PARTITION BY p.ticker ORDER BY p.trade_date DESC) AS rn
         FROM stock_prices p
         JOIN stocks s ON s.ticker = p.ticker AND s.is_active = TRUE
         WHERE p.close IS NOT NULL
       ),
       pivoted AS (
         SELECT ticker,
                MAX(CASE WHEN rn = $1 THEN close END) AS c0,
                MAX(CASE WHEN rn = $2 THEN close END) AS c1m,
                MAX(CASE WHEN rn = $3 THEN close END) AS c3m,
                MAX(CASE WHEN rn = $4 THEN close END) AS c6m,
                MAX(CASE WHEN rn = $5 THEN close END) AS c12m,
                MAX(CASE WHEN prev_close > 0
                          AND (close / prev_close > 1.4 OR close / prev_close < 0.6)
                     THEN 1 ELSE 0 END) AS has_break
         FROM ranked
         WHERE rn <= $5
         GROUP BY ticker
       )
       SELECT piv.ticker, s.name, s.sector, s.market_cap, s.market,
              piv.c0, piv.c1m, piv.c3m, piv.c6m, piv.c12m, piv.has_break
       FROM pivoted piv
       JOIN stocks s ON s.ticker = piv.ticker AND s.is_active = TRUE
       WHERE piv.c0 IS NOT NULL`,
      [RN_TODAY, RN_1M, RN_3M, RN_6M, RN_12M],
    ),
    db.query(`SELECT to_char(MAX(trade_date), 'YYYY-MM-DD') AS as_of FROM stock_prices`),
  ]);

  const asOf: string | null = asOfRows[0]?.as_of ?? null;

  // 거래정지(가격 동결)·가격 불연속(감자 등, priceRepair가 원천 한계로 못 고친) 종목은
  // 랭킹 풀에 들어가기 전에 배제한다 (배제 후 순위를 매겨야 정상 종목의 백분위가 오염되지 않는다).
  const evaluated = (pivotRows as PivotRow[]).map((r) => {
    const ret = calcPeriodReturns({
      c0: toNum(r.c0),
      c1m: toNum(r.c1m),
      c3m: toNum(r.c3m),
      c6m: toNum(r.c6m),
      c12m: toNum(r.c12m),
    });
    const frozen = isRankable(ret);
    const reason = !frozen.ok ? frozen.reason : Number(r.has_break) === 1 ? 'series_break' : null;
    return { row: r, ret, reason };
  });

  const frozenCount = evaluated.filter((e) => e.reason === 'frozen').length;
  const seriesBreakCount = evaluated.filter((e) => e.reason === 'series_break').length;
  // 검색 시 "왜 안 나오는지" 안내용 최소 목록 (ticker·name·reason만 — 페이로드 최소화)
  const excludedStocks = evaluated
    .filter((e) => e.reason != null)
    .map((e) => ({ ticker: e.row.ticker, name: e.row.name, reason: e.reason }));

  const stockRows: StockRsRow[] = evaluated
    .filter((e) => e.reason == null)
    .map(({ row: r, ret }) => ({
      ticker: r.ticker,
      name: r.name,
      sector: r.sector,
      marketCap: toNum(r.market_cap),
      market: r.market,
      ret,
    }));

  const stocks = rankStocks(stockRows);
  const sectors = aggregateSectorRs(
    stocks.map((s) => ({ ticker: s.ticker, name: s.name, sector: s.sector, integratedRs: s.rs.integrated })),
  );

  return {
    asOf,
    count: stocks.length,
    excluded: { frozen: frozenCount, seriesBreak: seriesBreakCount },
    excludedStocks,
    sectors,
    stocks,
  };
}

export default router;
