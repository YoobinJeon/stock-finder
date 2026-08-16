import { Router, Request, Response, NextFunction } from 'express';
import { getDb } from '../../config/database';
import { fetchCompanyProfile } from '../../pipeline/sources/naverCompanyProfile';
import { fetchStockNews } from '../../pipeline/sources/naverStockNews';
import { fetchYahooChart } from '../../pipeline/sources/yahooPrices';
import { fetchKisDailyPrices } from '../../pipeline/sources/kisDailyPrice';
import { fetchKisCreditTrend } from '../../pipeline/sources/kisCredit';
import { type CreditTrendPoint } from '../../pipeline/sources/creditTrend';
import { loadValuationBands, type ValuationBandsResult } from '../../pipeline/valuationBandsQuery';
import { asyncHandler } from '../../utils/asyncHandler';
import { logger } from '../../utils/logger';
import { parseTickersParam } from '../../utils/parseTickersParam';
import { createKeyedTtlCache } from '../../utils/ttlCache';
import { fetchTodayBar, kstMarket, type TodayBar } from './market/shared';
import { mergeTodayBar } from '../../pipeline/mergeTodayBar';

// 분기별 실적·컨센서스(quarterlyEstimates) 응답 개수 제한 — 최근 확정 분기 + 추정 분기를
// 각각 이 개수까지만 노출(과거로 무한정 늘어나지 않도록). 분기별 실적·컨센서스.
const QUARTERLY_CONFIRMED_LIMIT = 4;
const QUARTERLY_ESTIMATE_LIMIT = 4;

// /compare(아래)와 동일한 시총·재무·가이던스·지표 LATERAL 조인 패턴 — 단일 티커 상세 조회용.
// (/compare 자체는 그대로 두고, 여기서는 같은 조인 구조를 단일 티커 WHERE 절로 재사용)
// est_fiscal_year/forward_per/est_revenue/est_operating_income 별칭은 compare·screener가
// 그대로 참조하므로 하위호환을 위해 유지 — 다년 컨센서스는 estimates 배열로 별도 노출.
const STOCK_DETAIL_SELECT = `
  SELECT s.*,
         sc.total_score, sc.breakdown,
         f.fiscal_year, f.revenue, f.operating_income, f.net_income,
         f.per, f.pbr, f.roe, f.debt_ratio, f.div_yield,
         f.revenue_growth, f.eps_growth, f.ev_ebitda,
         e.fiscal_year AS est_fiscal_year, e.per AS forward_per,
         e.revenue AS est_revenue, e.operating_income AS est_operating_income,
         est.estimates,
         qest.quarterly_estimates,
         esp.earnings_surprises,
         i.last_close, i.rsi14, i.pct_from_52w_high, i.vol_ratio,
         i.foreign_net_20d, i.inst_net_20d, i.foreign_hold_ratio,
         i.above_ma20, i.golden_cross,
         i.macd, i.macd_signal, i.macd_hist, i.bb_pctb, i.bb_bandwidth,
         i.atr_pct, i.obv_trend, i.turnover_surge, i.f_score, i.f_score_max
  FROM stocks s
  LEFT JOIN stock_scores sc ON sc.ticker = s.ticker
  LEFT JOIN LATERAL (
    SELECT * FROM stock_financials
    WHERE ticker = s.ticker AND fiscal_quarter IS NULL AND is_estimate = FALSE
    ORDER BY fiscal_year DESC LIMIT 1
  ) f ON TRUE
  LEFT JOIN LATERAL (
    SELECT * FROM stock_financials
    WHERE ticker = s.ticker AND fiscal_quarter IS NULL AND is_estimate = TRUE
    ORDER BY fiscal_year ASC LIMIT 1
  ) e ON TRUE
  -- 다년 컨센서스(최대 +3년) — 값이 없는 필드는 naverConsensus 소스 단계에서 이미 null이므로
  -- 여기서는 채우지 않고 그대로 노출(클라이언트가 "없으면 기입하지 않음" 처리).
  LEFT JOIN LATERAL (
    SELECT json_agg(row_to_json(t) ORDER BY t.fiscal_year ASC) AS estimates
    FROM (
      SELECT fiscal_year, revenue, operating_income, net_income, eps, per, roe,
             CASE WHEN revenue > 0 THEN ROUND(operating_income::numeric / revenue, 4) ELSE NULL END AS op_margin,
             CASE WHEN revenue > 0 THEN ROUND(net_income::numeric / revenue, 4) ELSE NULL END AS net_margin,
             revenue_growth
      FROM stock_financials
      WHERE ticker = s.ticker AND fiscal_quarter IS NULL AND is_estimate = TRUE
      ORDER BY fiscal_year ASC LIMIT 3
    ) t
  ) est ON TRUE
  -- 분기별 실적·컨센서스 — 최근 확정 분기(최대 QUARTERLY_CONFIRMED_LIMIT개) + 추정 분기
  -- 전부(최대 QUARTERLY_ESTIMATE_LIMIT개)를 연도·분기 오름차순으로 노출. 확정은 최신순으로
  -- 뽑은 뒤 오름차순 정렬해야 "최근 N개"가 되므로 서브쿼리 안에서 DESC LIMIT → 바깥에서 ASC.
  LEFT JOIN LATERAL (
    SELECT json_agg(row_to_json(t) ORDER BY t.fiscal_year ASC, t.fiscal_quarter ASC) AS quarterly_estimates
    FROM (
      (
        SELECT fiscal_year, fiscal_quarter, is_estimate, revenue, operating_income, net_income,
               per, roe,
               CASE WHEN revenue > 0 THEN ROUND(operating_income::numeric / revenue, 4) ELSE NULL END AS op_margin,
               CASE WHEN revenue > 0 THEN ROUND(net_income::numeric / revenue, 4) ELSE NULL END AS net_margin,
               revenue_growth
        FROM stock_financials
        WHERE ticker = s.ticker AND fiscal_quarter IS NOT NULL AND is_estimate = FALSE
        ORDER BY fiscal_year DESC, fiscal_quarter DESC LIMIT ${QUARTERLY_CONFIRMED_LIMIT}
      )
      UNION ALL
      (
        SELECT fiscal_year, fiscal_quarter, is_estimate, revenue, operating_income, net_income,
               per, roe,
               CASE WHEN revenue > 0 THEN ROUND(operating_income::numeric / revenue, 4) ELSE NULL END AS op_margin,
               CASE WHEN revenue > 0 THEN ROUND(net_income::numeric / revenue, 4) ELSE NULL END AS net_margin,
               revenue_growth
        FROM stock_financials
        WHERE ticker = s.ticker AND fiscal_quarter IS NOT NULL AND is_estimate = TRUE
        ORDER BY fiscal_year ASC, fiscal_quarter ASC LIMIT ${QUARTERLY_ESTIMATE_LIMIT}
      )
    ) t
  ) qest ON TRUE
  -- 어닝 서프라이즈 — 최근 8분기. 분기표가 (fiscal_year, fiscal_quarter)로 매칭한다.
  LEFT JOIN LATERAL (
    SELECT json_agg(row_to_json(t)) AS earnings_surprises
    FROM (
      SELECT fiscal_year, fiscal_quarter, surprise_pct, revenue_surprise_pct, kind, detected_at
      FROM earnings_surprises
      WHERE ticker = s.ticker
      ORDER BY fiscal_year DESC, fiscal_quarter DESC
      LIMIT 8
    ) t
  ) esp ON TRUE
  LEFT JOIN stock_indicators i ON i.ticker = s.ticker
`;

const router = Router();

// 국내 종목코드 형식: 6자리 영숫자 (예: 005930, 900260, 우선주 접미 00593K 등 포함).
// router.param으로 등록하면 이 라우터의 모든 ':ticker' 라우트(상세·컨센서스·공시·뉴스·가격)에
// 한 번에 적용된다 — 각 핸들러에서 개별 검증할 필요 없음.
const TICKER_PARAM_RE = /^[0-9A-Z]{6}$/i;

router.param('ticker', (_req: Request, res: Response, next: NextFunction, ticker: string) => {
  if (!TICKER_PARAM_RE.test(ticker)) {
    res.status(400).json({ error: '잘못된 종목코드 형식' });
    return;
  }
  next();
});

// 전체 종목 목록
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const { rows } = await getDb().query(
    'SELECT ticker, name, market, sector FROM stocks WHERE is_active = TRUE ORDER BY name',
  );
  res.json(rows);
}));

/**
 * 종목 비교 — 2~3개 종목의 점수·재무·수급 지표를 나란히 조회.
 * 주의: '/:ticker'보다 먼저 등록해야 함 (Express 라우트 매칭 순서).
 */
router.get('/compare', asyncHandler(async (req: Request, res: Response) => {
  const tickers = parseTickersParam(req.query.tickers);
  if (!tickers) {
    res.status(400).json({ error: 'tickers는 2~4개의 종목코드(콤마 구분)여야 합니다' });
    return;
  }

  const { rows } = await getDb().query(
    `SELECT s.ticker, s.name, s.market, s.sector, s.market_cap,
            sc.total_score, sc.breakdown,
            f.fiscal_year, f.revenue, f.operating_income, f.net_income,
            f.per, f.pbr, f.roe, f.debt_ratio, f.div_yield,
            f.revenue_growth, f.eps_growth, f.ev_ebitda,
            e.fiscal_year AS est_fiscal_year, e.per AS forward_per,
            e.revenue AS est_revenue, e.operating_income AS est_operating_income,
            i.last_close, i.rsi14, i.pct_from_52w_high, i.vol_ratio,
            i.foreign_net_20d, i.inst_net_20d, i.foreign_hold_ratio,
            i.above_ma20, i.golden_cross
     FROM stocks s
     LEFT JOIN stock_scores sc ON sc.ticker = s.ticker
     LEFT JOIN LATERAL (
       SELECT * FROM stock_financials
       WHERE ticker = s.ticker AND fiscal_quarter IS NULL AND is_estimate = FALSE
       ORDER BY fiscal_year DESC LIMIT 1
     ) f ON TRUE
     LEFT JOIN LATERAL (
       SELECT * FROM stock_financials
       WHERE ticker = s.ticker AND fiscal_quarter IS NULL AND is_estimate = TRUE
       ORDER BY fiscal_year ASC LIMIT 1
     ) e ON TRUE
     LEFT JOIN stock_indicators i ON i.ticker = s.ticker
     WHERE s.ticker = ANY($1)`,
    [tickers],
  );

  const byTicker = new Map(rows.map((r: any) => [r.ticker, r]));
  const ordered = tickers.map((t) => byTicker.get(t)).filter((r) => r != null);
  res.json(ordered);
}));

// 종목 상세 — 시총·재무·밸류에이션·가이던스·지표(/compare와 동일 LATERAL 조인) + 기업개요.
router.get('/:ticker', asyncHandler(async (req: Request, res: Response) => {
  const { ticker } = req.params;
  const { rows } = await getDb().query(
    `${STOCK_DETAIL_SELECT} WHERE s.ticker = $1`,
    [ticker],
  );
  const stock = rows[0];
  if (!stock) { res.status(404).json({ error: 'Stock not found' }); return; }

  // 기업개요 지연 백필 — DB에 없으면 1회 스크랩 시도, 성공 시에만 캐시(UPDATE).
  // PGlite는 단일 프로세스 전용이라 이 UPDATE는 반드시 실행 중인 서버 프로세스 안에서만 수행된다.
  let businessSummary = stock.business_summary;
  if (!businessSummary) {
    const summary = await fetchCompanyProfile(ticker).catch(() => null);
    if (summary) {
      await getDb()
        .query(
          'UPDATE stocks SET business_summary = $1, business_summary_at = NOW() WHERE ticker = $2',
          [summary, ticker],
        )
        .catch(() => {});
      businessSummary = summary;
    }
  }

  res.json({
    ...stock,
    business_summary: businessSummary,
    estimates: stock.estimates ?? [],
    quarterlyEstimates: stock.quarterly_estimates ?? [],
    earningsSurprises: stock.earnings_surprises ?? [],
  });
}));

// 최근 공시 목록 (DART) — 이벤트 분류 포함
router.get('/:ticker/disclosures', asyncHandler(async (req: Request, res: Response) => {
  const { rows } = await getDb().query(
    `SELECT rcept_no, to_char(rcept_dt, 'YYYY-MM-DD') AS rcept_dt, report_nm,
            event_type, score_delta, detail
     FROM disclosure_events
     WHERE ticker = $1
     ORDER BY rcept_dt DESC, rcept_no DESC LIMIT 15`,
    [req.params.ticker],
  );
  res.json(rows.map((r) => ({
    ...r,
    url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${r.rcept_no}`,
  })));
}));

// 종목별 최근 뉴스 (네이버 증권, 5분 캐시)
router.get('/:ticker/news', asyncHandler(async (req: Request, res: Response) => {
  const items = await fetchStockNews(req.params.ticker);
  res.json(items);
}));

// 신용잔고(신용거래융자) — KIS OpenAPI [국내주식-110], 종목 상세 온디맨드 조회 + 30분 TTL 캐시.
// 2026-07-26 키움 ka10013에서 전환 — 키움은 특정 구간을 간헐적으로 0으로 반환하는 결함이 있었고
// 날짜가 결제일(T+2) 기준이라 주가와 2영업일 어긋났다. KIS는 거래일 기준 + 대주까지 제공.
// 전 종목 일괄 수집은 하지 않는다(kisCredit.ts 상단 주석 참고).
const CREDIT_TREND_DAYS = 735; // 종목 상세 신용잔고 추이 노출 영업일 수(약 3년, 확대·축소 차트용)
const CREDIT_CACHE_TTL_MS = 30 * 60 * 1000; // 신용잔고는 일 1회 갱신되는 데이터 — 30분이면 충분

// 종목마다 별도 캐시 슬롯이 필요해 티커를 키로 보관한다. 키 개수에 상한(LRU)을 두는 이유는
// 티커가 형식 검증만 통과하면 되는 외부 입력이라, 무작위 코드 폭주로 Map이 무한히 커질 수
// 있기 때문 — createKeyedTtlCache 주석 참고 (2026-07-26 전체 리뷰).
// 실패(null)는 캐시하지 않도록 loader가 throw — 다음 요청에서 즉시 재시도되며,
// 장애가 30분간 "데이터 없음"으로 고착되는 것을 막는다(fail-soft, 신용잔고 조회 실패 시 200 응답).
const MAX_CACHED_TICKERS = 500;

async function loadCreditTrend(ticker: string): Promise<CreditTrendPoint[]> {
  const trend = await fetchKisCreditTrend(ticker, CREDIT_TREND_DAYS);
  if (!trend) throw new Error('KIS 신용잔고 조회 실패');
  return trend;
}

const creditCache = createKeyedTtlCache(
  CREDIT_CACHE_TTL_MS,
  MAX_CACHED_TICKERS,
  (ticker) => () => loadCreditTrend(ticker),
);

router.get('/:ticker/credit-balance', asyncHandler(async (req: Request, res: Response) => {
  const { ticker } = req.params;

  let trend: CreditTrendPoint[];
  try {
    trend = await creditCache.get(ticker);
  } catch {
    // 키움 미설정·토큰 발급 실패·조회 실패 등 — 클라이언트가 조용히 섹션을 숨기도록 200으로 응답.
    res.json({ ticker, available: false, reason: 'KIS 신용잔고 데이터를 사용할 수 없습니다.' });
    return;
  }

  if (trend.length === 0) {
    res.json({ ticker, available: false, reason: 'KIS 신용잔고 데이터를 사용할 수 없습니다.' });
    return;
  }

  const [latest] = trend;
  res.json({
    ticker,
    available: true,
    asOf: latest.date,
    latest: {
      // 결제일을 함께 내린다 — 신용융자 잔고는 **결제가 끝난 행만** 존재해서 최신 거래일이
      // 시세보다 2영업일 뒤처진다. 근거(2026-07-26 실측): fid_input_date_1을 미래로 밀어도
      // 최신 deal_date가 그대로였고, 최신 행의 stlm_date가 항상 "마지막으로 완료된 영업일"이었다.
      // 이 값이 없으면 UI가 "데이터가 밀렸다"와 "원래 그렇다"를 구분해 보여줄 수 없다.
      settlementDate: latest.settlementDate,
      remainQty: latest.remainQty,
      remainAmt: latest.remainAmt,
      remainRatio: latest.remainRatio,
      shareRatio: latest.shareRatio,
      changeQty: latest.changeQty,
    },
    trend: trend.map((t) => ({
      date: t.date,
      remainQty: t.remainQty,
      remainAmt: t.remainAmt,
      remainRatio: t.remainRatio,
    })),
  });
}));

// PER 밴드·PBR 밴드·PBR-ROE 밴드 — 계산 자체는 valuationBandsQuery.ts(순수 함수는 valuationBands.ts).
// 가격은 Yahoo에서 5년치를 온디맨드 조회하므로 일 단위 갱신이면 충분 — 6시간 TTL.
const VALUATION_BANDS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// creditCache와 동일한 패턴 — 종목별 캐시를 LRU 상한 아래에서 보관.
const valuationBandsCache = createKeyedTtlCache(
  VALUATION_BANDS_CACHE_TTL_MS,
  MAX_CACHED_TICKERS,
  (ticker) => () => loadValuationBands(ticker),
);

router.get('/:ticker/valuation-bands', asyncHandler(async (req: Request, res: Response) => {
  const { ticker } = req.params;
  try {
    res.json(await valuationBandsCache.get(ticker));
  } catch (e: unknown) {
    // Yahoo 조회 실패 등 — loader가 throw했으므로 캐시되지 않고 다음 요청에서 재시도된다.
    // 클라이언트에는 500 대신 available:false로 응답(완료 조건 — 500 금지).
    logger.warn(`밸류에이션 밴드 (${ticker}) 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
    res.json({ available: false, reason: '밸류에이션 밴드 데이터를 사용할 수 없습니다.' });
  }
}));

/**
 * 기간 코드 → 원천별 조회 파라미터.
 * `kisDays`/`kisPeriod`는 KIS 정본 경로용, `range`/`interval`은 Yahoo 폴백용이다
 * (2026-07-26 Phase 2 — 국내 일봉 원천을 KIS로 전환하면서 이 경로도 함께 맞춤).
 * 달력일수는 영업일 기준 기간을 여유 있게 덮도록 잡는다.
 */
const PERIOD_RANGE: Record<
  string,
  { range: string; interval: string; pgInterval: string; kisDays: number; kisPeriod: 'D' | 'W' }
> = {
  '1m': { range: '1mo', interval: '1d',  pgInterval: '1 month',  kisDays: 45,  kisPeriod: 'D' },
  '3m': { range: '3mo', interval: '1d',  pgInterval: '3 months', kisDays: 120, kisPeriod: 'D' },
  '6m': { range: '6mo', interval: '1d',  pgInterval: '6 months', kisDays: 220, kisPeriod: 'D' },
  '1y': { range: '1y',  interval: '1wk', pgInterval: '1 year',   kisDays: 400, kisPeriod: 'W' },
};

// 주가 데이터 (DB 우선, 없으면 KIS 정본 → Yahoo 폴백으로 실시간 조회 후 캐시)
router.get('/:ticker/price', asyncHandler(async (req: Request, res: Response) => {
  const { ticker } = req.params;
  const period = (req.query.period as string) || '3m';
  const cfg = PERIOD_RANGE[period] ?? PERIOD_RANGE['3m'];

  const { rows: cached } = await getDb().query(
    `SELECT to_char(trade_date, 'YYYY-MM-DD') AS trade_date, open, high, low, close, volume
     FROM stock_prices
     WHERE ticker = $1 AND trade_date >= NOW() - INTERVAL '${cfg.pgInterval}'
     ORDER BY trade_date`,
    [ticker],
  );
  if (cached.length > 0) {
    // 장중(또는 거래량>0)일 때만 오늘 봉을 실시간 시세로 upsert. 실패해도 일봉 그대로(fail-soft).
    const { open } = kstMarket();
    const bar = (await fetchTodayBar([ticker])).get(ticker);
    const gated: TodayBar | null = bar && (open || bar.volume > 0) ? bar : null;
    const todayRow = gated
      ? { trade_date: gated.date, open: gated.open, high: gated.high, low: gated.low, close: gated.close, volume: gated.volume }
      : null;
    const merged = mergeTodayBar(cached as any[], todayRow, (r: any) => r.trade_date);
    res.json(merged);
    return;
  }

  const { rows: stock } = await getDb().query(
    'SELECT market FROM stocks WHERE ticker = $1',
    [ticker],
  );
  if (!stock[0]) { res.json([]); return; }

  try {
    // DB에 없는 종목(신규 상장 등)만 여기 온다. 원천은 KIS가 정본, Yahoo는 폴백이다 —
    // Yahoo는 거래일을 통째로 빠뜨리는 것이 실측됐고(2025-09-19, 6종목 전부), 여기서 받은 행을
    // stock_prices에 넣기 때문에 결측이 그대로 적재된다.
    const kisRows = await fetchKisDailyPrices(ticker, {
      days: cfg.kisDays,
      period: cfg.kisPeriod,
    });
    const rows = kisRows ?? (await fetchYahooChart(ticker, stock[0].market, cfg.range, cfg.interval));

    for (const row of rows) {
      await getDb().query(
        `INSERT INTO stock_prices (ticker, trade_date, open, high, low, close, volume)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (ticker, trade_date) DO NOTHING`,
        [ticker, row.trade_date, row.open, row.high, row.low, row.close, row.volume],
      ).catch(() => {});
    }

    res.json(rows);
  } catch {
    res.json([]);
  }
}));

export default router;
