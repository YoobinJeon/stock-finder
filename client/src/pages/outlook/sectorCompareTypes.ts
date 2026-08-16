/**
 * 산업 실적 전망 — **산업 비교** 응답 모양.
 * `market/sectorOutlook.routes.ts`의 `GET /outlook/sectors`와 짝을 이룬다.
 */
import type { GrowthBasis, MetricKey, PeriodKey, PeriodType } from './outlookTypes';

export interface CompareCell {
  /** 금액 항목이면 증가율(소수), 배수 항목이면 배수(배)의 **중앙값**. */
  median: number;
  /** 값을 가진 종목 수 — 분모. */
  count: number;
}

export interface SectorCompareRow {
  sector: string;
  /** 그 산업의 활성 종목 수. */
  totalCount: number;
  /** 쓸 만한 전망을 가진 종목 수. */
  coveredCount: number;
  /** 기간 키 → 항목 → 칸. 표본이 2종목 미만이면 키가 없다. */
  cells: Record<string, Partial<Record<MetricKey, CompareCell>>>;
}

export interface SectorCompareResponse {
  periodType: PeriodType;
  basis: GrowthBasis;
  periods: PeriodKey[];
  updatedAt: string | null;
  rows: SectorCompareRow[];
}

/** 배수 항목인가 — 증가율이 아니라 배수 자체라 표기·색조 규칙이 다르다. */
export function isMultipleMetric(metric: MetricKey): boolean {
  return metric === 'per' || metric === 'por';
}

/** 배수 표기 — 소수 한 자리에 '배'. */
export function fmtMultiple(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toFixed(1)}배`;
}
