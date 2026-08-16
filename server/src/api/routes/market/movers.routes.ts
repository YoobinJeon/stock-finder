import { Router, Request, Response } from 'express';
import { getDb } from '../../../config/database';
import { fetchMovers } from '../../../pipeline/sources/naverMovers';
import { calcLimitUpStreak, type PriceRow } from '../../../pipeline/limitUpStreak';
import { asyncHandler } from '../../../utils/asyncHandler';
import { kstMarket, fetchStockQuotes } from './shared';

const router = Router();

// ── 오늘의 특징주 (거래대금 상위·급등·52주 신고가) — 대시보드 위젯용 ──

interface MoverOut {
  ticker: string;
  name: string;
  price: number;
  changePct: number;
  amount: number;        // 거래대금 (백만원)
  sector: string | null;
  totalScore: number | null; // 우리 종합점수 (수집 범위 밖 종목·ETF는 null)
}

interface LimitupOut {
  ticker: string;
  name: string;
  price: number;         // 최신 거래일 종가
  changePct: number;     // 최신 거래일 등락률(%)
  streak: number;        // 연속 상한가 일수
  amount: null;          // 거래대금 미집계 — 다른 보드와 필드 통일용
  sector: string | null;
  totalScore: number | null;
}

// 상한가 연속일 보드 — EOD(stock_prices) 데이터라 매 호출 재계산 불필요. 10분 캐시.
let limitupCache: { items: LimitupOut[]; asOf: string | null; at: number } | null = null;
const LIMITUP_TTL = 10 * 60 * 1000;

/**
 * stock_prices 최근 45일치(티커당 최근 12영업일)로 상한가 연속일 랭킹을 계산.
 * fail-soft: 실패 시 빈 배열 반환 — 다른 보드(amount/surge/high52w) 동작에 영향 없음.
 */
async function computeLimitupBoard(db: ReturnType<typeof getDb>): Promise<{ items: LimitupOut[]; asOf: string | null }> {
  if (limitupCache && Date.now() - limitupCache.at < LIMITUP_TTL) {
    return { items: limitupCache.items, asOf: limitupCache.asOf };
  }

  try {
    const { rows } = await db.query(
      `WITH recent AS (
         SELECT ticker, trade_date, close,
                LAG(close) OVER (PARTITION BY ticker ORDER BY trade_date) AS prev_close,
                ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY trade_date DESC) AS rn
         FROM stock_prices
         WHERE trade_date >= NOW() - INTERVAL '45 days'
       )
       SELECT ticker, to_char(trade_date, 'YYYY-MM-DD') AS trade_date, close, prev_close
       FROM recent WHERE rn <= 12`,
    );

    const byTicker = new Map<string, PriceRow[]>();
    let globalLatestDate: string | null = null;
    for (const r of rows as Array<{ ticker: string; trade_date: string; close: unknown; prev_close: unknown }>) {
      const list = byTicker.get(r.ticker) ?? [];
      list.push({ trade_date: r.trade_date, close: r.close as number | string | null, prev_close: r.prev_close as number | string | null });
      byTicker.set(r.ticker, list);
      if (globalLatestDate == null || r.trade_date > globalLatestDate) globalLatestDate = r.trade_date;
    }

    const candidates: Array<{ ticker: string; streak: number; lastChangePct: number; lastClose: number }> = [];
    for (const [ticker, list] of byTicker) {
      // 티커의 최신 거래일이 전체 최신 거래일과 다르면 거래정지 등 낡은 데이터 — 배제
      const tickerLatestDate = list.reduce((max, r) => (r.trade_date > max ? r.trade_date : max), list[0].trade_date);
      if (tickerLatestDate !== globalLatestDate) continue;

      const { streak, lastChangePct, lastClose } = calcLimitUpStreak(list);
      if (streak >= 1 && lastChangePct != null && lastClose != null) {
        candidates.push({ ticker, streak, lastChangePct, lastClose });
      }
    }

    if (candidates.length === 0) {
      limitupCache = { items: [], asOf: globalLatestDate, at: Date.now() };
      return { items: [], asOf: globalLatestDate };
    }

    const { rows: infoRows } = await db.query(
      `SELECT s.ticker, s.name, s.sector, ROUND(sc.total_score)::int AS total_score
       FROM stocks s LEFT JOIN stock_scores sc ON sc.ticker = s.ticker
       WHERE s.ticker = ANY($1) AND s.is_active = TRUE`,
      [candidates.map((c) => c.ticker)],
    );
    const infoMap = new Map(infoRows.map((r: any) => [r.ticker, r]));

    const items: LimitupOut[] = candidates
      .filter((c) => infoMap.has(c.ticker))
      .sort((a, b) => b.streak - a.streak || b.lastChangePct - a.lastChangePct)
      .slice(0, 20)
      .map((c) => {
        const info = infoMap.get(c.ticker)!;
        return {
          ticker: c.ticker,
          name: info.name,
          price: c.lastClose,
          changePct: c.lastChangePct,
          streak: c.streak,
          amount: null,
          sector: info.sector ?? null,
          totalScore: info.total_score,
        };
      });

    limitupCache = { items, asOf: globalLatestDate, at: Date.now() };
    return { items, asOf: globalLatestDate };
  } catch {
    return { items: [], asOf: null }; // fail-soft — 다른 보드에 영향 없음
  }
}

router.get('/movers', asyncHandler(async (_req: Request, res: Response) => {
  const db = getDb();
  const { open, hhmm } = kstMarket();

  const [quantRows, riseRows, limitupResult] = await Promise.all([
    fetchMovers('quant'),
    fetchMovers('rise'),
    computeLimitupBoard(db),
  ]);
  const amountTop = [...quantRows].sort((a, b) => b.amount - a.amount).slice(0, 20);
  // 급등은 거래대금 1억(100백만) 미만 잡음 제외
  const surgeTop = riseRows
    .filter((r) => r.amount >= 100)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, 20);

  // 우리 점수 배지 조인 — DB에 없는 종목(ETF·수집범위 밖)은 null 유지
  const tickers = [...new Set([...amountTop, ...surgeTop].map((r) => r.ticker))];
  const scoreMap = new Map<string, { sector: string | null; total_score: number | null }>();
  if (tickers.length > 0) {
    const { rows } = await db.query(
      `SELECT s.ticker, s.sector, ROUND(sc.total_score)::int AS total_score
       FROM stocks s LEFT JOIN stock_scores sc ON sc.ticker = s.ticker
       WHERE s.ticker = ANY($1)`,
      [tickers],
    );
    rows.forEach((r: any) => scoreMap.set(r.ticker, r));
  }
  const attach = (r: { ticker: string; name: string; price: number; changePct: number; amount: number }): MoverOut => ({
    ticker: r.ticker,
    name: r.name,
    price: r.price,
    changePct: r.changePct,
    amount: r.amount,
    sector: scoreMap.get(r.ticker)?.sector ?? null,
    totalScore: scoreMap.get(r.ticker)?.total_score ?? null,
  });

  // 52주 신고가 — EOD 후보(신고가 3% 이내)를 뽑고 장중엔 실시간가로 돌파 확정
  const { rows: candidates } = await db.query(
    `SELECT s.ticker, s.name, s.sector,
            ROUND(sc.total_score)::int AS total_score,
            i.last_close, i.day_change, i.pct_from_52w_high
     FROM stock_indicators i
     JOIN stocks s ON s.ticker = i.ticker AND s.is_active = TRUE
     LEFT JOIN stock_scores sc ON sc.ticker = i.ticker
     WHERE i.pct_from_52w_high >= -3 AND i.last_close > 0
     ORDER BY i.pct_from_52w_high DESC
     LIMIT 100`,
  );

  const toHigh = (c: any, price: number, changePct: number) => {
    const high = Number(c.last_close) / (1 + Number(c.pct_from_52w_high) / 100);
    return {
      ticker: c.ticker,
      name: c.name,
      price,
      changePct,
      amount: null,
      sector: c.sector ?? null,
      totalScore: c.total_score,
      high52w: Math.round(high),
      isNewHigh: price >= high,
    };
  };

  let high52w;
  if (open) {
    const quotes = await fetchStockQuotes(candidates.map((c: any) => c.ticker));
    high52w = candidates
      .map((c: any) => {
        const q = quotes.get(c.ticker);
        return toHigh(c, q?.price ?? Number(c.last_close), q?.changePct ?? Number(c.day_change ?? 0));
      })
      .filter((h) => h.isNewHigh);
  } else {
    // 마감 후: 종가가 52주 최고가 부근(-0.5% 이내)이면 당일 신고가로 간주
    high52w = candidates
      .filter((c: any) => Number(c.pct_from_52w_high) >= -0.5)
      .map((c: any) => toHigh(c, Number(c.last_close), Number(c.day_change ?? 0)));
  }
  high52w = high52w.sort((a, b) => b.changePct - a.changePct).slice(0, 20);

  res.json({
    intraday: open,
    asOf: hhmm,
    amount: amountTop.map(attach),
    surge: surgeTop.map(attach),
    high52w,
    limitup: limitupResult.items,
    limitupAsOf: limitupResult.asOf,
  });
}));

// ── 신규상장 (stocks.listed_at 기준 최근 90일) ──

interface NewListingOut {
  ticker: string;
  name: string;
  listedAt: string;   // YYYY-MM-DD
  daysListed: number; // 상장 후 경과일
  price: number | null;
  changePct: number | null;
  sector: string | null;
  totalScore: number | null;
}

router.get('/new-listings', asyncHandler(async (_req: Request, res: Response) => {
  const db = getDb();
  const { rows } = await db.query(
    `SELECT s.ticker, s.name, to_char(s.listed_at, 'YYYY-MM-DD') AS listed_at,
            (CURRENT_DATE - s.listed_at)::int AS days_listed,
            s.sector, ROUND(sc.total_score)::int AS total_score,
            i.last_close, i.day_change
     FROM stocks s
     LEFT JOIN stock_scores sc ON sc.ticker = s.ticker
     LEFT JOIN stock_indicators i ON i.ticker = s.ticker
     WHERE s.is_active = TRUE AND s.listed_at IS NOT NULL
       AND s.listed_at >= CURRENT_DATE - INTERVAL '90 days'
     ORDER BY s.listed_at DESC
     LIMIT 20`,
  );

  const items: NewListingOut[] = rows.map((r: any) => ({
    ticker: r.ticker,
    name: r.name,
    listedAt: r.listed_at,
    daysListed: r.days_listed,
    price: r.last_close != null ? Number(r.last_close) : null,
    changePct: r.day_change != null ? Number(r.day_change) : null,
    sector: r.sector ?? null,
    totalScore: r.total_score,
  }));

  res.json({ items });
}));

export default router;
