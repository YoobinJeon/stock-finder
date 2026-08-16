import { getDb } from '../config/database';
import { subtractMonthsUTC, getUTCYear, getUTCMonthOneBased, diffDaysUTC } from '../utils/dateOnly';

/**
 * 시점 기준(Point-in-Time) 백테스트 — look-ahead 편향 방지가 핵심:
 * - 재무: 기준일에 이미 공시됐을 연도까지만 사용 (연간실적은 이듬해 3월말 공시 가정)
 * - 모멘텀: 기준일 이전 가격만 사용
 * - 수급·기술지표·신기술 팩터: 과거 시점 데이터가 없어 제외 (가치/퀄리티/성장/모멘텀 4팩터)
 * 채점 사다리는 실제 엔진(v3)과 동일한 기준을 축약 적용.
 */

export interface BacktestTopStock {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
  score: number;
  base_price: number;
  now_price: number;
  ret: number; // %
}

export interface BacktestResult {
  baseDate: string;
  latestDate: string;
  monthsAgo: number;
  universe: number;           // 채점 가능했던 종목 수 (비활성 종목 포함 — 생존편향 완화)
  topN: BacktestTopStock[];
  topAvg: number;             // 상위 N 평균 수익률 %
  allAvg: number;             // 유니버스 평균 %
  median: number;             // 유니버스 중앙값 %
  quintiles: Array<{ label: string; avgRet: number; count: number }>; // Q1(하위)~Q5(상위)
  excluded: string[];         // 제외된 팩터 설명
  delistedCount: number;      // universe 중 is_active=FALSE(상장폐지 추정) 종목 수 — 생존편향 크기 계량
  survivorshipNote: string;   // 생존편향 완화 방식의 한계 노트
}

// 실제 엔진 가중치에서 tech(0.10) 제외 후 정규화
const W = { value: 0.30, quality: 0.25, growth: 0.20, momentum: 0.15 };
const W_SUM = W.value + W.quality + W.growth + W.momentum;

const CONCURRENCY = 25;

const SURVIVORSHIP_NOTE =
  '기준일에 시세가 있던 종목은 이후 상장폐지 여부와 무관하게 전부 포함. 현재가(now_price)가 ' +
  '없는 종목(상폐 등)은 마지막 보유 종가로 수익률을 평가하므로, 상폐 직전 급락이 실제로는 ' +
  '더 컸더라도 마지막 종가 이후의 낙폭은 반영되지 않을 수 있음(수익률이 실제보다 낙관적일 소지).';

/** stock_indicators.last_close가 없을 때(상폐 등) 마지막 보유 종가로 폴백 — 생존편향 완화 */
export async function getLastKnownClose(db: any, ticker: string): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT close FROM stock_prices WHERE ticker = $1 AND close IS NOT NULL
     ORDER BY trade_date DESC LIMIT 1`,
    [ticker],
  );
  return rows[0]?.close != null ? Number(rows[0].close) : null;
}

export async function runBacktest(monthsAgo: number, top: number): Promise<BacktestResult> {
  const db = getDb();

  const { rows: dateRows } = await db.query(
    `SELECT to_char(MAX(trade_date), 'YYYY-MM-DD') AS latest FROM stock_prices`,
  );
  const latestDate: string | null = dateRows[0]?.latest ?? null;
  if (!latestDate) throw new Error('시세 데이터가 없습니다. 먼저 데이터 수집을 실행하세요.');

  // 기준일: 최신 거래일에서 N개월 전 (해당일 이전의 실제 거래일을 종목별로 사용)
  // UTC 고정 산술 — 서버 TZ가 KST가 아니어도 날짜가 밀리지 않도록 dateOnly 유틸 사용.
  const baseDate = subtractMonthsUTC(latestDate, monthsAgo);

  // 기준일에 공시돼 있었을 마지막 연간실적 연도 (3월말 공시 가정)
  const baseYear = getUTCYear(baseDate);
  const disclosedYear = getUTCMonthOneBased(baseDate) >= 4 ? baseYear - 1 : baseYear - 2;

  // 종목별 최신 확정 재무(공시연도 이하) — 한 번에 조회
  const { rows: finRows } = await db.query(
    `SELECT DISTINCT ON (ticker) ticker, eps, roe, debt_ratio, revenue,
            operating_income, net_income, revenue_growth, eps_growth
     FROM stock_financials
     WHERE fiscal_quarter IS NULL AND is_estimate = FALSE AND fiscal_year <= $1
     ORDER BY ticker, fiscal_year DESC`,
    [disclosedYear],
  );
  const finMap = new Map<string, any>(finRows.map((r: any) => [r.ticker, r]));

  // 현재가 (최신 지표에서)
  const { rows: nowRows } = await db.query(
    'SELECT ticker, last_close FROM stock_indicators WHERE last_close IS NOT NULL',
  );
  const nowMap = new Map<string, number>(
    nowRows.map((r: any) => [r.ticker, Number(r.last_close)]),
  );

  // 생존편향 완화: is_active 필터 제거 — 기준일에 시세가 있던 종목은 상폐 여부와 무관하게 채점.
  const { rows: stocks } = await db.query(
    `SELECT ticker, name, market, sector, is_active FROM stocks`,
  );

  const scored: BacktestTopStock[] = [];
  const activeByTicker = new Map<string, boolean>();

  for (let i = 0; i < stocks.length; i += CONCURRENCY) {
    const batch = stocks.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (s: any) => {
        // 기준일 이전 가격 (내림차순: [0]=기준일 직전 종가)
        const { rows: priceRows } = await db.query(
          `SELECT to_char(trade_date, 'YYYY-MM-DD') AS d, close FROM stock_prices
           WHERE ticker = $1 AND trade_date <= $2 AND close IS NOT NULL
           ORDER BY trade_date DESC LIMIT 130`,
          [s.ticker, baseDate],
        );
        if (priceRows.length < 20) return; // 기준일에 상장·데이터 없던 종목 제외
        // 기준일과 실제 거래일 격차가 7일 초과면 데이터 공백으로 간주
        const gapDays = diffDaysUTC(baseDate, priceRows[0].d);
        if (gapDays > 7) return;

        const closes = priceRows.map((r: any) => Number(r.close));
        const basePrice = closes[0];
        if (basePrice <= 0) return;

        // 현재가: stock_indicators 최신값 우선, 없으면(상폐 등) 마지막 보유 종가로 폴백
        let nowPrice = nowMap.get(s.ticker) ?? null;
        if (nowPrice == null || nowPrice <= 0) {
          nowPrice = await getLastKnownClose(db, s.ticker);
        }
        if (nowPrice == null || nowPrice <= 0) return;

        const score = pitScore(finMap.get(s.ticker), closes);
        const ret = ((nowPrice - basePrice) / basePrice) * 100;

        activeByTicker.set(s.ticker, Boolean(s.is_active));
        scored.push({
          ticker: s.ticker, name: s.name, market: s.market, sector: s.sector,
          score, base_price: basePrice, now_price: nowPrice,
          ret: Math.round(ret * 100) / 100,
        });
      }),
    );
  }

  const delistedCount = [...activeByTicker.values()].filter((active) => !active).length;

  if (scored.length < 50) {
    throw new Error(`채점 가능한 종목이 ${scored.length}개뿐입니다. 전체 시장 수집 후 다시 시도하세요.`);
  }

  scored.sort((a, b) => b.score - a.score);

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const rets = scored.map((s) => s.ret);
  const sortedRets = [...rets].sort((a, b) => a - b);
  const median = sortedRets[Math.floor(sortedRets.length / 2)];

  // 점수 5분위 — scored는 점수 내림차순이므로 k=0 구간이 Q5(최상위)
  const q = Math.floor(scored.length / 5);
  const quintileResults = [0, 1, 2, 3, 4].map((k) => {
    const start = k * q;
    const end = k === 4 ? scored.length : (k + 1) * q;
    const slice = scored.slice(start, end);
    return {
      label: `Q${5 - k}`,
      avgRet: Math.round(avg(slice.map((x) => x.ret)) * 100) / 100,
      count: slice.length,
    };
  });

  const topSlice = scored.slice(0, top);

  return {
    baseDate,
    latestDate,
    monthsAgo,
    universe: scored.length,
    topN: topSlice,
    topAvg: Math.round(avg(topSlice.map((x) => x.ret)) * 100) / 100,
    allAvg: Math.round(avg(rets) * 100) / 100,
    median: Math.round(median * 100) / 100,
    quintiles: quintileResults,
    excluded: ['신기술 팩터(시점 불변)', '수급·기술지표(과거 데이터 없음)'],
    delistedCount,
    survivorshipNote: SURVIVORSHIP_NOTE,
  };
}

export interface PitFactorScores {
  value: number;
  quality: number;
  growth: number;
  momentum: number;
}

/**
 * 시점 기준 4팩터 개별 점수(0~100 클램프) — 엔진 v3 사다리 축약판.
 * pitScore(가중합)와 evalWeightSets(후보 가중치 재적용)가 공유하는 순수 함수.
 */
export function computePitFactors(f: any, closes: number[]): PitFactorScores {
  const basePrice = closes[0];

  // ── 가치 (PER = 기준일 주가 / 당시 공시 EPS)
  let value = 50;
  if (f?.eps != null && Number(f.eps) !== 0) {
    const per = basePrice / Number(f.eps);
    const op = f.operating_income != null ? Number(f.operating_income) : null;
    const ni = f.net_income != null ? Number(f.net_income) : null;
    const oneOff = ni != null && ni > 0 && op != null && (op <= 0 || ni > op * 2);
    if (per < 0) value -= 15;
    else if (oneOff && per <= 15) value += 5;
    else if (per < 2) value += 10;
    else if (per <= 8) value += 20;
    else if (per <= 15) value += 10;
    else if (per > 25) value -= 10;
  }

  // ── 퀄리티 (ROE/부채비율/영업이익률/이익의 질)
  let quality = 50;
  if (f) {
    const op = f.operating_income != null ? Number(f.operating_income) : null;
    const ni = f.net_income != null ? Number(f.net_income) : null;
    const rev = f.revenue != null ? Number(f.revenue) : null;
    const oneOff = ni != null && ni > 0 && op != null && (op <= 0 || ni > op * 2);
    if (oneOff) quality -= 10;
    if (f.roe != null) {
      const roe = Number(f.roe) * 100;
      let d = 0;
      if (roe < 0) d = -25;
      else if (roe >= 20) d = 25;
      else if (roe >= 15) d = 15;
      else if (roe >= 10) d = 8;
      else if (roe < 5) d = -15;
      if (oneOff && d > 0) d = Math.round(d / 2);
      quality += d;
    }
    if (rev != null && rev > 0 && op != null) {
      const m = (op / rev) * 100;
      if (m >= 15) quality += 10;
      else if (m >= 8) quality += 5;
      else if (m < 0) quality -= 15;
    }
    if (f.debt_ratio != null) {
      const dr = Number(f.debt_ratio) * 100;
      if (dr < 50) quality += 15;
      else if (dr < 100) quality += 8;
      else if (dr >= 200) quality -= 15;
    }
  }

  // ── 성장 (당시 공시연도의 매출/EPS YoY)
  let growth = 50;
  if (f) {
    const op = f.operating_income != null ? Number(f.operating_income) : null;
    const ni = f.net_income != null ? Number(f.net_income) : null;
    const oneOff = ni != null && ni > 0 && op != null && (op <= 0 || ni > op * 2);
    if (f.revenue_growth != null) {
      const rg = Number(f.revenue_growth) * 100;
      if (rg >= 30) growth += rg > 150 ? 10 : 25;
      else if (rg >= 20) growth += 18;
      else if (rg >= 10) growth += 10;
      else if (rg >= 0) growth += 3;
      else growth -= 15;
    }
    if (f.eps_growth != null && !oneOff) {
      const eg = Number(f.eps_growth) * 100;
      if (eg >= 30) growth += eg > 150 ? 10 : 25;
      else if (eg >= 20) growth += 15;
      else if (eg >= 10) growth += 8;
      else if (eg >= 0) growth += 2;
      else growth -= 15;
    }
  }

  // ── 모멘텀 (기준일 이전 수익률 + RSI)
  let momentum = 50;
  const ret = (days: number) =>
    closes.length > days ? ((closes[0] - closes[days]) / closes[days]) * 100 : null;
  const retScore = (r: number, max: number) => Math.min(max, Math.max(-max, r * (max / 15)));
  const r1 = ret(21);
  const r3 = ret(63);
  const r6 = ret(126);
  if (r1 != null) momentum += Math.round(retScore(r1, 15));
  if (r3 != null) momentum += Math.round(retScore(r3, 15));
  if (r6 != null) momentum += Math.round(retScore(r6, 10));
  const rsi = calcRSI(closes.slice(0, 15).reverse());
  if (rsi != null) {
    if (rsi >= 40 && rsi <= 65) momentum += 8;
    else if (rsi > 70) momentum -= 10;
    else if (rsi < 30) momentum -= 8;
  }

  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  return { value: clamp(value), quality: clamp(quality), growth: clamp(growth), momentum: clamp(momentum) };
}

/** computePitFactors 결과를 엔진 v3 실가중치(V.30/Q.25/G.20/M.15 재정규화)로 가중합 */
export function combinePitFactors(factors: PitFactorScores): number {
  const total =
    (factors.value * W.value + factors.quality * W.quality +
     factors.growth * W.growth + factors.momentum * W.momentum) / W_SUM;
  return Math.round(total);
}

/** 시점 기준 4팩터 채점(computePitFactors + combinePitFactors) — 전략 평가에서도 사용 */
export function pitScore(f: any, closes: number[]): number {
  return combinePitFactors(computePitFactors(f, closes));
}

/** 점수 이력이 쌓인 날짜 목록 (기록 기반 백테스트 선택지) */
export async function getHistoryDates(): Promise<Array<{ as_of: string; count: number }>> {
  const db = getDb();
  const { rows } = await db.query(
    `SELECT to_char(as_of, 'YYYY-MM-DD') AS as_of, COUNT(*)::int AS count
     FROM score_history GROUP BY as_of ORDER BY as_of DESC LIMIT 60`,
  );
  return rows;
}

/**
 * 기록 기반 백테스트 (완전판): 당시 저장된 점수(수급·기술 포함 5팩터 + 규모 보정)를
 * 그대로 사용 — 재계산·근사 없음. 점수 이력이 쌓일수록 선택 가능한 기준일이 늘어난다.
 */
export async function runHistoryBacktest(asOf: string, top: number): Promise<BacktestResult> {
  const db = getDb();

  const { rows: dateRows } = await db.query(
    `SELECT to_char(MAX(trade_date), 'YYYY-MM-DD') AS latest FROM stock_prices`,
  );
  const latestDate: string | null = dateRows[0]?.latest ?? null;
  if (!latestDate) throw new Error('시세 데이터가 없습니다.');
  if (asOf >= latestDate) throw new Error('기준일 이후 거래일이 아직 없습니다. 시간이 지난 뒤 다시 확인하세요.');

  // 당시 점수 + 당시 종가 + 현재가를 한 번에 조인
  // 생존편향 완화: stocks의 is_active 필터 제거, stock_indicators는 LEFT JOIN(없으면 아래서 폴백)
  const { rows } = await db.query(
    `SELECT h.ticker, h.total_score,
            s.name, s.market, s.sector, s.is_active,
            p.close AS base_close,
            i.last_close
     FROM score_history h
     JOIN stocks s ON s.ticker = h.ticker
     JOIN stock_prices p ON p.ticker = h.ticker AND p.trade_date = $1 AND p.close > 0
     LEFT JOIN stock_indicators i ON i.ticker = h.ticker
     WHERE h.as_of = $1 AND h.total_score IS NOT NULL`,
    [asOf],
  );

  if (rows.length < 50) {
    throw new Error(`해당 기준일의 표본이 ${rows.length}개뿐입니다. 다른 날짜를 선택하세요.`);
  }

  const scored: BacktestTopStock[] = [];
  let delistedCount = 0;
  for (const r of rows as any[]) {
    // 현재가: stock_indicators 최신값 우선, 없으면(상폐 등) 마지막 보유 종가로 폴백
    const nowPrice = r.last_close != null ? Number(r.last_close) : await getLastKnownClose(db, r.ticker);
    if (nowPrice == null || nowPrice <= 0) continue;
    const basePrice = Number(r.base_close);
    if (!r.is_active) delistedCount++;
    scored.push({
      ticker: r.ticker,
      name: r.name,
      market: r.market,
      sector: r.sector,
      score: Math.round(Number(r.total_score)),
      base_price: basePrice,
      now_price: nowPrice,
      ret: Math.round(((nowPrice - basePrice) / basePrice) * 10000) / 100,
    });
  }

  if (scored.length < 50) {
    throw new Error(`현재가를 확인할 수 있는 표본이 ${scored.length}개뿐입니다. 다른 날짜를 선택하세요.`);
  }

  scored.sort((a, b) => b.score - a.score);

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const rets = scored.map((s) => s.ret);
  const sortedRets = [...rets].sort((a, b) => a - b);
  const median = sortedRets[Math.floor(sortedRets.length / 2)];

  const q = Math.floor(scored.length / 5);
  const quintileResults = [0, 1, 2, 3, 4].map((k) => {
    const start = k * q;
    const end = k === 4 ? scored.length : (k + 1) * q;
    const slice = scored.slice(start, end);
    return {
      label: `Q${5 - k}`,
      avgRet: Math.round(avg(slice.map((x) => x.ret)) * 100) / 100,
      count: slice.length,
    };
  });

  const topSlice = scored.slice(0, top);

  return {
    baseDate: asOf,
    latestDate,
    monthsAgo: 0,
    universe: scored.length,
    topN: topSlice,
    topAvg: Math.round(avg(topSlice.map((x) => x.ret)) * 100) / 100,
    allAvg: Math.round(avg(rets) * 100) / 100,
    median: Math.round(median * 100) / 100,
    quintiles: quintileResults,
    excluded: [], // 저장 시점 점수 그대로 — 전 팩터 포함
    delistedCount,
    survivorshipNote: SURVIVORSHIP_NOTE,
  };
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
