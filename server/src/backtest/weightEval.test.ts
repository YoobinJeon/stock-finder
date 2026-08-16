import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWeights,
  computeWeightedScore,
  computeQuintiles,
  DEFAULT_WEIGHT_CANDIDATES,
  type WeightSet,
} from './weightEval';
import type { PitFactorScores } from './runBacktest';

// ── normalizeWeights ──

test('4팩터만 있으면 합이 1이 되도록 그대로 정규화하고 제외 팩터는 없다', () => {
  const weights: WeightSet = { value: 0.30, quality: 0.25, growth: 0.20, momentum: 0.15 };
  const { normalized, excludedFactors } = normalizeWeights(weights);
  assert.ok(Math.abs(normalized.value + normalized.quality + normalized.growth + normalized.momentum - 1) < 1e-9);
  assert.deepEqual(excludedFactors, []);
});

test('flow/tech가 섞여 있으면 4팩터만 재정규화하고 나머지는 excludedFactors로 보고', () => {
  const weights: WeightSet = { value: 0.20, quality: 0.20, growth: 0.15, momentum: 0.25, flow: 0.10, tech: 0.10 };
  const { normalized, excludedFactors } = normalizeWeights(weights);
  // 4팩터 합 0.80 → 각 값을 0.80으로 나눠 재정규화
  assert.ok(Math.abs(normalized.value - 0.20 / 0.80) < 1e-9);
  assert.ok(Math.abs(normalized.momentum - 0.25 / 0.80) < 1e-9);
  assert.ok(Math.abs(normalized.value + normalized.quality + normalized.growth + normalized.momentum - 1) < 1e-9);
  assert.deepEqual([...excludedFactors].sort(), ['flow', 'tech']);
});

test('flow/tech가 0이면 excludedFactors에 포함하지 않는다(양수만 카운트)', () => {
  const weights: WeightSet = { value: 0.30, quality: 0.25, growth: 0.20, momentum: 0.15, flow: 0, tech: 0 };
  const { excludedFactors } = normalizeWeights(weights);
  assert.deepEqual(excludedFactors, []);
});

test('4팩터 가중치 합이 0 이하이면 에러를 던진다', () => {
  const weights: WeightSet = { value: 0, quality: 0, growth: 0, momentum: 0, flow: 0.5 };
  assert.throws(() => normalizeWeights(weights));
});

test('모멘텀 극단(0.50) 세트도 4팩터 합 1로 정규화된다', () => {
  const weights: WeightSet = { momentum: 0.50, value: 0.20, quality: 0.20, growth: 0.10 };
  const { normalized } = normalizeWeights(weights);
  assert.ok(Math.abs(normalized.momentum - 0.5) < 1e-9);
});

test('입력 객체를 변경하지 않는다(불변)', () => {
  const weights: WeightSet = { value: 0.20, quality: 0.20, growth: 0.15, momentum: 0.25, flow: 0.10, tech: 0.10 };
  const snapshot = { ...weights };
  normalizeWeights(weights);
  assert.deepEqual(weights, snapshot);
});

// ── computeWeightedScore ──

const factors = (o: Partial<PitFactorScores>): PitFactorScores => ({
  value: 50, quality: 50, growth: 50, momentum: 50, ...o,
});

test('균등 가중치(각 0.25)면 팩터 평균과 같다', () => {
  const f = factors({ value: 80, quality: 60, growth: 40, momentum: 20 });
  const score = computeWeightedScore(f, { value: 0.25, quality: 0.25, growth: 0.25, momentum: 0.25 });
  assert.ok(Math.abs(score - 50) < 1e-9); // (80+60+40+20)/4
});

test('한 팩터에 가중치 1을 몰아주면 해당 팩터 값과 같다', () => {
  const f = factors({ value: 90, quality: 10, growth: 10, momentum: 10 });
  const score = computeWeightedScore(f, { value: 1, quality: 0, growth: 0, momentum: 0 });
  assert.equal(score, 90);
});

test('모든 팩터가 100이면 가중치와 무관하게 100이다', () => {
  const f = factors({ value: 100, quality: 100, growth: 100, momentum: 100 });
  const score = computeWeightedScore(f, { value: 0.45, quality: 0.30, growth: 0.15, momentum: 0.10 });
  assert.ok(Math.abs(score - 100) < 1e-9);
});

// ── computeQuintiles ──

test('10종목을 점수 내림차순으로 5분위 나누면 각 2종목씩, Q5가 가장 앞', () => {
  const sorted = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((ret) => ({ ret }));
  const buckets = computeQuintiles(sorted);
  assert.equal(buckets.length, 5);
  assert.equal(buckets[0].label, 'Q5');
  assert.equal(buckets[0].count, 2);
  assert.ok(Math.abs(buckets[0].avgRet - 9.5) < 1e-9); // (10+9)/2
  assert.equal(buckets[4].label, 'Q1');
  assert.ok(Math.abs(buckets[4].avgRet - 1.5) < 1e-9); // (2+1)/2
});

test('나눠떨어지지 않는 개수는 마지막(Q1) 구간이 나머지를 흡수한다', () => {
  const sorted = [10, 9, 8, 7, 6, 5, 4].map((ret) => ({ ret })); // 7개 → q=1
  const buckets = computeQuintiles(sorted);
  const total = buckets.reduce((s, b) => s + b.count, 0);
  assert.equal(total, 7);
  assert.equal(buckets[4].count, 3); // 1+1+1+1+3=7
});

test('단조성 확인: 상위 분위 평균 수익률이 하위보다 높은 데이터면 그대로 반영된다', () => {
  const sorted = [20, 18, 16, 14, 12, 10, 8, 6, 4, 2].map((ret) => ({ ret }));
  const buckets = computeQuintiles(sorted);
  for (let i = 0; i < buckets.length - 1; i++) {
    assert.ok(buckets[i].avgRet > buckets[i + 1].avgRet);
  }
});

test('입력 배열을 변경하지 않는다(불변)', () => {
  const sorted = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((ret) => ({ ret }));
  const snapshot = sorted.map((x) => ({ ...x }));
  computeQuintiles(sorted);
  assert.deepEqual(sorted, snapshot);
});

// ── DEFAULT_WEIGHT_CANDIDATES ──

test('기본 후보 세트는 6종이고 전부 4팩터 가중치 합이 0보다 크다', () => {
  assert.equal(DEFAULT_WEIGHT_CANDIDATES.length, 6);
  for (const cand of DEFAULT_WEIGHT_CANDIDATES) {
    const { normalized } = normalizeWeights(cand.weights);
    const sum = normalized.value + normalized.quality + normalized.growth + normalized.momentum;
    assert.ok(Math.abs(sum - 1) < 1e-9, `${cand.name} 정규화 합이 1이 아님`);
  }
});
