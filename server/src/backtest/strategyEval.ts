import { getDb } from '../config/database';
import { computePitFactors, combinePitFactors, getLastKnownClose, type PitFactorScores } from './runBacktest';
import { calcTrendMa, calcMomentumReturn, calcRsPercentile, type RsInput } from '../pipeline/trendIndicators';
import { subtractMonthsUTC, getUTCYear, getUTCMonthOneBased, diffDaysUTC } from '../utils/dateOnly';

/**
 * 전략 성과 검증 + 전략 탐색.
 * 과거 시점(PIT) 데이터셋에 각 전략의 조건을 적용해 "그때 그 전략으로 걸렀다면
 * 이후 수익률이 어땠나"를 계산. 수급 조건은 과거 데이터가 없어 제외하고 표시.
 */

export interface PitRow {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
  basePrice: number;
  nowPrice: number;
  ret: number;               // 기준일 → 현재 수익률 %
  score: number;             // PIT 4팩터 점수
  per: number | null;        // 기준일 주가 / 당시 공시 EPS
  opMargin: number | null;   // %
  revGrowth: number | null;  // %
  divYield: number | null;   // % (당시 공시연도 행에 있을 때만)
  marketCapT: number | null; // 근사: 현재 시총 × (당시가/현재가)
  aboveMa20: boolean | null;
  goldenCross: boolean | null; // 기준일에 MA20 > MA60 상태
  rsi: number | null;
  pct52w: number | null;     // 보유 이력 내 고점 대비 %
  volRatio: number | null;
  // 추세 지표 확장 (거장 전략 정밀화) — 기준일 시점 재계산(PIT), stock_prices 보유분 한도 내
  aboveMa150: boolean | null;
  aboveMa200: boolean | null;
  ma150AboveMa200: boolean | null;
  ma200Up: boolean | null;
  pctFrom52wLow: number | null;
  rsPercentile: number | null; // 유니버스 전체 대비 크로스섹션 순위 — buildPitDataset에서 사후 병합
  // 기준일 시점 수급 (stock_flows 이력이 기준일을 커버할 때만)
  foreignAmt5: number | null;   // 기준일 이전 5일 외국인 순매수 금액(원)
  instAmt5: number | null;
  foreignStreak: number | null; // 기준일 기준 연속 순매수 일수
  factors: PitFactorScores;     // 팩터별 개별 점수(0~100) — evalWeightSets 원료
}

const FLOW_KEYS: string[] = ['foreignNetBuy5d', 'instNetBuy5d', 'minForeignStreak'];
const CONCURRENCY = 25;

export async function buildPitDataset(monthsAgo: number): Promise<{
  baseDate: string; latestDate: string; rows: PitRow[]; delistedCount: number;
}> {
  const db = getDb();

  const { rows: dateRows } = await db.query(
    `SELECT to_char(MAX(trade_date), 'YYYY-MM-DD') AS latest FROM stock_prices`,
  );
  const latestDate: string | null = dateRows[0]?.latest ?? null;
  if (!latestDate) throw new Error('시세 데이터가 없습니다.');

  // UTC 고정 산술 — 서버 TZ가 KST가 아니어도 날짜가 밀리지 않도록 dateOnly 유틸 사용.
  const baseDate = subtractMonthsUTC(latestDate, monthsAgo);
  const baseYear = getUTCYear(baseDate);
  const disclosedYear = getUTCMonthOneBased(baseDate) >= 4 ? baseYear - 1 : baseYear - 2;

  const { rows: finRows } = await db.query(
    `SELECT DISTINCT ON (ticker) ticker, eps, roe, debt_ratio, revenue,
            operating_income, net_income, revenue_growth, eps_growth, div_yield
     FROM stock_financials
     WHERE fiscal_quarter IS NULL AND is_estimate = FALSE AND fiscal_year <= $1
     ORDER BY ticker, fiscal_year DESC`,
    [disclosedYear],
  );
  const finMap = new Map<string, any>(finRows.map((r: any) => [r.ticker, r]));

  const { rows: nowRows } = await db.query(
    'SELECT ticker, last_close FROM stock_indicators WHERE last_close IS NOT NULL',
  );
  const nowMap = new Map<string, number>(nowRows.map((r: any) => [r.ticker, Number(r.last_close)]));

  // 생존편향 완화: is_active 필터 제거 — 기준일에 시세가 있던 종목은 상폐 여부와 무관하게 포함.
  const { rows: stocks } = await db.query(
    'SELECT ticker, name, market, sector, market_cap, is_active FROM stocks',
  );

  const rows: PitRow[] = [];
  const activeByTicker = new Map<string, boolean>();
  // RS 백분위는 크로스섹션 계산이라 루프 안에서는 모멘텀 수익률만 모아두고, 루프 종료 후 한 번에 순위를 매긴다.
  const momentumByTicker = new Map<string, number>();

  for (let i = 0; i < stocks.length; i += CONCURRENCY) {
    const batch = stocks.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (s: any) => {
        const { rows: priceRows } = await db.query(
          `SELECT to_char(trade_date, 'YYYY-MM-DD') AS d, close, high, low, volume FROM stock_prices
           WHERE ticker = $1 AND trade_date <= $2 AND close IS NOT NULL
           ORDER BY trade_date DESC LIMIT 260`,
          [s.ticker, baseDate],
        );
        if (priceRows.length < 20) return;
        const gapDays = diffDaysUTC(baseDate, priceRows[0].d);
        if (gapDays > 7) return;

        const closes = priceRows.map((r: any) => Number(r.close));
        const lows = priceRows.map((r: any) => Number(r.low ?? r.close));
        const vols = priceRows.map((r: any) => (r.volume != null ? Number(r.volume) : 0));
        const basePrice = closes[0];
        if (basePrice <= 0) return;

        // 현재가: stock_indicators 최신값 우선, 없으면(상폐 등) 마지막 보유 종가로 폴백
        let nowPrice = nowMap.get(s.ticker) ?? null;
        if (nowPrice == null || nowPrice <= 0) {
          nowPrice = await getLastKnownClose(db, s.ticker);
        }
        if (nowPrice == null || nowPrice <= 0) return;

        const avgArr = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
        const ma = (n: number) => (closes.length >= n ? avgArr(closes.slice(0, n)) : null);
        const ma20 = ma(20);
        const ma60 = ma(60);
        const high = Math.max(...priceRows.map((r: any) => Number(r.high ?? r.close)));
        const vol20 = vols.length >= 20 ? avgArr(vols.slice(0, 20)) : 0;

        // 추세 지표 확장 — 기준일 시점 재계산(같은 순수함수를 실시간 지표 계산과 공유)
        const trendMa = calcTrendMa(closes, lows);
        const momentum = calcMomentumReturn(closes);
        if (momentum != null) momentumByTicker.set(s.ticker, momentum.retPct);

        const f = finMap.get(s.ticker);
        const per = f?.eps != null && Number(f.eps) !== 0 ? basePrice / Number(f.eps) : null;
        const rev = f?.revenue != null ? Number(f.revenue) : null;
        const op = f?.operating_income != null ? Number(f.operating_income) : null;
        const pitFactors = computePitFactors(f, closes);

        // 기준일 시점 수급 (이력이 기준일 이전 5일 이상을 커버할 때만 유효)
        const { rows: flowRows } = await db.query(
          `SELECT foreign_amt, inst_amt FROM stock_flows
           WHERE ticker = $1 AND trade_date <= $2 AND foreign_amt IS NOT NULL
           ORDER BY trade_date DESC LIMIT 20`,
          [s.ticker, baseDate],
        );
        let foreignAmt5: number | null = null;
        let instAmt5: number | null = null;
        let foreignStreak: number | null = null;
        if (flowRows.length >= 5) {
          const sumN = (key: string, n: number) =>
            flowRows.slice(0, n).reduce((acc: number, r: any) => acc + (r[key] != null ? Number(r[key]) : 0), 0);
          foreignAmt5 = sumN('foreign_amt', 5);
          instAmt5 = sumN('inst_amt', 5);
          foreignStreak = 0;
          for (const r of flowRows) {
            if (r.foreign_amt != null && Number(r.foreign_amt) > 0) foreignStreak++;
            else break;
          }
        }

        activeByTicker.set(s.ticker, Boolean(s.is_active));
        rows.push({
          ticker: s.ticker,
          name: s.name,
          market: s.market,
          sector: s.sector,
          basePrice,
          nowPrice,
          ret: Math.round(((nowPrice - basePrice) / basePrice) * 10000) / 100,
          score: combinePitFactors(pitFactors),
          factors: pitFactors,
          per: per != null ? Math.round(per * 100) / 100 : null,
          opMargin: rev != null && rev > 0 && op != null ? (op / rev) * 100 : null,
          revGrowth: f?.revenue_growth != null ? Number(f.revenue_growth) * 100 : null,
          divYield: f?.div_yield != null ? Number(f.div_yield) * 100 : null,
          marketCapT: s.market_cap != null ? Number(s.market_cap) * (basePrice / nowPrice) : null,
          aboveMa20: ma20 != null ? basePrice > ma20 : null,
          goldenCross: ma20 != null && ma60 != null ? ma20 > ma60 : null,
          rsi: calcRSI(closes.slice(0, 15).reverse()),
          pct52w: high > 0 ? ((basePrice - high) / high) * 100 : null,
          volRatio: vol20 > 0 ? avgArr(vols.slice(0, 5)) / vol20 : null,
          foreignAmt5,
          instAmt5,
          foreignStreak,
          aboveMa150: trendMa.ma150 != null ? basePrice > trendMa.ma150 : null,
          aboveMa200: trendMa.ma200 != null ? basePrice > trendMa.ma200 : null,
          ma150AboveMa200: trendMa.ma150 != null && trendMa.ma200 != null ? trendMa.ma150 > trendMa.ma200 : null,
          ma200Up: trendMa.ma200Up,
          pctFrom52wLow: trendMa.pctFrom52wLow,
          rsPercentile: null, // 아래에서 크로스섹션 계산 후 병합
        });
      }),
    );
  }

  if (rows.length < 50) throw new Error(`시점 데이터가 부족합니다 (${rows.length}종목).`);

  const delistedCount = [...activeByTicker.values()].filter((active) => !active).length;

  // RS 백분위 — 유니버스 전체 모멘텀 수익률 순위 → 0~100 (실시간 지표 계산과 동일한 순수함수 사용)
  const rsInputs: RsInput[] = [...momentumByTicker.entries()].map(([ticker, ret]) => ({ ticker, ret }));
  const rsResults = calcRsPercentile(rsInputs);
  const rsByTicker = new Map(rsResults.map((r) => [r.ticker, r.rsPercentile]));
  const rowsWithRs = rows.map((r) => ({ ...r, rsPercentile: rsByTicker.get(r.ticker) ?? null }));

  return { baseDate, latestDate, rows: rowsWithRs, delistedCount };
}

/** 전략 조건 매칭 (수급 키는 호출 전에 제거돼 있어야 함) */
export function matchesCriteria(r: PitRow, c: Record<string, any>): boolean {
  if (c.market && r.market !== c.market) return false;
  if (c.minScore != null && !(r.score >= Number(c.minScore))) return false;
  if (c.maxPer != null && !(r.per != null && r.per > 0 && r.per <= Number(c.maxPer))) return false;
  if (c.minOpMargin != null && !(r.opMargin != null && r.opMargin >= Number(c.minOpMargin))) return false;
  if (c.minRevenueGrowth != null && !(r.revGrowth != null && r.revGrowth >= Number(c.minRevenueGrowth))) return false;
  if (c.minDivYield != null && !(r.divYield != null && r.divYield >= Number(c.minDivYield))) return false;
  if (c.minMarketCap != null && !(r.marketCapT != null && r.marketCapT >= Number(c.minMarketCap))) return false;
  if (c.goldenCross === true && r.goldenCross !== true) return false;
  if (c.aboveMa20 === true && r.aboveMa20 !== true) return false;
  if (c.maxPctFrom52wHigh != null && !(r.pct52w != null && r.pct52w >= -Math.abs(Number(c.maxPctFrom52wHigh)))) return false;
  if (c.rsiMin != null && !(r.rsi != null && r.rsi >= Number(c.rsiMin))) return false;
  if (c.rsiMax != null && !(r.rsi != null && r.rsi <= Number(c.rsiMax))) return false;
  if (c.minVolRatio != null && !(r.volRatio != null && r.volRatio >= Number(c.minVolRatio))) return false;
  // 수급 조건 (기준일 시점 이력이 있을 때만 — 호출부에서 커버리지 게이트)
  if (c.foreignNetBuy5d === true && !(r.foreignAmt5 != null && r.foreignAmt5 > 0)) return false;
  if (c.instNetBuy5d === true && !(r.instAmt5 != null && r.instAmt5 > 0)) return false;
  if (c.minForeignStreak != null && !(r.foreignStreak != null && r.foreignStreak >= Number(c.minForeignStreak))) return false;
  // 추세 지표 확장 — 봉 부족으로 null인 종목은 자연히 미매칭 처리(기존 aboveMa20 패턴과 동일)
  if (c.aboveMa150 === true && r.aboveMa150 !== true) return false;
  if (c.aboveMa200 === true && r.aboveMa200 !== true) return false;
  if (c.ma150AboveMa200 === true && r.ma150AboveMa200 !== true) return false;
  if (c.ma200Up === true && r.ma200Up !== true) return false;
  if (c.minPctFrom52wLow != null && !(r.pctFrom52wLow != null && r.pctFrom52wLow >= Number(c.minPctFrom52wLow))) return false;
  if (c.minRsPercentile != null && !(r.rsPercentile != null && r.rsPercentile >= Number(c.minRsPercentile))) return false;
  return true;
}

/** 데이터 기반 전략 후보 라이브러리 (전부 PIT 검증 가능한 조건만) */
export const CANDIDATE_STRATEGIES: Array<{ key: string; name: string; desc: string; criteria: Record<string, any> }> = [
  { key: 'value_margin',    name: '저PER × 고마진',       desc: 'tPER 8배 이하 + 영업이익률 10% 이상',            criteria: { maxPer: 8, minOpMargin: 10 } },
  { key: 'value_growth',    name: '저PER × 성장',         desc: 'tPER 10배 이하 + 매출성장 10% 이상',             criteria: { maxPer: 10, minRevenueGrowth: 10 } },
  { key: 'growth_margin',   name: '고성장 × 고마진',      desc: '매출성장 20% 이상 + 영업이익률 10% 이상',        criteria: { minRevenueGrowth: 20, minOpMargin: 10 } },
  { key: 'value_div',       name: '저PER × 배당',         desc: 'tPER 8배 이하 + 배당수익률 3% 이상',             criteria: { maxPer: 8, minDivYield: 3 } },
  { key: 'trend',           name: '정배열 추세',          desc: 'MA20>MA60 + 주가>MA20',                          criteria: { goldenCross: true, aboveMa20: true } },
  { key: 'near_high',       name: '신고가 근접 모멘텀',   desc: '고점 대비 -10% 이내',                            criteria: { maxPctFrom52wHigh: 10 } },
  { key: 'pullback',        name: '정배열 눌림목',        desc: 'MA20>MA60 + RSI 35~50',                          criteria: { goldenCross: true, rsiMin: 35, rsiMax: 50 } },
  { key: 'score_top',       name: '점수 상위',            desc: '종합점수 70점 이상',                             criteria: { minScore: 70 } },
  { key: 'score_trend',     name: '점수 × 추세',          desc: '종합점수 65점 이상 + 주가>MA20',                 criteria: { minScore: 65, aboveMa20: true } },
  { key: 'value_rsi',       name: '저평가 반등 초입',     desc: 'tPER 8배 이하 + RSI 40~60',                      criteria: { maxPer: 8, rsiMin: 40, rsiMax: 60 } },
  { key: 'large_quality',   name: '대형 우량',            desc: '시총 1조 이상 + 영업이익률 8% 이상',             criteria: { minMarketCap: 1_000_000_000_000, minOpMargin: 8 } },
  { key: 'margin_trend',    name: '고마진 × 추세',        desc: '영업이익률 15% 이상 + 주가>MA20',                criteria: { minOpMargin: 15, aboveMa20: true } },
  { key: 'volume_break',    name: '거래량 급증 추세',     desc: '거래량 1.5배 이상 + 주가>MA20',                  criteria: { minVolRatio: 1.5, aboveMa20: true } },
  { key: 'growth_score',    name: '성장 × 점수',          desc: '매출성장 15% 이상 + 종합점수 60점 이상',         criteria: { minRevenueGrowth: 15, minScore: 60 } },
  { key: 'deep_value',      name: '초저평가',             desc: 'tPER 6배 이하 (일회성 이익 자동 감점 반영)',     criteria: { maxPer: 6 } },
];

export interface StrategyEvalItem {
  id: string | null;         // 프리셋 id (후보는 null)
  key?: string;              // 후보 키
  name: string;
  desc?: string;
  criteria: Record<string, any>;
  count: number;
  avgRet: number;
  winRate: number;
  excess: number;            // vs 유니버스 평균
  skipped: string[];         // 검증에서 제외된 수급 조건
}

export interface StrategyEvalResult {
  baseDate: string;
  latestDate: string;
  universe: number;
  universeAvg: number;
  presets: StrategyEvalItem[];
  candidates: StrategyEvalItem[];
  delistedCount: number;      // universe 중 is_active=FALSE 종목 수 — 생존편향 크기 계량
}

export async function evaluateStrategies(monthsAgo: number): Promise<StrategyEvalResult> {
  const db = getDb();
  const { baseDate, latestDate, rows, delistedCount } = await buildPitDataset(monthsAgo);

  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const universeAvg = Math.round(avg(rows.map((r) => r.ret)) * 100) / 100;

  // 기준일 시점 수급 커버리지가 충분하면(30%+) 수급 조건도 검증에 포함
  const flowCoverage = rows.filter((r) => r.foreignAmt5 != null).length / rows.length;
  const flowsUsable = flowCoverage >= 0.3;

  const evalCriteria = (criteria: Record<string, any>): { count: number; avgRet: number; winRate: number; excess: number; skipped: string[] } => {
    const skipped = flowsUsable ? [] : FLOW_KEYS.filter((k) => criteria[k] != null);
    const c = { ...criteria };
    for (const k of skipped) delete c[k];
    const hits = rows.filter((r) => matchesCriteria(r, c));
    if (hits.length === 0) return { count: 0, avgRet: 0, winRate: 0, excess: 0, skipped: [...skipped] };
    const rets = hits.map((h) => h.ret);
    const a = avg(rets);
    return {
      count: hits.length,
      avgRet: Math.round(a * 100) / 100,
      winRate: Math.round((rets.filter((v) => v > 0).length / rets.length) * 1000) / 10,
      excess: Math.round((a - universeAvg) * 100) / 100,
      skipped: [...skipped],
    };
  };

  const { rows: presetRows } = await db.query(
    'SELECT id, name, description, criteria FROM screener_presets ORDER BY is_builtin DESC, created_at',
  );
  const presets: StrategyEvalItem[] = presetRows.map((p: any) => {
    const criteria = typeof p.criteria === 'string' ? JSON.parse(p.criteria) : (p.criteria ?? {});
    return { id: p.id, name: p.name, desc: p.description, criteria, ...evalCriteria(criteria) };
  }).sort((a: StrategyEvalItem, b: StrategyEvalItem) => b.excess - a.excess);

  const candidates: StrategyEvalItem[] = CANDIDATE_STRATEGIES
    .map((cand) => ({ id: null, key: cand.key, name: cand.name, desc: cand.desc, criteria: cand.criteria, ...evalCriteria(cand.criteria) }))
    .filter((c) => c.count >= 15)
    .sort((a, b) => b.excess - a.excess);

  return { baseDate, latestDate, universe: rows.length, universeAvg, presets, candidates, delistedCount };
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
