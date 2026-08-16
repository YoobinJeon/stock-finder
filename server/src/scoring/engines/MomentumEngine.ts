import { AlgorithmEngine, AlgorithmMeta, StockData, MarketContext, EngineScore, delta } from './base/AlgorithmEngine';
import { getDb } from '../../config/database';

// v3: 절대수익률 사다리는 1M/3M만 유지(6M/12M 제거) — 그 역할은 크로스섹션 RS 백분위가 대체한다
// (이중계상 방지). rs_percentile이 없는 종목(신규 상장 등)에는 v2 4구간 사다리로 폴백한다.
const PERIODS_V3: Array<{ label: string; days: number; maxBonus: number }> = [
  { label: '1개월', days: 21, maxBonus: 10 },
  { label: '3개월', days: 63, maxBonus: 10 },
];

const PERIODS_V2_FALLBACK: Array<{ label: string; days: number; maxBonus: number }> = [
  { label: '1개월',  days: 21,  maxBonus: 15 },
  { label: '3개월',  days: 63,  maxBonus: 15 },
  { label: '6개월',  days: 126, maxBonus: 10 },
  { label: '12개월', days: 252, maxBonus: 10 },
];

// RS 백분위 보너스 구간(내림차순 — 첫 매치 적용) + 하위권 페널티. 상수화.
const RS_BONUS_TIERS: ReadonlyArray<{ min: number; bonus: number; label: string }> = [
  { min: 90, bonus: 15, label: 'RS 상위 10%' },
  { min: 80, bonus: 10, label: 'RS 상위 20%' },
  { min: 70, bonus: 5,  label: 'RS 상위 30%' },
];
const RS_WEAK_MAX = 30;   // 이 이하면 약세 페널티
const RS_WEAK_PENALTY = -8;

const TURNOVER_SURGE_MIN = 3;     // 20일 평균 거래대금 대비 배수 임계치
const TURNOVER_SURGE_BONUS = 5;
const TURNOVER_LOOKBACK_DAYS = 20; // "최근 상승" 판정에 쓰는 과거 종가 오프셋

/** stock_prices에서 모멘텀 팩터가 읽는 컬럼 (trade_date DESC, 최대 260일) */
export interface MomentumFinRow {
  close: number | string | null;
}

/** stock_indicators에서 모멘텀 v3가 읽는 컬럼 (rs_percentile·turnover_surge 1행) */
export interface MomentumIndicatorRow {
  rs_percentile: number | string | null;
  turnover_surge: number | string | null;
}

/** 수익률을 ±maxBonus 범위로 매핑 */
function retScore(ret: number, maxBonus: number): number {
  return Math.min(maxBonus, Math.max(-maxBonus, ret * (maxBonus / 15)));
}

/** RS 백분위 → 점수 가감 + 근거 라벨 (구간 밖은 중립 0) */
function scoreRsPercentile(rs: number): { bonus: number; label: string } {
  const tier = RS_BONUS_TIERS.find((t) => rs >= t.min);
  if (tier) return { bonus: tier.bonus, label: tier.label };
  if (rs <= RS_WEAK_MAX) return { bonus: RS_WEAK_PENALTY, label: 'RS 하위 30% 이하 — 약세' };
  return { bonus: 0, label: '중립' };
}

function calcRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const rs = losses === 0 ? 100 : gains / losses;
  return 100 - 100 / (1 + rs);
}

/**
 * 순수 계산: 이미 조회된 종가 rows(trade_date DESC, 최신이 먼저) + stock_indicators 1행(rs_percentile·
 * turnover_surge)으로부터 모멘텀 점수 산출. indicators가 없거나 rs_percentile이 null이면(신규 상장 등
 * 크로스섹션 RS 미산정) v2 4구간 절대수익률 사다리로 폴백한다 — dataMissing은 아니다(시세 자체는 있음).
 */
export function scoreMomentum(rows: MomentumFinRow[], indicators?: MomentumIndicatorRow | null): EngineScore {
  if (rows.length < 20) {
    return { score: 50, reasons: [`시세 데이터 부족 (${rows.length}일) — 중립(50점) 처리`], dataMissing: true };
  }

  const prices = rows.map((r) => Number(r.close));
  let score = 50;
  const reasons: string[] = [];

  const rsPercentile = indicators?.rs_percentile != null ? Number(indicators.rs_percentile) : null;
  const periods = rsPercentile != null ? PERIODS_V3 : PERIODS_V2_FALLBACK;

  // 기간별 수익률 (1년치 일봉은 ~250개라 최장 기간은 보유분의 95% 이상이면 가장 오래된 종가로 대체)
  for (const { label, days, maxBonus } of periods) {
    let idx: number;
    if (rows.length > days) idx = days;
    else if (rows.length >= Math.floor(days * 0.95)) idx = rows.length - 1;
    else continue;
    const ret = ((prices[0] - prices[idx]) / prices[idx]) * 100;
    const d = Math.round(retScore(ret, maxBonus));
    score += d;
    reasons.push(`${label} 수익률 ${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%${delta(d)}`);
  }

  // 크로스섹션 RS 백분위 (전 종목 대비 상대강도 — rsRanking.ts 산식, ingest.ts가 stock_indicators에 저장)
  if (rsPercentile != null) {
    const rsResult = scoreRsPercentile(rsPercentile);
    score += rsResult.bonus;
    reasons.push(`RS 백분위 ${rsPercentile.toFixed(0)} — ${rsResult.label}${delta(rsResult.bonus)}`);
  }

  // 거래대금급증 + 상승 동반 (오닐식 브레이크아웃 근사: 급증만으로는 하락에도 걸리므로 상승을 함께 요구)
  const turnoverSurge = indicators?.turnover_surge != null ? Number(indicators.turnover_surge) : null;
  if (turnoverSurge != null && turnoverSurge >= TURNOVER_SURGE_MIN) {
    const priorClose = prices.length > TURNOVER_LOOKBACK_DAYS ? prices[TURNOVER_LOOKBACK_DAYS] : null;
    if (priorClose != null && prices[0] > priorClose) {
      score += TURNOVER_SURGE_BONUS;
      reasons.push(`거래대금급증 ${turnoverSurge.toFixed(1)}배 & 20일 전 대비 상승${delta(TURNOVER_SURGE_BONUS)}`);
    }
  }

  // RSI(14): 40~65 적정 매집 구간
  const rsi = calcRSI(prices.slice(0, 15).reverse());
  let rsiDelta = 0;
  let rsiLabel = '중립';
  if (rsi >= 40 && rsi <= 65) { rsiDelta = 8;   rsiLabel = '적정 매집 구간'; }
  else if (rsi > 70)          { rsiDelta = -10; rsiLabel = '과매수 주의'; }
  else if (rsi < 30)          { rsiDelta = -8;  rsiLabel = '과매도'; }
  score += rsiDelta;
  reasons.push(`RSI(14) ${rsi.toFixed(0)} — ${rsiLabel}${delta(rsiDelta)}`);

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export class MomentumEngine extends AlgorithmEngine {
  readonly meta: AlgorithmMeta = {
    id: 'momentum_v1',
    name: '모멘텀 팩터',
    version: '3.0',
    category: 'momentum',
    description: '단기 수익률(1M/3M)·RSI·크로스섹션 RS 백분위·거래대금급증 기반 모멘텀',
    enabled: true,
    weight: 0.15,
    params: { w1m: 0.20, w3m: 0.30, w6m: 0.30, w12m: 0.20 },
  };

  async calculate(stock: StockData, _ctx: MarketContext): Promise<EngineScore> {
    try {
      const db = getDb();
      const [{ rows }, { rows: indicatorRows }] = await Promise.all([
        db.query(
          `SELECT close FROM stock_prices
           WHERE ticker = $1
           ORDER BY trade_date DESC LIMIT 260`,
          [stock.ticker],
        ),
        db.query(
          `SELECT rs_percentile, turnover_surge FROM stock_indicators WHERE ticker = $1`,
          [stock.ticker],
        ),
      ]);
      return scoreMomentum(rows as MomentumFinRow[], (indicatorRows[0] as MomentumIndicatorRow) ?? null);
    } catch {
      return { score: 50, reasons: ['시세 데이터 조회 실패 — 중립 처리'], dataMissing: true };
    }
  }
}
