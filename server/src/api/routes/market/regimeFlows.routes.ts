import { Router, Request, Response } from 'express';
import { getDb } from '../../../config/database';
import { computeMarketRegime, refreshRegimeIfDue } from '../../../pipeline/marketRegime';
import { kstMarket, fetchStockQuotes } from './shared';
import { overlayFlowsQuotes, collectFlowsTickers, FlowGroup, OverlayableRow } from './flowsOverlay';
import { logger } from '../../../utils/logger';
import { jobRunner } from '../../../pipeline/JobRunner';
import { asyncHandler } from '../../../utils/asyncHandler';

const router = Router();

// 추정평균가 계산에 쓰는 순매수 이력 최대 거래일 수 (랭킹 기간과 분리, 사실상 보유 전체 이력).
// 데이터가 쌓일수록 실제 매집 평균에 가까워진다. 현재 보유 데이터는 약 2026-06-17부터라 한 달 남짓.
const AVG_LOOKBACK = 250;

/**
 * 장중이면 그룹 내 전체 티커의 실시간 시세를 일괄 조회해 currentPrice·returnPct에 반영.
 * 기본/세부 모드 공용 (DRY). 네이버 조회 실패 시 fail-soft — 원본 groups를 그대로 서빙(엔드포인트 실패 금지).
 */
async function applyLiveOverlay<T extends OverlayableRow>(
  groups: FlowGroup<T>[],
): Promise<{ groups: FlowGroup<T>[]; intraday: boolean; asOf: string | null }> {
  const { open, hhmm } = kstMarket();
  if (!open) return { groups, intraday: false, asOf: null };

  try {
    const quotes = await fetchStockQuotes(collectFlowsTickers(groups));
    return { groups: overlayFlowsQuotes(groups, quotes), intraday: true, asOf: hhmm };
  } catch (e: any) {
    logger.warn(`수급 순위 실시간 시세 오버레이 실패 — 원본 그룹으로 서빙: ${e?.message}`);
    return { groups, intraday: true, asOf: hhmm };
  }
}

// 시장 색깔 — 최근 7일
router.get('/regime', asyncHandler(async (_req: Request, res: Response) => {
  await refreshRegimeIfDue(); // 장중이면 90초 스로틀 내 재계산
  const { rows } = await getDb().query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, kospi_close, kospi_chg,
            kospi_up, kospi_down, kosdaq_chg,
            ks_foreign_bn, ks_inst_bn, kq_foreign_bn, rotation_signal, note
     FROM market_regime ORDER BY date DESC LIMIT 7`,
  );
  res.json(rows);
}));

// 시장 색깔 즉시 재계산
router.post('/regime/recompute', asyncHandler(async (_req: Request, res: Response) => {
  if (jobRunner.isRunning()) {
    res.status(409).json({ error: '이미 실행 중인 수집 작업이 있습니다.', status: jobRunner.getStatus() });
    return;
  }
  try {
    const d = await computeMarketRegime();
    res.json({ ok: true, date: d });
  } catch (e) {
    logger.warn('시장 색깔 즉시 재계산 실패', e);
    res.status(500).json({ ok: false, error: '요청 처리 중 오류가 발생했습니다.' });
  }
}));

// 수급 순위 — 투자자 주체별 시총대비 순매수/매도 상위 종목.
// mode=basic: 외국인·기관·개인 (네이버, 수량×종가 근사)
// mode=detail: 연기금·투신·사모 등 세부 기관 (KRX [12010] 순매수대금 실측)
router.get('/flows-ranking', asyncHandler(async (req: Request, res: Response) => {
  const days = [1, 5, 10, 20].includes(Number(req.query.days)) ? Number(req.query.days) : 5;
  if (req.query.mode === 'detail') {
    await detailFlowsRanking(days, res);
    return;
  }
  const db = getDb();

  // 추정평균가는 랭킹 기간(days)과 분리해 보유 전체 이력(최대 AVG_LOOKBACK 거래일)의
  // "순매수일만" 금액가중으로 계산 — 하루치만 쓰면 평단=종가가 되어 수익률이 전부 0%가 되는 문제 방지,
  // 순매수·순매도가 섞여 수량이 왜곡되는 문제도 순매수일 한정으로 완화. (데이터가 쌓일수록 정확해짐)
  // 수량은 "대금÷종가" 근사 대신 foreign_qty/inst_qty/individual_qty(네이버 실제 순매수 수량)를 사용한다
  // (수급 추정평균가 정확화). 기본 모드는 금액=수량×종가 근사라 당일평단이 종가와 사실상 같아 의미가
  // 없으므로 todayAvgPrice는 항상 null로 반환(세부 모드에서만 키움 매칭 당일평단 제공).
  const { rows } = await db.query(
    `WITH rank_dates AS (
       SELECT DISTINCT trade_date FROM stock_flows ORDER BY trade_date DESC LIMIT $1
     ),
     avg_dates AS (
       SELECT DISTINCT trade_date FROM stock_flows ORDER BY trade_date DESC LIMIT $2
     ),
     rank_agg AS (  -- 랭킹용: 선택 기간 순매수 총계 (기존 동작 유지)
       SELECT f.ticker,
              SUM(f.foreign_amt)::bigint    AS foreign_amt,
              SUM(f.inst_amt)::bigint       AS inst_amt,
              SUM(f.individual_amt)::bigint AS individual_amt
       FROM stock_flows f
       WHERE f.trade_date IN (SELECT trade_date FROM rank_dates)
       GROUP BY f.ticker
     ),
     avg_agg AS (  -- 추정평단용: 보유 전체 이력 중 순매수일만 금액·수량 가중
       SELECT f.ticker,
              SUM(f.foreign_amt)    FILTER (WHERE f.foreign_amt > 0 AND f.foreign_qty > 0) AS foreign_buy_amt,
              SUM(f.inst_amt)       FILTER (WHERE f.inst_amt > 0 AND f.inst_qty > 0)    AS inst_buy_amt,
              SUM(f.individual_amt) FILTER (WHERE f.individual_amt > 0 AND f.individual_qty > 0) AS individual_buy_amt,
              SUM(f.foreign_qty)    FILTER (WHERE f.foreign_amt > 0 AND f.foreign_qty > 0) AS foreign_buy_qty,
              SUM(f.inst_qty)       FILTER (WHERE f.inst_amt > 0 AND f.inst_qty > 0)    AS inst_buy_qty,
              SUM(f.individual_qty) FILTER (WHERE f.individual_amt > 0 AND f.individual_qty > 0) AS individual_buy_qty
       FROM stock_flows f
       WHERE f.trade_date IN (SELECT trade_date FROM avg_dates)
       GROUP BY f.ticker
     ),
     latest_krx AS (  -- 기본 모드 당일평단(키움 매칭): KRX 실측(외국인/기관합계/개인)의 가장 최근 buy_qty≠0 날
                       -- 매수(BID)대금÷매수수량 — 키움 추정평균가와 동일 기준 (수급 당일평단 정밀화)
       SELECT DISTINCT ON (f.ticker, f.investor)
              f.ticker, f.investor,
              f.buy_amt::numeric / NULLIF(f.buy_qty, 0) AS today_avg_price
       FROM stock_flows_krx f
       WHERE f.investor IN ('외국인', '기관합계', '개인') AND f.buy_qty <> 0
       ORDER BY f.ticker, f.investor, f.trade_date DESC
     )
     SELECT r.ticker, r.foreign_amt, r.inst_amt, r.individual_amt,
            av.foreign_buy_amt, av.inst_buy_amt, av.individual_buy_amt,
            av.foreign_buy_qty, av.inst_buy_qty, av.individual_buy_qty,
            lf.today_avg_price AS foreign_today,
            li.today_avg_price AS inst_today,
            lp.today_avg_price AS individual_today,
            s.name, s.market, s.sector, s.market_cap,
            ROUND(sc.total_score)::int AS total_score,
            i.last_close AS current_price
     FROM rank_agg r
     JOIN stocks s ON s.ticker = r.ticker AND s.is_active = TRUE
     LEFT JOIN avg_agg av ON av.ticker = r.ticker
     LEFT JOIN latest_krx lf ON lf.ticker = r.ticker AND lf.investor = '외국인'
     LEFT JOIN latest_krx li ON li.ticker = r.ticker AND li.investor = '기관합계'
     LEFT JOIN latest_krx lp ON lp.ticker = r.ticker AND lp.investor = '개인'
     LEFT JOIN stock_scores sc ON sc.ticker = r.ticker
     LEFT JOIN stock_indicators i ON i.ticker = r.ticker
     WHERE s.market_cap > 0`,
    [days, AVG_LOOKBACK],
  );

  const { rows: dateRows } = await db.query(
    `SELECT to_char(MIN(d), 'YYYY-MM-DD') AS from_d, to_char(MAX(d), 'YYYY-MM-DD') AS to_d
     FROM (SELECT DISTINCT trade_date AS d FROM stock_flows ORDER BY d DESC LIMIT $1) t`,
    [days],
  );

  const MIN_AMT = 1e8; // 1억 미만 순매수는 노이즈로 제외
  const TOP = 20;
  const investors = [
    { key: 'foreign', label: '외국인', col: 'foreign_amt', buyAmtCol: 'foreign_buy_amt', buyQtyCol: 'foreign_buy_qty', todayCol: 'foreign_today' },
    { key: 'inst', label: '기관', col: 'inst_amt', buyAmtCol: 'inst_buy_amt', buyQtyCol: 'inst_buy_qty', todayCol: 'inst_today' },
    { key: 'individual', label: '개인', col: 'individual_amt', buyAmtCol: 'individual_buy_amt', buyQtyCol: 'individual_buy_qty', todayCol: 'individual_today' },
  ] as const;

  const groups = investors.map(({ key, label, col, buyAmtCol, buyQtyCol, todayCol }) => {
    const ranked = rows
      .filter((r) => r[col] != null && Math.abs(Number(r[col])) >= MIN_AMT)
      .map((r) => {
        const amt = Number(r[col]);
        const buyAmt = r[buyAmtCol] != null ? Number(r[buyAmtCol]) : null;
        const buyQty = r[buyQtyCol] != null ? Number(r[buyQtyCol]) : null;
        const estAvgPrice = buyAmt && buyQty && buyQty !== 0 ? Math.round(buyAmt / buyQty) : null;
        // 당일평단: KRX 실측(외국인/기관합계/개인)이 있으면 사용, 없으면 null(네이버만 있는 경우 종가와 같아 무의미)
        const todayAvgPrice = r[todayCol] != null ? Math.round(Number(r[todayCol])) : null;
        const currentPrice = r.current_price != null ? Number(r.current_price) : null;
        const returnPct =
          estAvgPrice && currentPrice ? ((currentPrice - estAvgPrice) / estAvgPrice) * 100 : null;
        return {
          ticker: r.ticker,
          name: r.name,
          market: r.market,
          sector: r.sector,
          totalScore: r.total_score,
          amt,
          ratio: (amt / Number(r.market_cap)) * 100, // 시총대비 %
          estAvgPrice,
          todayAvgPrice,
          currentPrice,
          returnPct,
        };
      });
    const buy = [...ranked].sort((a, b) => b.ratio - a.ratio).slice(0, TOP).filter((r) => r.ratio > 0);
    const sell = [...ranked].sort((a, b) => a.ratio - b.ratio).slice(0, TOP).filter((r) => r.ratio < 0);
    return { key, label, buy, sell };
  });

  const overlay = await applyLiveOverlay(groups);
  res.json({
    days,
    from: dateRows[0]?.from_d ?? null,
    to: dateRows[0]?.to_d ?? null,
    groups: overlay.groups,
    intraday: overlay.intraday,
    asOf: overlay.asOf,
  });
}));

/** 세부 주체(KRX) 랭킹 — stock_flows_krx 최근 N영업일 합산 */
async function detailFlowsRanking(days: number, res: Response): Promise<void> {
  const db = getDb();
  const investors = ['연기금', '투신', '사모', '금융투자'];

  // 기본 모드와 동일: 랭킹은 선택 기간 순매수 총계, 누적평단은 보유 전체 이력의 순매수일만 금액·수량 가중
  // (net_qty 실측 — 수급 추정평균가 정확화). 세부 모드는 여기에 더해 "당일평단"(키움 매칭)도 계산한다:
  // 가장 최근 buy_qty≠0인 날의 매수(BID)대금÷매수수량 — 키움 추정평균가와 동일 기준(수급 당일평단 정밀화).
  // latest_agg는 랭킹 기간과 무관하게 종목·주체별 전체 이력에서 최신 1건만 뽑는다.
  const { rows } = await db.query(
    `WITH rank_dates AS (
       SELECT DISTINCT trade_date FROM stock_flows_krx ORDER BY trade_date DESC LIMIT $1
     ),
     avg_dates AS (
       SELECT DISTINCT trade_date FROM stock_flows_krx ORDER BY trade_date DESC LIMIT $3
     ),
     rank_agg AS (
       SELECT f.ticker, f.investor, SUM(f.net_amt)::bigint AS net_amt
       FROM stock_flows_krx f
       WHERE f.trade_date IN (SELECT trade_date FROM rank_dates) AND f.investor = ANY($2)
       GROUP BY f.ticker, f.investor
     ),
     avg_agg AS (
       SELECT f.ticker, f.investor,
              SUM(f.net_amt) FILTER (WHERE f.net_amt > 0 AND f.net_qty > 0) AS buy_amt,
              SUM(f.net_qty) FILTER (WHERE f.net_amt > 0 AND f.net_qty > 0) AS buy_qty
       FROM stock_flows_krx f
       WHERE f.trade_date IN (SELECT trade_date FROM avg_dates) AND f.investor = ANY($2)
       GROUP BY f.ticker, f.investor
     ),
     latest_agg AS (  -- 당일평단(키움 매칭): 종목·주체별 가장 최근 buy_qty≠0 인 날의 매수(BID)대금÷매수수량
       SELECT DISTINCT ON (f.ticker, f.investor)
              f.ticker, f.investor,
              f.buy_amt::numeric / NULLIF(f.buy_qty, 0) AS today_avg_price
       FROM stock_flows_krx f
       WHERE f.investor = ANY($2) AND f.buy_qty <> 0
       ORDER BY f.ticker, f.investor, f.trade_date DESC
     )
     SELECT r.ticker, r.investor, r.net_amt, av.buy_amt, av.buy_qty, la.today_avg_price,
            s.name, s.market, s.sector, s.market_cap,
            ROUND(sc.total_score)::int AS total_score,
            i.last_close AS current_price
     FROM rank_agg r
     JOIN stocks s ON s.ticker = r.ticker AND s.is_active = TRUE
     LEFT JOIN avg_agg av ON av.ticker = r.ticker AND av.investor = r.investor
     LEFT JOIN latest_agg la ON la.ticker = r.ticker AND la.investor = r.investor
     LEFT JOIN stock_scores sc ON sc.ticker = r.ticker
     LEFT JOIN stock_indicators i ON i.ticker = r.ticker
     WHERE s.market_cap > 0`,
    [days, investors, AVG_LOOKBACK],
  );

  const { rows: dateRows } = await db.query(
    `SELECT to_char(MIN(d), 'YYYY-MM-DD') AS from_d, to_char(MAX(d), 'YYYY-MM-DD') AS to_d
     FROM (SELECT DISTINCT trade_date AS d FROM stock_flows_krx ORDER BY d DESC LIMIT $1) t`,
    [days],
  );

  const MIN_AMT = 1e8;
  const TOP = 20;
  const groups = investors.map((label) => {
    const ranked = rows
      .filter((r) => r.investor === label && Math.abs(Number(r.net_amt)) >= MIN_AMT)
      .map((r) => {
        const amt = Number(r.net_amt);
        const buyAmt = r.buy_amt != null ? Number(r.buy_amt) : null;
        const buyQty = r.buy_qty != null ? Number(r.buy_qty) : null;
        const estAvgPrice = buyAmt && buyQty && buyQty !== 0 ? Math.round(buyAmt / buyQty) : null;
        const todayAvgPrice = r.today_avg_price != null ? Math.round(Number(r.today_avg_price)) : null;
        const currentPrice = r.current_price != null ? Number(r.current_price) : null;
        const returnPct =
          estAvgPrice && currentPrice ? ((currentPrice - estAvgPrice) / estAvgPrice) * 100 : null;
        return {
          ticker: r.ticker,
          name: r.name,
          market: r.market,
          sector: r.sector,
          totalScore: r.total_score,
          amt,
          ratio: (amt / Number(r.market_cap)) * 100,
          estAvgPrice,
          todayAvgPrice,
          currentPrice,
          returnPct,
        };
      });
    const buy = [...ranked].sort((a, b) => b.ratio - a.ratio).slice(0, TOP).filter((r) => r.ratio > 0);
    const sell = [...ranked].sort((a, b) => a.ratio - b.ratio).slice(0, TOP).filter((r) => r.ratio < 0);
    return { key: label, label, buy, sell };
  });

  const overlay = await applyLiveOverlay(groups);
  res.json({
    days,
    from: dateRows[0]?.from_d ?? null,
    to: dateRows[0]?.to_d ?? null,
    groups: overlay.groups,
    intraday: overlay.intraday,
    asOf: overlay.asOf,
  });
}

export default router;
