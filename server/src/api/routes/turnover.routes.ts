import { Router, Request, Response } from 'express';
import { getDb } from '../../config/database';
import { asyncHandler } from '../../utils/asyncHandler';
import { bucketTradeDates, formatWeekLabel, weeklyChange } from '../../pipeline/turnover';

const router = Router();

// 최근 며칠치를 긁어와야 8개 완성 블록(40거래일)+진행 중 블록을 안정적으로 채우는지 —
// 휴장일 등으로 거래일이 듬성듬성해도 여유 있게 45일로 잡는다.
const LOOKBACK_TRADE_DAYS = 45;

interface DailyAmtRow {
  trade_date: string;
  key: string; // market 이름 또는 sector 이름 또는 ticker
  amt: string | number; // Postgres numeric SUM은 문자열로 올 수 있음
}

/**
 * 일별(trade_date × key) 합계 행들을 주간 블록으로 접어 key별 시계열을 만든다.
 * chronBlocks는 오래된→최신 순 블록 배열(각 블록은 날짜 문자열 배열).
 */
function buildWeeklySeriesByKey(
  rows: DailyAmtRow[],
  chronBlocks: string[][],
): Map<string, number[]> {
  const dateToIdx = new Map<string, number>();
  chronBlocks.forEach((block, idx) => block.forEach((d) => dateToIdx.set(d, idx)));

  const byKey = new Map<string, number[]>();
  for (const row of rows) {
    const idx = dateToIdx.get(row.trade_date);
    if (idx == null) continue; // 8블록 창 밖(잘려나간 오래된 날짜) — 무시
    const series = byKey.get(row.key) ?? new Array(chronBlocks.length).fill(0);
    series[idx] += Number(row.amt);
    byKey.set(row.key, series);
  }
  return byKey;
}

function changePctFor(series: number[], latestPartial: boolean): number | null {
  const complete = latestPartial ? series.slice(0, -1) : series;
  return weeklyChange(complete);
}

// 5분 캐시 — 종목·섹터별 45일 집계라 매 요청 재계산은 과하다 (다른 라우트와 동일 패턴).
let turnoverCache: { data: unknown; at: number } | null = null;
const TURNOVER_TTL = 5 * 60 * 1000;

router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  if (turnoverCache && Date.now() - turnoverCache.at < TURNOVER_TTL) {
    res.json(turnoverCache.data);
    return;
  }

  const db = getDb();

  const { rows: dateRows } = await db.query(
    `SELECT to_char(trade_date, 'YYYY-MM-DD') AS trade_date
     FROM (SELECT DISTINCT trade_date FROM stock_prices ORDER BY trade_date DESC LIMIT $1) t
     ORDER BY trade_date`,
    [LOOKBACK_TRADE_DAYS],
  );
  const allDates: string[] = dateRows.map((r: { trade_date: string }) => r.trade_date);

  const newestFirstBlocks = bucketTradeDates(allDates); // 최신 블록이 0번째
  const chronBlocks = [...newestFirstBlocks].reverse();  // 오래된→최신
  const latestPartial = newestFirstBlocks.length > 0 && newestFirstBlocks[0].length < 5;
  const weeks = chronBlocks.map(formatWeekLabel);

  if (chronBlocks.length === 0) {
    const data = { weeks: [], latestPartial: false, market: [], sectors: [], stocks: [] };
    turnoverCache = { data, at: Date.now() };
    res.json(data);
    return;
  }

  const cutoff = chronBlocks[0][0]; // 유지 중인 블록 창의 가장 오래된 날짜

  const [{ rows: marketRows }, { rows: sectorRows }, { rows: tickerRows }] = await Promise.all([
    db.query(
      `SELECT to_char(p.trade_date, 'YYYY-MM-DD') AS trade_date, s.market AS key,
              SUM(p.close * p.volume)::numeric AS amt
       FROM stock_prices p
       JOIN stocks s ON s.ticker = p.ticker AND s.is_active = TRUE
       WHERE p.trade_date >= $1 AND p.close IS NOT NULL AND p.volume IS NOT NULL
       GROUP BY p.trade_date, s.market`,
      [cutoff],
    ),
    db.query(
      `SELECT to_char(p.trade_date, 'YYYY-MM-DD') AS trade_date, s.sector AS key,
              SUM(p.close * p.volume)::numeric AS amt
       FROM stock_prices p
       JOIN stocks s ON s.ticker = p.ticker AND s.is_active = TRUE
       WHERE p.trade_date >= $1 AND s.sector IS NOT NULL
         AND p.close IS NOT NULL AND p.volume IS NOT NULL
       GROUP BY p.trade_date, s.sector`,
      [cutoff],
    ),
    db.query(
      `SELECT s.ticker, s.name, s.market, s.sector, ROUND(sc.total_score)::int AS total_score
       FROM stocks s
       LEFT JOIN stock_scores sc ON sc.ticker = s.ticker
       WHERE s.ticker IN (SELECT ticker FROM watchlist)`,
    ),
  ]);

  const marketSeries = buildWeeklySeriesByKey(marketRows as DailyAmtRow[], chronBlocks);
  const sectorSeries = buildWeeklySeriesByKey(sectorRows as DailyAmtRow[], chronBlocks);

  const market = [...marketSeries.entries()]
    .map(([key, series]) => ({ market: key, series, changePct: changePctFor(series, latestPartial) }))
    .sort((a, b) => a.market.localeCompare(b.market));

  const sectors = [...sectorSeries.entries()]
    .map(([key, series]) => ({ sector: key, series, changePct: changePctFor(series, latestPartial) }))
    .sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));

  const trackedTickers: Array<{
    ticker: string; name: string; market: string; sector: string | null; total_score: number | null;
  }> = tickerRows;
  let stocks: Array<{
    ticker: string; name: string; market: string; sector: string | null; totalScore: number | null;
    series: number[]; changePct: number | null;
  }> = [];

  if (trackedTickers.length > 0) {
    const { rows: stockAmtRows } = await db.query(
      `SELECT to_char(p.trade_date, 'YYYY-MM-DD') AS trade_date, p.ticker AS key,
              SUM(p.close * p.volume)::numeric AS amt
       FROM stock_prices p
       WHERE p.trade_date >= $1 AND p.ticker = ANY($2)
         AND p.close IS NOT NULL AND p.volume IS NOT NULL
       GROUP BY p.trade_date, p.ticker`,
      [cutoff, trackedTickers.map((t) => t.ticker)],
    );

    const stockSeries = buildWeeklySeriesByKey(stockAmtRows as DailyAmtRow[], chronBlocks);

    stocks = trackedTickers
      .map((t) => {
        const series = stockSeries.get(t.ticker) ?? new Array(chronBlocks.length).fill(0);
        return {
          ticker: t.ticker,
          name: t.name,
          market: t.market,
          sector: t.sector,
          totalScore: t.total_score,
          series,
          changePct: changePctFor(series, latestPartial),
        };
      })
      .sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
  }

  const data = { weeks, latestPartial, market, sectors, stocks };
  turnoverCache = { data, at: Date.now() };
  res.json(data);
}));

export default router;
