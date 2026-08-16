import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growthRate, isTurnaround } from './growthRate';

test('정상 증가율', () => {
  assert.equal(growthRate(120, 100), 0.2);
  assert.equal(growthRate(80, 100), -0.2);
  assert.equal(growthRate(100, 100), 0);
});

test('직전 값이 0 이하면 null — 분모가 음수면 적자 확대가 성장으로 보인다', () => {
  assert.equal(growthRate(-200, -100), null);
  assert.equal(growthRate(50, -100), null);
  assert.equal(growthRate(50, 0), null);
});

test('결측은 null', () => {
  assert.equal(growthRate(null, 100), null);
  assert.equal(growthRate(100, null), null);
  assert.equal(growthRate(undefined, undefined), null);
});

test('적자→흑자만 턴어라운드', () => {
  assert.equal(isTurnaround(50, -100), true);
  assert.equal(isTurnaround(50, 0), true);
  assert.equal(isTurnaround(-50, -100), false, '적자 축소는 턴어라운드가 아니다');
  assert.equal(isTurnaround(200, 100), false, '흑자 성장은 턴어라운드가 아니다');
  assert.equal(isTurnaround(null, -100), false);
  assert.equal(isTurnaround(50, null), false);
});

test('턴어라운드 구간은 growthRate가 반드시 null — 두 신호가 겹치지 않는다', () => {
  const cases: Array<[number, number]> = [[50, -100], [50, 0], [1, -1]];
  for (const [cur, prev] of cases) {
    assert.equal(isTurnaround(cur, prev), true);
    assert.equal(growthRate(cur, prev), null);
  }
});
