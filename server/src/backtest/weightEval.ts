import { buildPitDataset, type PitRow } from './strategyEval';
import type { PitFactorScores } from './runBacktest';

/**
 * 가중치 세트 평가기 — buildPitDataset(strategyEval.ts)의 PIT 데이터셋에
 * 후보 가중 벡터들을 적용해 세트별 성과를 한 번에 비교. 가중치 채택의 입력 자료.
 */

export interface WeightSet {
  value: number;
  quality: number;
  growth: number;
  momentum: number;
  flow?: number;   // PitRow에 없는 팩터 — 자동 제외 후 재정규화(과거 수급 커버리지 부족)
  tech?: number;    // PitRow에 없는 팩터 — 자동 제외 후 재정규화(신기술 점수는 시점 불변)
}

export interface WeightCandidate {
  name: string;
  weights: WeightSet;
}

export interface NormalizedWeights {
  value: number;
  quality: number;
  growth: number;
  momentum: number;
}

const AVAILABLE_FACTORS = ['value', 'quality', 'growth', 'momentum'] as const;
type AvailableFactor = (typeof AVAILABLE_FACTORS)[number];

/** 기본 후보 가중치 세트 6종 — 현행 실가중치·가설·극단 세트·균등 (스펙) */
export const DEFAULT_WEIGHT_CANDIDATES: WeightCandidate[] = [
  {
    name: '현행 (V.30/Q.25/G.20/M.15, tech 제외 재정규화)',
    weights: { value: 0.30, quality: 0.25, growth: 0.20, momentum: 0.15, tech: 0.10 },
  },
  {
    name: '가설 (V.20/Q.20/G.15/M.25/Flow.10, tech 제외 재정규화)',
    weights: { value: 0.20, quality: 0.20, growth: 0.15, momentum: 0.25, flow: 0.10, tech: 0.10 },
  },
  {
    name: '모멘텀 중심 (M.50/V.20/Q.20/G.10)',
    weights: { momentum: 0.50, value: 0.20, quality: 0.20, growth: 0.10 },
  },
  {
    name: '밸류 중심 (V.45/Q.30/G.15/M.10)',
    weights: { value: 0.45, quality: 0.30, growth: 0.15, momentum: 0.10 },
  },
  {
    name: '퀄리티+모멘텀 (Q.35/M.35/V.15/G.15)',
    weights: { quality: 0.35, momentum: 0.35, value: 0.15, growth: 0.15 },
  },
  {
    name: '균등 (각 .25)',
    weights: { value: 0.25, quality: 0.25, growth: 0.25, momentum: 0.25 },
  },
];

/**
 * PitRow에 없는 팩터(flow·tech 등)를 제외하고 남은 4팩터 가중치를 합 1로 재정규화.
 * 기존 pitScore의 W_SUM 패턴(runBacktest.ts)과 동일한 방식.
 */
export function normalizeWeights(weights: WeightSet): { normalized: NormalizedWeights; excludedFactors: string[] } {
  const excludedFactors = Object.entries(weights)
    .filter(([key, w]) => !AVAILABLE_FACTORS.includes(key as AvailableFactor) && w != null && Number(w) > 0)
    .map(([key]) => key);

  const sum = AVAILABLE_FACTORS.reduce((s, f) => s + (weights[f] ?? 0), 0);
  if (sum <= 0) {
    throw new Error('가중치 합이 0 이하입니다 — value/quality/growth/momentum 중 최소 1개는 양수여야 합니다.');
  }

  const normalized = AVAILABLE_FACTORS.reduce((acc, f) => {
    return { ...acc, [f]: (weights[f] ?? 0) / sum };
  }, {} as NormalizedWeights);

  return { normalized, excludedFactors };
}

/** PIT 팩터 점수(0~100)에 정규화된 가중치를 적용한 가중합 점수 */
export function computeWeightedScore(factors: PitFactorScores, normalized: NormalizedWeights): number {
  return (
    factors.value * normalized.value +
    factors.quality * normalized.quality +
    factors.growth * normalized.growth +
    factors.momentum * normalized.momentum
  );
}

export interface QuintileBucket {
  label: string;      // Q5(최상위)~Q1(최하위)
  avgRet: number;
  count: number;
}

/** 점수 내림차순 정렬된 종목의 5분위별 평균 수익률 — 단조성(Q5>Q4>...) 확인용 */
export function computeQuintiles(sortedDescByScore: Array<{ ret: number }>): QuintileBucket[] {
  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const q = Math.floor(sortedDescByScore.length / 5);
  return [0, 1, 2, 3, 4].map((k) => {
    const start = k * q;
    const end = k === 4 ? sortedDescByScore.length : (k + 1) * q;
    const slice = sortedDescByScore.slice(start, end);
    return {
      label: `Q${5 - k}`,
      avgRet: slice.length > 0 ? Math.round(avg(slice.map((x) => x.ret)) * 100) / 100 : 0,
      count: slice.length,
    };
  });
}

export interface WeightSetResult {
  name: string;
  weights: WeightSet;                  // 입력 그대로(참고용)
  normalizedWeights: NormalizedWeights; // 실제 적용된 4팩터 가중치(합 1)
  excludedFactors: string[];           // PitRow에 없어 제외된 팩터(flow/tech 등)
  sampleSize: number;                  // 채점 표본 수(= universe와 동일, 세트마다 불변)
  top20AvgRet: number;
  top20WinRate: number;
  excess: number;                      // top20AvgRet - universeAvg (%p)
  quintiles: QuintileBucket[];
}

export interface WeightEvalResult {
  baseDate: string;
  latestDate: string;
  universe: number;
  universeAvg: number;
  delistedCount: number;   // universe 중 is_active=FALSE 종목 수 — 생존편향 크기 계량
  topN: number;
  results: WeightSetResult[];
}

const TOP_N = 20;

/** 후보 가중치 세트를 같은 PIT 데이터셋에 적용해 세트별 성과를 비교 */
export async function evalWeightSets(
  monthsAgo: number,
  candidates: WeightCandidate[] = DEFAULT_WEIGHT_CANDIDATES,
): Promise<WeightEvalResult> {
  const { baseDate, latestDate, rows, delistedCount } = await buildPitDataset(monthsAgo);

  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const universeAvg = Math.round(avg(rows.map((r) => r.ret)) * 100) / 100;

  const results: WeightSetResult[] = candidates.map((cand) => evalOneWeightSet(cand, rows, universeAvg));

  return {
    baseDate,
    latestDate,
    universe: rows.length,
    universeAvg,
    delistedCount,
    topN: TOP_N,
    results,
  };
}

function evalOneWeightSet(cand: WeightCandidate, rows: PitRow[], universeAvg: number): WeightSetResult {
  const { normalized, excludedFactors } = normalizeWeights(cand.weights);

  const scoredDesc = rows
    .map((r) => ({ ret: r.ret, weightedScore: computeWeightedScore(r.factors, normalized) }))
    .sort((a, b) => b.weightedScore - a.weightedScore);

  const top = scoredDesc.slice(0, Math.min(TOP_N, scoredDesc.length));
  const topRets = top.map((t) => t.ret);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const top20AvgRet = topRets.length > 0 ? Math.round(avg(topRets) * 100) / 100 : 0;
  const top20WinRate =
    topRets.length > 0
      ? Math.round((topRets.filter((v) => v > 0).length / topRets.length) * 1000) / 10
      : 0;

  return {
    name: cand.name,
    weights: cand.weights,
    normalizedWeights: normalized,
    excludedFactors,
    sampleSize: scoredDesc.length,
    top20AvgRet,
    top20WinRate,
    excess: Math.round((top20AvgRet - universeAvg) * 100) / 100,
    quintiles: computeQuintiles(scoredDesc),
  };
}
