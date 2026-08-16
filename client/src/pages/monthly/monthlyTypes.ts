/** 월간 상승률 — 서버 응답 모양. `market/monthly.routes.ts`와 짝을 이룬다. */

/** 매트릭스의 행을 무엇으로 묶는가 — 테마(다대다) 또는 산업(일대다). */
export type Axis = 'theme' | 'sector';

export const AXIS_LABEL: Record<Axis, string> = { theme: '테마', sector: '산업' };

export interface GroupCell {
  /** 멤버 수익률의 중앙값(소수). 정렬 기준. */
  median: number;
  /** 동일가중 평균(소수). 중앙값과 벌어지면 쏠림 신호. */
  mean: number;
  /** 오른 종목 비율(0~1). */
  upRatio: number;
  /** 그 달 수익률을 가진 멤버 수. */
  count: number;
}

export interface GroupRow {
  /** 테마는 테마번호 문자열, 산업은 산업명. */
  key: string;
  name: string;
  memberCount: number;
  /** 달(`YYYY-MM`) → 값. 값이 없는 달은 키가 없다. */
  cells: Record<string, GroupCell>;
}

export interface MonthlyGroupsResponse {
  axis: Axis;
  startMonth: string;
  /** 시세의 마지막 거래일(`YYYY-MM-DD`). */
  asOf: string;
  months: string[];
  /** 아직 끝나지 않은 달. 없으면 null. */
  partialMonth: string | null;
  /** 달 → 기업 액션 미반영으로 제외한 종목 수. */
  excludedByMonth: Record<string, number>;
  rows: GroupRow[];
}

export interface StockRow {
  ticker: string;
  name: string;
  market: string | null;
  marketCap: number | null;
  sector: string | null;
  /** 그 달 수익률(소수). */
  changePct: number;
}

export interface MonthlyStocksResponse {
  month: string;
  asOf: string;
  isPartial: boolean;
  excluded: number;
  total: number;
  items: StockRow[];
}

export interface GroupMemberRow {
  ticker: string;
  name: string;
  market: string | null;
  marketCap: number | null;
  cells: Record<string, number>;
}

export interface GroupDetailResponse {
  axis: Axis;
  key: string;
  name: string;
  months: string[];
  partialMonth: string | null;
  asOf: string;
  items: GroupMemberRow[];
}

/** `2026-07` → `26.07` — 열이 여덟 개를 넘어가므로 폭을 아낀다. */
export function monthLabel(ym: string): string {
  return `${ym.slice(2, 4)}.${ym.slice(5, 7)}`;
}

export function fmtEok(won: number | null): string {
  if (won == null) return '—';
  const eok = won / 1e8;
  if (Math.abs(eok) >= 10000) return `${(eok / 10000).toFixed(1)}조`;
  return `${Math.round(eok).toLocaleString()}억`;
}

// %·색조 표기는 산업 실적 전망의 산업 비교 표와 공유한다 — 같은 숫자가 화면마다
// 다른 색으로 보이지 않도록.
export { fmtPct, heatStyle, pctColorClass } from '../../shared/lib/pctFormat';
