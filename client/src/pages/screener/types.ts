/**
 * 스크리너 응답·필터 상태 타입.
 * (2026-07-26 ScreenerPage.tsx 분할 — 800줄 규칙. 로직은 그대로 옮겼다.)
 */

export interface EngineResult {
  id: string;
  name: string;
  category: string;
  weight: number;
  score: number;
  /** 'coverage_info' 행에만 존재 — 데이터 확보 엔진 수 / 전체 엔진 수 */
  coverage?: { available: number; total: number };
}

export interface ScreenerResult {
  ticker: string;
  name: string;
  market: string;
  sector: string;
  market_cap: number | string | null;
  total_score: number | null;
  /** 모멘텀·수급(flow) 재정규화 서브점수 —, flow 미포함 과거 점수는 모멘텀 단독 */
  discovery_score: number | null;
  breakdown: EngineResult[] | null;
  fin_year: number | null;
  revenue: number | string | null;
  operating_income: number | string | null;
  trailing_per: number | string | null;
  est_year: number | null;
  est_revenue: number | string | null;
  est_operating_income: number | string | null;
  forward_per: number | string | null;
  foreign_amt_5d: number | string | null;
  inst_amt_5d: number | string | null;
  last_close: number | string | null;
  day_change: number | string | null;
  pct_from_52w_high: number | string | null;
  // 분기 실적 개선 (스크리너 실적 개선 필터) — 판정 기준이 된 최신 확정 분기와 그 결과
  trend_year: number | null;
  trend_quarter: number | null;
  /** 기준 분기의 금액 (분기 단독 — 위의 revenue/operating_income은 연간 확정치라 별개) */
  trend_revenue: number | string | null;
  trend_operating_income: number | string | null;
  /** 비교 대상 분기의 금액 — "어디서 어디로" 갔는지 보이게 한다 */
  yoy_prev_revenue: number | string | null;
  yoy_prev_operating_income: number | string | null;
  qoq_prev_revenue: number | string | null;
  qoq_prev_operating_income: number | string | null;
  revenue_yoy: number | string | null;
  op_yoy: number | string | null;
  op_yoy_turnaround: boolean | null;
  yoy_improving: boolean | null;
  revenue_qoq: number | string | null;
  op_qoq: number | string | null;
  op_qoq_turnaround: boolean | null;
  qoq_improving: boolean | null;
  est_yoy_improving: boolean | null;
  est_qoq_improving: boolean | null;
  // 연속 개선 분기 수 + 다음 분기 컨센서스 전망
  yoy_streak: number | null;
  qoq_streak: number | null;
  // eq_* = 분기 컨센서스 (위의 est_*는 연간 가이던스로 이미 쓰이는 이름이라 접두어를 나눴다)
  eq_year: number | null;
  eq_quarter: number | null;
  eq_revenue: number | string | null;
  eq_operating_income: number | string | null;
  eq_revenue_yoy: number | string | null;
  eq_op_yoy: number | string | null;
  eq_op_yoy_turnaround: boolean | null;
  eq_revenue_qoq: number | string | null;
  eq_op_qoq: number | string | null;
  eq_op_qoq_turnaround: boolean | null;
  eq_yoy_prev_revenue: number | string | null;
  eq_yoy_prev_operating_income: number | string | null;
  eq_qoq_prev_revenue: number | string | null;
  eq_qoq_prev_operating_income: number | string | null;
}

/** 실적 개선 필터 모드 — '' = 안 봄 */
export type EarningsTrendMode = '' | 'yoy' | 'qoq' | 'both';

export interface FilterState {
  market: string;
  sector: string;
  minScore: number;
  maxPer: string;            // '' = 미적용
  minOpMargin: string;
  minRevenueGrowth: string;
  minDivYield: string;
  minMarketCapEok: string;   // 억 단위 입력
  // 분기 실적 개선 조건
  earningsTrend: EarningsTrendMode;
  minEarningsGrowth: string; // '' = 0% 초과(개선이기만 하면 통과)
  minEarningsStreak: string; // YoY 연속 개선 분기 수 하한
  estImproving: boolean;     // 다음 분기 컨센서스도 개선
  // 수급·기술 조건 (전략 적용 시 세팅)
  foreignNetBuy5d: boolean;
  instNetBuy5d: boolean;
  minForeignStreak: string;
  goldenCross: boolean;
  aboveMa20: boolean;
  earlyTrend: boolean;
  maxPctFrom52wHigh: string;
  rsiMin: string;
  rsiMax: string;
  minVolRatio: string;
  // 추세 지표 확장 (전략 적용 시 세팅 — 거장 전략 정밀화)
  aboveMa150: boolean;
  aboveMa200: boolean;
  ma150AboveMa200: boolean;
  ma200Up: boolean;
  minPctFrom52wLow: string;
  minRsPercentile: string;
  q: string;               // 종목명/코드 검색
  sort: string;
  order: 'asc' | 'desc';
  page: number;
}
