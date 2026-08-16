/**
 * 산업 실적 전망 — 서버 응답 모양. `market/sectorOutlook.routes.ts`와 짝을 이룬다.
 *
 * 축은 연간(`"2026"`)과 분기(`"2026Q2"`)를 **같은 문자열 키**로 다룬다 — 표·정렬·CSV는 축의
 * 정체를 몰라도 되고, 축을 정하는 일만 서버에서 두 갈래로 갈린다.
 */

export type PeriodType = 'year' | 'quarter';

/** 증가율의 기준 — 전년 동기 / 직전 분기. 연간 축에는 `yoy`(직전 연도 대비)뿐이다. */
export type GrowthBasis = 'yoy' | 'qoq';

/** 축의 한 눈금. */
export interface PeriodKey {
  key: string;
  year: number;
  /** 연간 축이면 null. */
  quarter: number | null;
}

export interface Delta {
  growth: number | null;
  /** 적자 → 흑자. 증가율이 null인 구간에서 개선을 가려내는 유일한 신호. */
  turnaround: boolean;
}

export interface Deltas {
  revenue: Delta;
  operatingIncome: Delta;
  netIncome: Delta;
}

export interface OutlookPeriod {
  key: string;
  year: number;
  quarter: number | null;
  isEstimate: boolean;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  /** 연간이면 직전 연도 대비, 분기면 전년 동기 대비. */
  yoy: Deltas;
  /** 분기 축에서만 채워진다. */
  qoq: Deltas | null;
  opMargin: number | null;
  /** 시총 ÷ 순이익(연간) 또는 시총 ÷ TTM 순이익(분기). */
  per: number | null;
  /** 시총 ÷ 영업이익(연간) 또는 시총 ÷ TTM 영업이익(분기). */
  por: number | null;
}

export interface OutlookItem {
  ticker: string;
  name: string;
  market: string | null;
  marketCap: number | null;
  totalScore: number | null;
  periods: Record<string, OutlookPeriod>;
  hasEstimate: boolean;
}

export interface OutlookResponse {
  sector: string;
  periodType: PeriodType;
  periods: PeriodKey[];
  basePeriod: string | null;
  /** 이 산업 재무의 마지막 적재 시각(ISO). 18:10 전체 수집이 갱신한다. */
  updatedAt: string | null;
  totalCount: number;
  coveredCount: number;
  items: OutlookItem[];
}

/** 화면에서 고르는 항목. */
export type MetricKey = 'revenue' | 'operatingIncome' | 'netIncome' | 'per' | 'por';

export interface MetricSpec {
  key: MetricKey;
  label: string;
  /** 여러 항목을 한 칸에 쌓을 때 붙이는 짧은 이름 — 칸이 좁아 전체 이름은 들어가지 않는다. */
  short: string;
  /**
   * 'amount' = 금액(억·조) + 증가율 두 줄.
   * 'multiple' = 배수 한 줄. 배수의 "증가율"은 뜻이 없어 두 번째 줄을 두지 않는다
   *   (싼 순으로 보려면 열 헤더를 한 번 더 눌러 오름차순으로 뒤집는다).
   */
  format: 'amount' | 'multiple';
  amountOf: (p: OutlookPeriod) => number | null;
  /** 배수 항목은 증가율이 없어 undefined. */
  pickDelta?: (d: Deltas) => Delta;
}

export const METRICS: readonly MetricSpec[] = [
  {
    key: 'revenue', short: '매출', label: '매출', format: 'amount',
    amountOf: (p) => p.revenue, pickDelta: (d) => d.revenue,
  },
  {
    key: 'operatingIncome', short: '영익', label: '영업이익', format: 'amount',
    amountOf: (p) => p.operatingIncome, pickDelta: (d) => d.operatingIncome,
  },
  {
    key: 'netIncome', short: '순익', label: '순이익', format: 'amount',
    amountOf: (p) => p.netIncome, pickDelta: (d) => d.netIncome,
  },
  {
    // 시총 ÷ 순이익(분기 축에서는 TTM 순이익). 전망 눈금이면 곧 fPER이다.
    key: 'per', short: 'PER', label: 'PER', format: 'multiple',
    amountOf: (p) => p.per,
  },
  {
    // PER과 분자(시총)가 같아 나란히 비교된다.
    key: 'por', short: 'POR', label: 'POR', format: 'multiple',
    amountOf: (p) => p.por,
  },
];

/**
 * 이 항목·이 눈금의 증가율. 배수 항목이거나 그 기준이 없는 축(연간의 QoQ)이면 null이다.
 */
export function deltaOf(
  spec: MetricSpec, period: OutlookPeriod, basis: GrowthBasis,
): Delta | null {
  if (!spec.pickDelta) return null;
  const deltas = basis === 'qoq' ? period.qoq : period.yoy;
  return deltas ? spec.pickDelta(deltas) : null;
}

/** 열 머리의 짧은 표기 — 연간은 `2026`, 분기는 `26Q2`(폭을 아끼려 두 자리 연도). */
export function periodLabel(period: PeriodKey): string {
  if (period.quarter == null) return String(period.year);
  return `${String(period.year).slice(2)}Q${period.quarter}`;
}

/** 한 눈금 열이 확정만인지, 전망만인지, 섞였는지. */
export type PeriodKind = 'actual' | 'estimate' | 'mixed';

/**
 * 열의 성격을 **실제 값에서** 판정한다.
 *
 * ⚠️ 열 위치로 A/E를 정하면 안 된다. 결산 시점이 다른 종목이 섞이면 같은 눈금이라도 어떤 종목은
 * 확정, 어떤 종목은 전망이다. 위치로 라벨을 붙였다가 **전망치를 확정 실적으로 읽히게** 만든
 * 사고가 있었다(2026-08-11 레드팀). 섞인 열은 헤더에 단정을 짓지 않고 칸마다 표시한다.
 */
export function periodKindOf(items: readonly OutlookItem[], key: string): PeriodKind | null {
  let hasActual = false;
  let hasEstimate = false;
  for (const item of items) {
    const cell = item.periods[key];
    if (!cell) continue;
    if (cell.isEstimate) hasEstimate = true;
    else hasActual = true;
    if (hasActual && hasEstimate) return 'mixed';
  }
  if (!hasActual && !hasEstimate) return null;
  return hasActual ? 'actual' : 'estimate';
}

/** 열 머리 전체 표기 — `26Q1A` / `2026E` / 혼재면 표기 없이 눈금만. */
export function periodHeaderLabel(period: PeriodKey, kind: PeriodKind | null): string {
  const base = periodLabel(period);
  if (kind === 'actual') return `${base}A`;
  if (kind === 'estimate') return `${base}E`;
  return base;
}
