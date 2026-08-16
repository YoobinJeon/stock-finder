import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateGroup, median, MIN_MEMBERS_FOR_CELL } from './groupAggregate';

test('중앙값 — 홀수면 가운데', () => {
  assert.equal(median([0.3, 0.1, 0.2]), 0.2);
});

test('중앙값 — 짝수면 가운데 둘의 평균', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(Number(median([0.1, 0.2, 0.3, 0.4])!.toFixed(10)), 0.25);
});

test('중앙값은 입력 배열을 건드리지 않는다', () => {
  const input = [0.3, 0.1, 0.2];
  median(input);
  assert.deepEqual(input, [0.3, 0.1, 0.2], '원본이 정렬되어 버리면 호출측이 조용히 망가진다');
});

test('빈 배열은 null', () => {
  assert.equal(median([]), null);
});

test('중앙값은 이상치에 견딘다 — 이 화면이 평균 대신 중앙값을 쓰는 이유', () => {
  // 잡주 하나가 +300% 뛰어도 묶음 전반(약 +2%)을 대표하는 값은 흔들리지 않아야 한다.
  const cell = aggregateGroup([0.01, 0.02, 0.03, 0.02, 3.0])!;
  assert.equal(cell.median, 0.02);
  assert.ok(cell.mean > 0.6, `평균은 끌려간다 (${cell.mean})`);
});

test('상승 종목 비율과 분모를 함께 낸다', () => {
  const cell = aggregateGroup([0.1, -0.2, 0.3, 0])!;
  assert.equal(cell.count, 4);
  assert.equal(cell.upRatio, 0.5, '0%는 오른 것이 아니다');
});

test('멤버가 최소치에 못 미치면 칸을 만들지 않는다', () => {
  assert.equal(MIN_MEMBERS_FOR_CELL, 2);
  assert.equal(aggregateGroup([]), null);
  assert.equal(aggregateGroup([0.5]), null, '1종목은 묶음 대표값이 아니라 그 종목 자체다');
  assert.notEqual(aggregateGroup([0.5, 0.1]), null);
});

test('전부 하락이면 상승 비율 0', () => {
  const cell = aggregateGroup([-0.1, -0.2])!;
  assert.equal(cell.upRatio, 0);
  assert.equal(Number(cell.median.toFixed(10)), -0.15);
});
