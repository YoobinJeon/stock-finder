import { Router, Request, Response } from 'express';
import { getDb } from '../../config/database';
import { asyncHandler } from '../../utils/asyncHandler';
import { createTtlCache } from '../../utils/ttlCache';
import {
  aggregateSignalPerformance,
  RET_5D_TRADING_DAYS,
  RET_20D_TRADING_DAYS,
  type SignalReturnRow,
  type SignalTypePerformance,
} from '../../pipeline/signalPerformance';

const router = Router();

// 최근 이벤트 공시 피드 (점수에 반영된 공시만 — 대시보드 위젯용)
router.get('/disclosures', asyncHandler(async (_req: Request, res: Response) => {
  const { rows } = await getDb().query(
    `SELECT d.rcept_no, to_char(d.rcept_dt, 'YYYY-MM-DD') AS rcept_dt,
            d.ticker, s.name, s.market, s.sector,
            d.report_nm, d.event_type, d.score_delta, d.detail,
            ROUND(sc.total_score)::int AS total_score
     FROM disclosure_events d
     JOIN stocks s ON s.ticker = d.ticker
     LEFT JOIN stock_scores sc ON sc.ticker = d.ticker
     WHERE d.event_type IS NOT NULL
       AND d.rcept_dt >= (CURRENT_DATE - INTERVAL '7 days')
     ORDER BY d.rcept_dt DESC, d.rcept_no DESC
     LIMIT 30`,
  );
  res.json(rows.map((r) => ({
    ...r,
    url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${r.rcept_no}`,
  })));
}));

// 최신 기준일의 시그널 목록 (종목·점수 조인)
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const db = getDb();

  const { rows: dateRows } = await db.query(
    'SELECT to_char(MAX(signal_date), \'YYYY-MM-DD\') AS d FROM signals',
  );
  const date = dateRows[0]?.d ?? null;
  if (!date) {
    res.json({ date: null, signals: [] });
    return;
  }

  const { rows } = await db.query(
    `SELECT g.ticker, g.type, g.detail,
            s.name, s.market, s.sector, s.market_cap,
            ROUND(sc.total_score)::int AS total_score,
            i.last_close, i.day_change
     FROM signals g
     JOIN stocks s ON s.ticker = g.ticker AND s.is_active = TRUE
     LEFT JOIN stock_scores sc ON sc.ticker = g.ticker
     LEFT JOIN stock_indicators i ON i.ticker = g.ticker
     WHERE g.signal_date = $1
     ORDER BY sc.total_score DESC NULLS LAST, s.name`,
    [date],
  );

  res.json({ date, signals: rows });
}));

/**
 * 시그널 적중률: 시그널 발생일 종가 대비 고정 보유기간(5거래일·20거래일) 종가 수익률을
 * 타입별로 집계. 마크투마켓(발생일→현재가) 방식은 보유기간이 시그널마다 제각각이라
 * 하락장에서 왜곡된 수치가 나올 수 있어 폐기 — 레드팀 점검(2026-07-18)..
 * 거래일 오프셋은 LATERAL로 해당 종목의 발생일 이후 N번째 거래일 종가를 조인(캘린더일 아님).
 * 2분 TTL 캐시 — 시그널 ~2700행 × 가격 LATERAL 조인 비용을 반복 요청마다 물지 않기 위함.
 */
router.get('/performance', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await performanceCache.get());
}));

interface PerformanceResponse {
  sample: number;
  performance: SignalTypePerformance[];
}

const performanceCache = createTtlCache(2 * 60 * 1000, buildSignalPerformance);

async function buildSignalPerformance(): Promise<PerformanceResponse> {
  const db = getDb();
  const { rows } = await db.query(
    `SELECT g.type,
            p.close AS base_close,
            c5.close AS close_5d,
            c20.close AS close_20d
     FROM signals g
     JOIN stock_prices p ON p.ticker = g.ticker AND p.trade_date = g.signal_date
     LEFT JOIN LATERAL (
       SELECT sp.close FROM stock_prices sp
       WHERE sp.ticker = g.ticker AND sp.trade_date > g.signal_date
       ORDER BY sp.trade_date ASC
       OFFSET $1 LIMIT 1
     ) c5 ON TRUE
     LEFT JOIN LATERAL (
       SELECT sp.close FROM stock_prices sp
       WHERE sp.ticker = g.ticker AND sp.trade_date > g.signal_date
       ORDER BY sp.trade_date ASC
       OFFSET $2 LIMIT 1
     ) c20 ON TRUE
     WHERE p.close > 0`,
    [RET_5D_TRADING_DAYS - 1, RET_20D_TRADING_DAYS - 1],
  );

  const perfRows: SignalReturnRow[] = rows.map((r) => ({
    type: r.type,
    baseClose: Number(r.base_close),
    close5d: r.close_5d != null ? Number(r.close_5d) : null,
    close20d: r.close_20d != null ? Number(r.close_20d) : null,
  }));

  return { sample: perfRows.length, performance: aggregateSignalPerformance(perfRows) };
}

const SIGNAL_TYPES = [
  'golden_cross', 'high_52w', 'foreign_streak', 'dual_flow',
  'volume_surge_high', 'inst_new_accum', 'rs_top_entry',
] as const;

/**
 * 시그널 발생 내역: 특정 타입의 시그널이 언제·어떤 종목에서 발생했는지 + 발생일 종가 대비
 * 현재가 수익률/적중 여부. "적중률" 카드 클릭 시 편입 대상을 확인하기 위한 상세 조회.
 */
router.get('/:type/history', asyncHandler(async (req: Request, res: Response) => {
  const { type } = req.params;
  if (!SIGNAL_TYPES.includes(type as (typeof SIGNAL_TYPES)[number])) {
    res.status(400).json({ error: '알 수 없는 시그널 타입입니다.' });
    return;
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const { rows } = await getDb().query(
    `SELECT g.ticker, s.name, s.market,
            to_char(g.signal_date, 'YYYY-MM-DD') AS signal_date,
            p.close AS base_close,
            i.last_close,
            to_char(m.md, 'YYYY-MM-DD') AS latest_date,
            (m.md - g.signal_date) AS days
     FROM signals g
     JOIN stocks s ON s.ticker = g.ticker
     JOIN stock_prices p ON p.ticker = g.ticker AND p.trade_date = g.signal_date
     LEFT JOIN stock_indicators i ON i.ticker = g.ticker
     LEFT JOIN (SELECT ticker, MAX(trade_date) AS md FROM stock_prices GROUP BY ticker) m
       ON m.ticker = g.ticker
     WHERE g.type = $1 AND p.close > 0
     ORDER BY g.signal_date DESC, s.name
     LIMIT $2`,
    [type, limit],
  );

  const items = rows.map((r) => {
    const base = Number(r.base_close);
    const last = r.last_close != null ? Number(r.last_close) : null;
    const days = r.days != null ? Number(r.days) : null;
    const hasReturn = last != null && days != null && days > 0 && Number.isFinite(base) && base > 0;
    const ret = hasReturn ? Math.round(((last! - base) / base) * 1000) / 10 : null;
    return {
      ticker: r.ticker,
      name: r.name,
      market: r.market,
      signal_date: r.signal_date,
      base_close: r.base_close,
      last_close: r.last_close,
      latest_date: r.latest_date,
      days,
      ret,
      hit: ret != null ? ret > 0 : null,
    };
  });

  res.json({ type, count: items.length, items });
}));

export default router;
