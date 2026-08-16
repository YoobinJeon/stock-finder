/** 종목 비교 페이지 — 값 변환·포맷 헬퍼 (StockDetailPanel.parseBreakdown과 동일 로직) */

export interface EngineResult {
  id: string;
  name: string;
  category: string;
  weight: number;
  score: number;
  reasons?: string[];
}

export interface CompareRow {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
  market_cap: number | string | null;
  total_score: number | string | null;
  breakdown: EngineResult[] | string | null;
  fiscal_year: number | null;
  revenue: number | string | null;
  operating_income: number | string | null;
  net_income: number | string | null;
  per: number | string | null;
  pbr: number | string | null;
  roe: number | string | null;
  debt_ratio: number | string | null;
  div_yield: number | string | null;
  revenue_growth: number | string | null;
  eps_growth: number | string | null;
  ev_ebitda: number | string | null;
  est_fiscal_year: number | null;
  forward_per: number | string | null;
  est_revenue: number | string | null;
  est_operating_income: number | string | null;
  last_close: number | string | null;
  rsi14: number | string | null;
  pct_from_52w_high: number | string | null;
  vol_ratio: number | string | null;
  foreign_net_20d: number | string | null;
  inst_net_20d: number | string | null;
  foreign_hold_ratio: number | string | null;
  above_ma20: boolean | null;
  golden_cross: boolean | null;
}

/** null/''/undefined → null. 그 외 Number() 변환 실패 시에도 null (Number(null)=0 함정 방지). */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseBreakdown(raw: CompareRow['breakdown']): EngineResult[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return raw;
}

/** 원 단위 금액 → "1,809조" / "1,320억" */
export function fmtKrw(v: number | null): string {
  if (v == null || v === 0) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
  return `${Math.round(v / 1e8).toLocaleString('ko-KR')}억`;
}

/** PER류 — 음수는 '적자' (ScreenerPage.fmtPer와 동일 규칙) */
export function fmtPer(v: number | null): string {
  if (v == null) return '—';
  return v < 0 ? '적자' : v.toFixed(1);
}

export function fmtDecimal(v: number | null, digits = 2): string {
  return v == null ? '—' : v.toFixed(digits);
}

/** 소수(0.15=15%) → "15.0%" */
export function fmtPercent(v: number | null, digits = 1): string {
  return v == null ? '—' : `${(v * 100).toFixed(digits)}%`;
}

/** 이미 %값으로 저장된 필드(rsi14·pct_from_52w_high·foreign_hold_ratio) → "12.3%" */
export function fmtRawPercent(v: number | null, digits = 1): string {
  return v == null ? '—' : `${v.toFixed(digits)}%`;
}

export function fmtPrice(v: number | null): string {
  return v == null ? '—' : `${v.toLocaleString('ko-KR')}원`;
}

export function fmtRatio(v: number | null): string {
  return v == null ? '—' : `${v.toFixed(2)}배`;
}

/** 순매수 수량(주) → "+320만주" / "-1.2억주" */
export function fmtShares(v: number | null): string {
  if (v == null) return '—';
  const sign = v >= 0 ? '+' : '-';
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억주`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString('ko-KR')}만주`;
  return `${sign}${abs.toLocaleString('ko-KR')}주`;
}

/** 영업이익률 (%) — revenue > 0일 때만 */
export function opMargin(revenue: number | null, op: number | null): string {
  if (revenue == null || revenue <= 0 || op == null) return '—';
  return `${((op / revenue) * 100).toFixed(1)}%`;
}

/** 점수 배지 색 — 단일 소스(shared/lib/scoreGrade)로 위임, 기존 이름은 그대로 재노출 */
export { scoreColorClass as scoreBadgeClass } from '../../shared/lib/scoreGrade';

/** 점수 엔진 5종 표시 순서·라벨 (가치/퀄리티/성장성/모멘텀/신기술) — '밸류' 섹션(재무 지표)과는 별개 */
export const ENGINE_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'value',           label: '가치' },
  { key: 'quality',         label: '퀄리티' },
  { key: 'growth',          label: '성장성' },
  { key: 'momentum',        label: '모멘텀' },
  { key: 'tech_innovation', label: '신기술' },
];
