import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveBps } from './naverFinancials';

// deriveBps: ROE = EPS/BPS 항등식으로 BPS를 역산(이 소스는 BPS를 직접 제공하지 않음).

test('EPS·ROE가 모두 있으면 EPS/ROE로 BPS를 역산한다', () => {
  assert.equal(deriveBps(6564, 0.1085), Math.round(6564 / 0.1085));
});

test('ROE가 0이면(자기자본이익률 0) 계산하지 않고 null을 반환한다', () => {
  assert.equal(deriveBps(100, 0), null);
});

test('EPS 또는 ROE가 없으면 null을 반환한다', () => {
  assert.equal(deriveBps(null, 0.1), null);
  assert.equal(deriveBps(100, null), null);
  assert.equal(deriveBps(null, null), null);
});

test('적자 연도(EPS 음수) ROE도 음수인 정상 케이스는 값이 계산된다(부호가 상쇄되어 양수 BPS)', () => {
  // EPS -100, ROE -0.05 → 자기자본도 음수이거나 순손실인 상황. 항등식 그대로 적용하면
  // 부호가 상쇄되어 양수가 나올 수 있음 — 호출측(computeBands)이 0 이하 BPS를 걸러낸다.
  assert.equal(deriveBps(-100, -0.05), Math.round(-100 / -0.05));
});
