/**
 * 산업 실적 전망 — **산업들을 나란히** 놓는 축.
 *
 * 종목 표는 산업 하나의 기업들을 세로로 세우지만, 이 모듈은 한 단 위에서 **산업이 행, 기간이 열**인
 * 매트릭스를 만든다. "내년 매출이 가장 많이 늘 산업은 어디인가"는 종목 표로는 대답할 수 없는
 * 질문이다.
 *
 * ⚠️ **산업 합계는 여기서도 만들지 않는다**(2026-08-11 결정 유지). 애널리스트 커버리지가 산업의
 * 절반 수준이라 합계는 "몇 개가 커버됐는가"에 좌우된다. 대신 **커버된 기업들의 중앙값**을 쓴다 —
 * 표본이 늘거나 줄어도 "이 산업 기업들의 전형적인 수치"라는 뜻이 유지되고, 한 종목의 극단값에
 * 끌려가지도 않는다(의 테마·산업 칸과 같은 논리).
 */
import { median } from '../../../../utils/stats';
import type { OutlookPeriod } from './metrics';
import type { PeriodKey } from './period';

/**
 * 칸을 만들 최소 표본 수 — 1종목의 값은 산업 대표값이 아니라 그 종목 자체다.
 * `MIN_MEMBERS_FOR_CELL`과 같은 기준선.
 */
export const MIN_SAMPLES_FOR_CELL = 2;

/** 매트릭스에 올릴 수 있는 항목. 금액 항목은 **증가율**, 배수 항목은 **배수 자체**의 중앙값이다. */
export const COMPARE_METRICS = [
  'revenue', 'operatingIncome', 'netIncome', 'per', 'por',
] as const;
export type CompareMetric = (typeof COMPARE_METRICS)[number];

/** 증가율의 기준 — 분기 축에서만 `qoq`가 뜻을 갖는다. */
export type GrowthBasis = 'yoy' | 'qoq';

export interface CompareCell {
  /** 금액 항목이면 증가율(소수), 배수 항목이면 배수(배). */
  median: number;
  /** 값을 가진 종목 수 — 분모가 몇인지 밝힌다. */
  count: number;
}

export interface CompareSourceItem {
  periods: Record<string, OutlookPeriod>;
  hasEstimate: boolean;
}

export interface CompareSource {
  sector: string;
  /** 그 산업의 **활성 종목 수** — 커버리지의 분모. */
  totalCount: number;
  items: readonly CompareSourceItem[];
}

export interface SectorCompareRow {
  sector: string;
  totalCount: number;
  /** 쓸 만한 전망을 가진 종목 수. */
  coveredCount: number;
  /** 기간 키 → 항목 → 칸. 표본이 모자라면 키가 없다. */
  cells: Record<string, Partial<Record<CompareMetric, CompareCell>>>;
}

/** 한 종목·한 눈금에서 그 항목의 값을 꺼낸다. 없으면 null. */
export function valueOf(
  period: OutlookPeriod, metric: CompareMetric, basis: GrowthBasis,
): number | null {
  if (metric === 'per') return period.per;
  if (metric === 'por') return period.por;
  // 연간 축은 `qoq`가 null이다 — 기준을 잘못 물어도 값을 지어내지 않고 비운다.
  const deltas = basis === 'qoq' ? period.qoq : period.yoy;
  return deltas ? deltas[metric].growth : null;
}

/** 한 산업·한 눈금·한 항목. 표본이 `MIN_SAMPLES_FOR_CELL`에 못 미치면 null. */
export function aggregateCell(values: readonly number[]): CompareCell | null {
  if (values.length < MIN_SAMPLES_FOR_CELL) return null;
  const mid = median(values);
  if (mid == null) return null;
  return { median: mid, count: values.length };
}

/** 산업 하나를 매트릭스 한 행으로 압축한다. */
export function buildCompareRow(
  source: CompareSource, axis: readonly PeriodKey[], basis: GrowthBasis,
): SectorCompareRow {
  const cells: SectorCompareRow['cells'] = {};

  for (const period of axis) {
    const byMetric: Partial<Record<CompareMetric, CompareCell>> = {};
    for (const metric of COMPARE_METRICS) {
      const values: number[] = [];
      for (const item of source.items) {
        const cell = item.periods[period.key];
        if (!cell) continue;
        const value = valueOf(cell, metric, basis);
        if (value != null && Number.isFinite(value)) values.push(value);
      }
      const aggregated = aggregateCell(values);
      if (aggregated) byMetric[metric] = aggregated;
    }
    if (Object.keys(byMetric).length > 0) cells[period.key] = byMetric;
  }

  return {
    sector: source.sector,
    totalCount: source.totalCount,
    coveredCount: source.items.filter((i) => i.hasEstimate).length,
    cells,
  };
}

/** 값이 하나도 없는 산업은 행을 만들지 않는다 — 빈 줄만 늘어난다. */
export function buildCompareRows(
  sources: readonly CompareSource[], axis: readonly PeriodKey[], basis: GrowthBasis,
): SectorCompareRow[] {
  return sources
    .map((s) => buildCompareRow(s, axis, basis))
    .filter((r) => Object.keys(r.cells).length > 0);
}
