import { AlgorithmEngine, AlgorithmMeta, StockData, MarketContext, EngineScore, delta } from './base/AlgorithmEngine';
import { getDb } from '../../config/database';

// — 수급(외인·기관 매매동향) 팩터. 초기 가중치는 0(algorithm_configs 시드,
// 마이그 034)으로 등록해 breakdown·score_history에는 기록되지만 총점에는 기여하지 않는다.
// 백테스트로 유효성이 검증되면 절차로 가중치를 올린다.

const DUAL_INFLOW_BONUS = 12;    // 외인·기관 쌍끌이(5·20일 모두 순매수)
const SINGLE_INFLOW_BONUS = 6;   // 외인 또는 기관 단독 순매수(5·20일)
const STREAK_MIN_DAYS = 5;       // 연속 순매수 인정 최소 일수
const STREAK_SINGLE_BONUS = 5;   // 외인 또는 기관 중 한쪽만 연속 순매수 충족
const STREAK_BOTH_BONUS = 8;     // 외인·기관 둘 다 연속 순매수 충족
const OBV_UPTREND_VALUE = 1;     // stock_indicators.obv_trend: -1(하락)/0(보합)/1(상승)
const OBV_UPTREND_BONUS = 4;
const DUAL_OUTFLOW_PENALTY = -8; // 외인·기관 동반 이탈(5일 모두 순매도)

/** stock_indicators에서 수급 팩터가 읽는 컬럼 (1행) */
export interface FlowIndicatorRow {
  foreign_amt_5d: number | string | null;
  foreign_amt_20d: number | string | null;
  inst_amt_5d: number | string | null;
  inst_amt_20d: number | string | null;
  foreign_buy_streak: number | string | null;
  inst_buy_streak: number | string | null;
  obv_trend: number | string | null;
}

function toNum(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 순수 계산: stock_indicators 1행(수급 금액·연속일수·OBV 추세)으로부터 수급 점수 산출.
 * 관련 컬럼이 전부 null이면(수급 데이터 미수집 종목) 50점 중립 + dataMissing 처리.
 */
export function scoreFlow(indicators?: FlowIndicatorRow | null): EngineScore {
  const foreignAmt5d = toNum(indicators?.foreign_amt_5d);
  const foreignAmt20d = toNum(indicators?.foreign_amt_20d);
  const instAmt5d = toNum(indicators?.inst_amt_5d);
  const instAmt20d = toNum(indicators?.inst_amt_20d);
  const foreignStreak = toNum(indicators?.foreign_buy_streak);
  const instStreak = toNum(indicators?.inst_buy_streak);
  const obvTrend = toNum(indicators?.obv_trend);

  const allMissing = [foreignAmt5d, foreignAmt20d, instAmt5d, instAmt20d, foreignStreak, instStreak, obvTrend]
    .every((v) => v === null);
  if (allMissing) {
    return { score: 50, reasons: ['수급 데이터 없음 — 중립(50점) 처리'], dataMissing: true };
  }

  let score = 50;
  const reasons: string[] = [];

  // 쌍끌이/편측 순매수 (5·20일 모두 양수 — 단기 노이즈가 아닌 지속적 매수 우위)
  const foreignInflow = foreignAmt5d != null && foreignAmt20d != null && foreignAmt5d > 0 && foreignAmt20d > 0;
  const instInflow = instAmt5d != null && instAmt20d != null && instAmt5d > 0 && instAmt20d > 0;
  if (foreignInflow && instInflow) {
    score += DUAL_INFLOW_BONUS;
    reasons.push(`외인·기관 쌍끌이 매수 (5·20일 모두 순매수)${delta(DUAL_INFLOW_BONUS)}`);
  } else if (foreignInflow) {
    score += SINGLE_INFLOW_BONUS;
    reasons.push(`외인 매수 우위 (5·20일 순매수, 기관 미동반)${delta(SINGLE_INFLOW_BONUS)}`);
  } else if (instInflow) {
    score += SINGLE_INFLOW_BONUS;
    reasons.push(`기관 매수 우위 (5·20일 순매수, 외인 미동반)${delta(SINGLE_INFLOW_BONUS)}`);
  }

  // 연속 순매수 일수 (streak)
  const foreignStreakOk = foreignStreak != null && foreignStreak >= STREAK_MIN_DAYS;
  const instStreakOk = instStreak != null && instStreak >= STREAK_MIN_DAYS;
  if (foreignStreakOk && instStreakOk) {
    score += STREAK_BOTH_BONUS;
    reasons.push(
      `외인·기관 동시 연속 순매수 ${STREAK_MIN_DAYS}일 이상 (외인 ${foreignStreak}일·기관 ${instStreak}일)${delta(STREAK_BOTH_BONUS)}`,
    );
  } else if (foreignStreakOk) {
    score += STREAK_SINGLE_BONUS;
    reasons.push(`외인 연속 순매수 ${foreignStreak}일 (${STREAK_MIN_DAYS}일 이상)${delta(STREAK_SINGLE_BONUS)}`);
  } else if (instStreakOk) {
    score += STREAK_SINGLE_BONUS;
    reasons.push(`기관 연속 순매수 ${instStreak}일 (${STREAK_MIN_DAYS}일 이상)${delta(STREAK_SINGLE_BONUS)}`);
  }

  // OBV 추세 (거래량 동반 매집/이탈 신호)
  if (obvTrend != null && obvTrend >= OBV_UPTREND_VALUE) {
    score += OBV_UPTREND_BONUS;
    reasons.push(`OBV 상승 추세 — 거래량 동반 매집 신호${delta(OBV_UPTREND_BONUS)}`);
  }

  // 동반 이탈 (5일 모두 순매도 — 쌍끌이의 반대 극단)
  if (foreignAmt5d != null && instAmt5d != null && foreignAmt5d < 0 && instAmt5d < 0) {
    score += DUAL_OUTFLOW_PENALTY;
    reasons.push(`외인·기관 동반 이탈 (5일 모두 순매도)${delta(DUAL_OUTFLOW_PENALTY)}`);
  }

  if (reasons.length === 0) {
    reasons.push('수급 중립 — 뚜렷한 매수/매도 우위 없음');
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export class FlowEngine extends AlgorithmEngine {
  readonly meta: AlgorithmMeta = {
    id: 'flow_v1',
    name: '수급',
    version: '1.0',
    category: 'flow',
    description: '외인·기관 5·20일 순매수, 연속 순매수 일수, OBV 추세 기반 수급 팩터 (검증 중 — 가중치 0)',
    enabled: true,
    weight: 0,
    params: {},
  };

  async calculate(stock: StockData, _ctx: MarketContext): Promise<EngineScore> {
    try {
      const { rows } = await getDb().query(
        `SELECT foreign_amt_5d, foreign_amt_20d, inst_amt_5d, inst_amt_20d,
                foreign_buy_streak, inst_buy_streak, obv_trend
         FROM stock_indicators WHERE ticker = $1`,
        [stock.ticker],
      );
      return scoreFlow((rows[0] as FlowIndicatorRow) ?? null);
    } catch {
      return { score: 50, reasons: ['수급 데이터 조회 실패 — 중립 처리'], dataMissing: true };
    }
  }
}
