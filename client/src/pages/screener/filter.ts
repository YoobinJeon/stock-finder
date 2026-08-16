import type { FilterState, EarningsTrendMode } from './types';
import { Preset, PresetCriteria } from '../StrategiesPage';

/**
 * 필터 상태 ↔ 전략 조건(PresetCriteria) 변환과 프리셋 병합.
 * (2026-07-26 ScreenerPage.tsx 분할 — 800줄 규칙. 로직은 그대로 옮겼다.)
 */

export const EMPTY_FILTER: FilterState = {
  market: '', sector: '', minScore: 0,
  maxPer: '', minOpMargin: '', minRevenueGrowth: '', minDivYield: '', minMarketCapEok: '',
  earningsTrend: '', minEarningsGrowth: '', minEarningsStreak: '', estImproving: false,
  foreignNetBuy5d: false, instNetBuy5d: false, minForeignStreak: '',
  goldenCross: false, aboveMa20: false, earlyTrend: false, maxPctFrom52wHigh: '', rsiMin: '', rsiMax: '', minVolRatio: '',
  aboveMa150: false, aboveMa200: false, ma150AboveMa200: false, ma200Up: false,
  minPctFrom52wLow: '', minRsPercentile: '',
  q: '', sort: 'score', order: 'desc',
  page: 1,
};

/**
 * 여러 전략의 조건을 AND 병합.
 * 최소(min~) 조건은 큰 값, 최대(max~) 조건은 작은 값(더 엄격한 쪽), 불리언은 하나라도 요구하면 적용.
 */
export function mergeCriteria(presets: Preset[]): PresetCriteria {
  const merged: Record<string, unknown> = {};
  const minKeys = ['minScore', 'minOpMargin', 'minRevenueGrowth', 'minDivYield', 'minMarketCap', 'minForeignStreak', 'rsiMin', 'minVolRatio', 'minPctFrom52wLow', 'minRsPercentile', 'minEarningsGrowth', 'minEarningsStreak'];
  const maxKeys = ['maxPer', 'maxPctFrom52wHigh', 'rsiMax'];
  const boolKeys = ['foreignNetBuy5d', 'instNetBuy5d', 'goldenCross', 'aboveMa20', 'earlyTrend', 'aboveMa150', 'aboveMa200', 'ma150AboveMa200', 'ma200Up', 'estImproving'];

  for (const p of presets) {
    const c = (p.criteria ?? {}) as Record<string, unknown>;
    if (typeof c.market === 'string' && c.market) merged.market = c.market;
    for (const k of minKeys) {
      const v = Number(c[k]);
      if (c[k] != null && Number.isFinite(v)) merged[k] = merged[k] != null ? Math.max(Number(merged[k]), v) : v;
    }
    for (const k of maxKeys) {
      const v = Number(c[k]);
      if (c[k] != null && Number.isFinite(v)) merged[k] = merged[k] != null ? Math.min(Number(merged[k]), v) : v;
    }
    for (const k of boolKeys) {
      if (c[k] === true) merged[k] = true;
    }
    // 실적 개선 모드는 기간의 합집합으로 AND 병합한다 (YoY 전략 + QoQ 전략 = 둘 다 만족).
    merged.earningsTrend = mergeTrendMode(
      merged.earningsTrend as EarningsTrendMode | undefined,
      c.earningsTrend,
    );
  }
  if (!merged.earningsTrend) delete merged.earningsTrend;
  return merged as PresetCriteria;
}

// Map인 이유: 평범한 객체는 'constructor' 같은 프로토타입 키에 값을 돌려줘 화이트리스트가 샌다.
const TREND_PERIODS = new Map<string, Array<'yoy' | 'qoq'>>([
  ['yoy', ['yoy']], ['qoq', ['qoq']], ['both', ['yoy', 'qoq']],
]);

/** 두 모드의 기간 합집합 → 모드. 알 수 없는 값은 조건 없음으로 취급한다. */
function mergeTrendMode(a: EarningsTrendMode | undefined, b: unknown): EarningsTrendMode {
  const periodsOf = (v: unknown) => (typeof v === 'string' ? TREND_PERIODS.get(v) ?? [] : []);
  const periods = new Set([...periodsOf(a), ...periodsOf(b)]);
  if (periods.size === 2) return 'both';
  if (periods.has('yoy')) return 'yoy';
  if (periods.has('qoq')) return 'qoq';
  return '';
}

/** 현재 필터 상태 → 조건 객체 (검색 바디·조건 배지 공용) */
export function filterToCriteria(f: FilterState): PresetCriteria {
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  return {
    market: f.market || undefined,
    minScore: f.minScore > 0 ? f.minScore : undefined,
    maxPer: num(f.maxPer),
    minOpMargin: num(f.minOpMargin),
    minRevenueGrowth: num(f.minRevenueGrowth),
    minDivYield: num(f.minDivYield),
    minMarketCap: f.minMarketCapEok.trim() === '' ? undefined : Number(f.minMarketCapEok) * 1e8,
    earningsTrend: f.earningsTrend || undefined,
    // 임계값은 모드를 골랐을 때만 의미가 있다 — 모드 없이 보내면 조건 배지에 유령 조건이 남는다
    minEarningsGrowth: f.earningsTrend ? num(f.minEarningsGrowth) : undefined,
    minEarningsStreak: num(f.minEarningsStreak),
    estImproving: f.estImproving || undefined,
    foreignNetBuy5d: f.foreignNetBuy5d || undefined,
    instNetBuy5d: f.instNetBuy5d || undefined,
    minForeignStreak: num(f.minForeignStreak),
    goldenCross: f.goldenCross || undefined,
    aboveMa20: f.aboveMa20 || undefined,
    earlyTrend: f.earlyTrend || undefined,
    maxPctFrom52wHigh: num(f.maxPctFrom52wHigh),
    rsiMin: num(f.rsiMin),
    rsiMax: num(f.rsiMax),
    minVolRatio: num(f.minVolRatio),
    aboveMa150: f.aboveMa150 || undefined,
    aboveMa200: f.aboveMa200 || undefined,
    ma150AboveMa200: f.ma150AboveMa200 || undefined,
    ma200Up: f.ma200Up || undefined,
    minPctFrom52wLow: num(f.minPctFrom52wLow),
    minRsPercentile: num(f.minRsPercentile),
  };
}

export function criteriaToFilter(c: PresetCriteria): FilterState {
  const s = (v: number | undefined) => (v != null ? String(v) : '');
  return {
    ...EMPTY_FILTER,
    market: c.market ?? '',
    minScore: c.minScore ?? 0,
    maxPer: s(c.maxPer),
    minOpMargin: s(c.minOpMargin),
    minRevenueGrowth: s(c.minRevenueGrowth),
    minDivYield: s(c.minDivYield),
    minMarketCapEok: c.minMarketCap != null ? String(c.minMarketCap / 1e8) : '',
    earningsTrend: TREND_PERIODS.has(String(c.earningsTrend)) ? (c.earningsTrend as EarningsTrendMode) : '',
    minEarningsGrowth: s(c.minEarningsGrowth),
    minEarningsStreak: s(c.minEarningsStreak),
    estImproving: c.estImproving === true,
    foreignNetBuy5d: c.foreignNetBuy5d === true,
    instNetBuy5d: c.instNetBuy5d === true,
    minForeignStreak: s(c.minForeignStreak),
    goldenCross: c.goldenCross === true,
    aboveMa20: c.aboveMa20 === true,
    earlyTrend: c.earlyTrend === true,
    maxPctFrom52wHigh: s(c.maxPctFrom52wHigh),
    rsiMin: s(c.rsiMin),
    rsiMax: s(c.rsiMax),
    minVolRatio: s(c.minVolRatio),
    aboveMa150: c.aboveMa150 === true,
    aboveMa200: c.aboveMa200 === true,
    ma150AboveMa200: c.ma150AboveMa200 === true,
    ma200Up: c.ma200Up === true,
    minPctFrom52wLow: s(c.minPctFrom52wLow),
    minRsPercentile: s(c.minRsPercentile),
  };
}
