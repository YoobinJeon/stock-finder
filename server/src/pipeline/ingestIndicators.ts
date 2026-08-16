import { getDb } from '../config/database';
import { calcTrendMa } from './trendIndicators';
import { calcMACD, calcBollinger, calcATR, calcOBV, calcTurnoverSurge } from './technicalIndicators';
import { calcFscore, type FinYear } from './fscore';
import { isVolumeSurgeHigh, isInstNewAccum } from './signalDetection';
import { insertSignal } from './ingestRs';

/**
 * 저장된 시세·수급으로 기술지표를 집계해 stock_indicators에 upsert.
 * (2026-07-26 ingest.ts 분할 — 800줄 규칙. 로직은 그대로 옮겼다.)
 */

/** 저장된 시세·수급으로 기술지표 집계 → stock_indicators upsert. RS 백분위는 크로스섹션 계산이라
 *  여기서 채우지 않고 runIngest()가 전 종목 종가를 모은 뒤 updateRsPercentiles()로 별도 처리한다. */
export async function computeIndicators(ticker: string): Promise<void> {
  const db = getDb();
  const { rows: prices } = await db.query(
    `SELECT to_char(trade_date, 'YYYY-MM-DD') AS trade_date, close, high, low, volume
     FROM stock_prices
     WHERE ticker = $1 ORDER BY trade_date DESC LIMIT 261`,
    [ticker],
  );
  if (prices.length < 20) return;

  const closes = prices.map((r: any) => Number(r.close));
  const highs = prices.map((r: any) => Number(r.high ?? r.close));
  const lows = prices.map((r: any) => Number(r.low ?? r.close));
  const vols = prices.map((r: any) => (r.volume != null ? Number(r.volume) : 0));
  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const maAt = (n: number, offset: number) =>
    closes.length >= n + offset ? avg(closes.slice(offset, offset + n)) : null;
  const ma = (n: number) => maAt(n, 0);

  const lastClose = closes[0];
  const ma5 = ma(5);
  const ma10 = ma(10);
  const ma20 = ma(20);
  const ma60 = ma(60);
  const ma120 = ma(120);

  // 추세 초기 전환: MA5 ≥ MA10 (5일선이 10일선 위/상향돌파) + MA10 우상향(3일 전 대비 상승)
  const ma10Prev3 = maAt(10, 3);
  const earlyTrend =
    ma5 != null && ma10 != null && ma10Prev3 != null &&
    ma5 >= ma10 && ma10 > ma10Prev3;
  const high52 = Math.max(...prices.map((r: any) => Number(r.high ?? r.close)));
  const pctFromHigh = high52 > 0 ? ((lastClose - high52) / high52) * 100 : null;
  const vol20 = avg(vols.slice(0, 20));
  const volRatio = vol20 > 0 ? avg(vols.slice(0, 5)) / vol20 : null;
  const rsi14 = calcRSI(closes.slice(0, 15).reverse());
  const dayChange = closes.length >= 2 && closes[1] > 0
    ? ((closes[0] - closes[1]) / closes[1]) * 100
    : null;

  // 시그널 감지용: 전일 기준 MA(골든크로스 '발생'), 전일까지의 52주 고점(신고가 '경신')
  const ma20Prev = maAt(20, 1);
  const ma60Prev = maAt(60, 1);
  const goldenCrossNew =
    ma20 != null && ma60 != null && ma20Prev != null && ma60Prev != null &&
    ma20 > ma60 && ma20Prev <= ma60Prev;
  const prevHigh52 = prices.length >= 120
    ? Math.max(...prices.slice(1).map((r: any) => Number(r.high ?? r.close)))
    : null;
  const newHigh52 = prevHigh52 != null && lastClose >= prevHigh52;
  const signalDate: string = prices[0].trade_date;

  // 추세 지표 확장: MA50/150/200(+MA200 우상향)·52주 저점 대비
  const trendMa = calcTrendMa(closes, lows);

  const { rows: flows } = await db.query(
    `SELECT foreign_net, inst_net, foreign_amt, inst_amt, foreign_hold_ratio FROM stock_flows
     WHERE ticker = $1 ORDER BY trade_date DESC LIMIT 20`,
    [ticker],
  );
  const sum = (arr: any[], key: string, n: number) =>
    arr.length > 0 ? arr.slice(0, n).reduce((s, r) => s + (r[key] != null ? Number(r[key]) : 0), 0) : null;
  const streak = (key: string) => {
    let c = 0;
    for (const r of flows) {
      if (r[key] != null && Number(r[key]) > 0) c++;
      else break;
    }
    return flows.length > 0 ? c : null;
  };

  const f5 = sum(flows, 'foreign_net', 5);
  const f20 = sum(flows, 'foreign_net', 20);
  const i5 = sum(flows, 'inst_net', 5);
  const i20 = sum(flows, 'inst_net', 20);
  const f5a = sum(flows, 'foreign_amt', 5);
  const f20a = sum(flows, 'foreign_amt', 20);
  const i5a = sum(flows, 'inst_amt', 5);
  const i20a = sum(flows, 'inst_amt', 20);
  const fStreak = streak('foreign_net');

  // 기술 지표 확장 — 이미 로드된 시세 배열 재사용, 추가 쿼리 없음
  const macd = calcMACD(closes);
  const bb = calcBollinger(closes, 20, 2);
  const atr = calcATR(highs, lows, closes, 14);
  const obv = calcOBV(closes, vols);
  const turnoverSurge = calcTurnoverSurge(closes, vols, 20);

  // 간이 F-score — 연간 확정 재무 최신 3개년(전년 대비 기준용)
  const { rows: finRows } = await db.query(
    `SELECT net_income, roe, debt_ratio, revenue_growth
     FROM stock_financials
     WHERE ticker = $1 AND fiscal_quarter IS NULL AND is_estimate = FALSE
     ORDER BY fiscal_year DESC LIMIT 3`,
    [ticker],
  );
  const finYears: FinYear[] = finRows.map((r: any) => ({
    netIncome: r.net_income != null ? Number(r.net_income) : null,
    roe: r.roe != null ? Number(r.roe) : null,
    debtRatio: r.debt_ratio != null ? Number(r.debt_ratio) : null,
    revenueGrowth: r.revenue_growth != null ? Number(r.revenue_growth) : null,
  }));
  const fscore = calcFscore(finYears);

  await db.query(
    `INSERT INTO stock_indicators
       (ticker, last_close, day_change, ma20, ma60, ma120, rsi14, high_52w, pct_from_52w_high, vol_ratio,
        golden_cross, above_ma20, above_ma60,
        foreign_net_5d, foreign_net_20d, inst_net_5d, inst_net_20d,
        foreign_amt_5d, foreign_amt_20d, inst_amt_5d, inst_amt_20d,
        foreign_buy_streak, inst_buy_streak, foreign_hold_ratio,
        ma5, ma10, early_trend,
        ma50, ma150, ma200, ma200_up, low_52w, pct_from_52w_low,
        macd, macd_signal, macd_hist, bb_upper, bb_mid, bb_lower, bb_pctb, bb_bandwidth,
        atr14, atr_pct, obv, obv_trend, turnover_surge, f_score, f_score_max, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,
             $34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,NOW())
     ON CONFLICT (ticker) DO UPDATE SET
       last_close=EXCLUDED.last_close, day_change=EXCLUDED.day_change,
       ma20=EXCLUDED.ma20, ma60=EXCLUDED.ma60, ma120=EXCLUDED.ma120,
       rsi14=EXCLUDED.rsi14, high_52w=EXCLUDED.high_52w, pct_from_52w_high=EXCLUDED.pct_from_52w_high,
       vol_ratio=EXCLUDED.vol_ratio, golden_cross=EXCLUDED.golden_cross,
       above_ma20=EXCLUDED.above_ma20, above_ma60=EXCLUDED.above_ma60,
       foreign_net_5d=EXCLUDED.foreign_net_5d, foreign_net_20d=EXCLUDED.foreign_net_20d,
       inst_net_5d=EXCLUDED.inst_net_5d, inst_net_20d=EXCLUDED.inst_net_20d,
       foreign_amt_5d=EXCLUDED.foreign_amt_5d, foreign_amt_20d=EXCLUDED.foreign_amt_20d,
       inst_amt_5d=EXCLUDED.inst_amt_5d, inst_amt_20d=EXCLUDED.inst_amt_20d,
       foreign_buy_streak=EXCLUDED.foreign_buy_streak, inst_buy_streak=EXCLUDED.inst_buy_streak,
       foreign_hold_ratio=EXCLUDED.foreign_hold_ratio,
       ma5=EXCLUDED.ma5, ma10=EXCLUDED.ma10, early_trend=EXCLUDED.early_trend,
       ma50=EXCLUDED.ma50, ma150=EXCLUDED.ma150, ma200=EXCLUDED.ma200, ma200_up=EXCLUDED.ma200_up,
       low_52w=EXCLUDED.low_52w, pct_from_52w_low=EXCLUDED.pct_from_52w_low,
       macd=EXCLUDED.macd, macd_signal=EXCLUDED.macd_signal, macd_hist=EXCLUDED.macd_hist,
       bb_upper=EXCLUDED.bb_upper, bb_mid=EXCLUDED.bb_mid, bb_lower=EXCLUDED.bb_lower,
       bb_pctb=EXCLUDED.bb_pctb, bb_bandwidth=EXCLUDED.bb_bandwidth,
       atr14=EXCLUDED.atr14, atr_pct=EXCLUDED.atr_pct, obv=EXCLUDED.obv, obv_trend=EXCLUDED.obv_trend,
       turnover_surge=EXCLUDED.turnover_surge, f_score=EXCLUDED.f_score, f_score_max=EXCLUDED.f_score_max,
       updated_at=NOW()`,
    [
      ticker, lastClose, dayChange, ma20, ma60, ma120, rsi14, high52, pctFromHigh, volRatio,
      ma20 != null && ma60 != null ? ma20 > ma60 : null,
      ma20 != null ? lastClose > ma20 : null,
      ma60 != null ? lastClose > ma60 : null,
      f5, f20, i5, i20,
      f5a, f20a, i5a, i20a,
      fStreak, streak('inst_net'),
      flows[0]?.foreign_hold_ratio ?? null,
      ma5, ma10, earlyTrend,
      trendMa.ma50, trendMa.ma150, trendMa.ma200, trendMa.ma200Up, trendMa.low52w, trendMa.pctFrom52wLow,
      macd?.macd ?? null, macd?.signal ?? null, macd?.histogram ?? null,
      bb?.upper ?? null, bb?.mid ?? null, bb?.lower ?? null, bb?.pctB ?? null, bb?.bandwidth ?? null,
      atr?.atr ?? null, atr?.atrPct ?? null, obv?.obv ?? null, obv?.trend ?? null,
      turnoverSurge, fscore.max > 0 ? fscore.score : null, fscore.max > 0 ? fscore.max : null,
    ],
  );

  // 시그널 감지 (기준일당 종목·타입별 1회 — ON CONFLICT DO NOTHING)
  const addSignal = (type: string, detail: Record<string, unknown>) =>
    insertSignal(db, signalDate, ticker, type, detail);

  if (goldenCrossNew) {
    await addSignal('golden_cross', { close: lastClose, ma20: Math.round(ma20!), ma60: Math.round(ma60!) });
  }
  if (newHigh52) {
    await addSignal('high_52w', { close: lastClose, prev_high: prevHigh52 });
  }
  if (fStreak != null && fStreak >= 5) {
    await addSignal('foreign_streak', { streak: fStreak, foreign_5d: f5, foreign_5d_amt: f5a });
  }
  if (f5a != null && i5a != null && f20a != null && i20a != null && f5a > 0 && i5a > 0 && f20a > 0 && i20a > 0) {
    await addSignal('dual_flow', { foreign_5d: f5, inst_5d: i5, foreign_5d_amt: f5a, inst_5d_amt: i5a });
  }
  // 신규 3종 — 거래대금급증 신고가 근접 / 기관 신규 매집 전환 (rs_top_entry는 크로스섹션이라
  // updateRsPercentiles()에서 별도 처리)
  if (isVolumeSurgeHigh(turnoverSurge, pctFromHigh)) {
    await addSignal('volume_surge_high', {
      turnover_surge: turnoverSurge,
      pct_from_52w_high: pctFromHigh,
      close: lastClose,
    });
  }
  if (isInstNewAccum(i5a, i20a)) {
    await addSignal('inst_new_accum', { inst_5d_amt: i5a, inst_20d_amt: i20a });
  }
}

function calcRSI(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const rs = losses === 0 ? 100 : gains / losses;
  return 100 - 100 / (1 + rs);
}
