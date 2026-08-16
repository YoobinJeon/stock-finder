import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCoverageShrink } from './CompositeScorer';

test('결측 엔진 0~1개면 수축 미적용', () => {
  assert.deepEqual(applyCoverageShrink(70, 0), { total: 70, note: null });
  assert.deepEqual(applyCoverageShrink(70, 1), { total: 70, note: null });
});

test('결측 엔진 2개 이상이면 50점 기준 0.85배로 수축', () => {
  const result = applyCoverageShrink(70, 2);
  // 50 + (70-50)*0.85 = 67
  assert.equal(result.total, 67);
  assert.match(result.note ?? '', /결측 엔진 2개/);
  assert.match(result.note ?? '', /70점 → 67점/);
});

test('50점 미만(저평가 방향)도 동일하게 중립 쪽으로 수축', () => {
  const result = applyCoverageShrink(30, 3);
  // 50 + (30-50)*0.85 = 33
  assert.equal(result.total, 33);
  assert.match(result.note ?? '', /결측 엔진 3개/);
});

test('수축해도 반올림 결과가 동일하면 note는 null', () => {
  // 50 + (50-50)*0.85 = 50 — 결측이어도 총점이 이미 중립이면 변화 없음
  const result = applyCoverageShrink(50, 2);
  assert.equal(result.total, 50);
  assert.equal(result.note, null);
});
