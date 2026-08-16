import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBreakRatio, nextRepairStep, withinRepairWindow } from './priceRepair';

// KRX 일일 상하한가 ±30% 대비 여유를 둔 [0.6, 1.4] 밖(초과/미만, 경계값 제외)이면 이상으로 판정한다.

test('1.39배 상승은 정상 범위 — false', () => {
  assert.equal(isBreakRatio(1, 1.39), false);
});

test('1.41배 상승은 이상 — true', () => {
  assert.equal(isBreakRatio(1, 1.41), true);
});

test('0.61배(39% 하락)는 정상 범위 — false', () => {
  assert.equal(isBreakRatio(1, 0.61), false);
});

test('0.59배(41% 하락)는 이상 — true', () => {
  assert.equal(isBreakRatio(1, 0.59), true);
});

test('전일 종가가 0이면 판정 불가 — false', () => {
  assert.equal(isBreakRatio(0, 100), false);
});

test('전일 종가가 음수면 판정 불가 — false', () => {
  assert.equal(isBreakRatio(-5, 100), false);
});

test('경계값 정확히 1.4배는 초과가 아니므로 false', () => {
  assert.equal(isBreakRatio(100, 140), false);
});

test('경계값 정확히 0.6배는 미만이 아니므로 false', () => {
  assert.equal(isBreakRatio(100, 60), false);
});

// ── 재정합 결과 판정 ───────────────────────────────────────────────────────

// 이 규칙이 없어서 감지 17개 / "복구" 17개 / 실제 해소 0개인 상태가 몇 주 이어졌다
// (2026-08-11 확인). 재수집이 예외 없이 끝난 것과 파손이 사라진 것은 다르다.

test('파손이 사라졌으면 완료 — 원천이 무엇이었든', () => {
  assert.equal(nextRepairStep(false, 'kis'), 'done');
  assert.equal(nextRepairStep(false, 'yahoo'), 'done');
});

test('KIS로 안 고쳐졌으면 Yahoo로 다시 시도한다 — 원천마다 보정 시점이 다르다', () => {
  // 실측: 17개 중 3개(진원생명과학·메디콕스·큐에이드)는 KIS엔 파손이 남아 있고 Yahoo는 깨끗했다.
  assert.equal(nextRepairStep(true, 'kis'), 'retry-yahoo');
});

test('Yahoo로도 안 고쳐지면 우리가 고칠 수 없다고 말한다 — 성공으로 세지 않는다', () => {
  assert.equal(nextRepairStep(true, 'yahoo'), 'unfixable');
});

// ── 재정합 구간 상한 ───────────────────────────────────────────────────────

// 상한이 없던 동안 14시 수동 실행이 거래정지 13종목에 **거래량 0인 2026-08-11 행**을 만들어
// 시세 기준일을 08-11로 앞당겼다. 나머지 2,765종목은 08-10까지였다(2026-08-11 확인).

test('시장 마지막 거래일보다 뒤인 바는 넣지 않는다 — 재정합이 거래일을 앞당기면 안 된다', () => {
  assert.equal(withinRepairWindow('2026-08-11', '2025-07-01', '2026-08-10'), false);
});

test('마지막 거래일 당일은 포함한다 — 정상 경로(수집 뒤 재정합)에서 아무것도 잘리지 않는다', () => {
  assert.equal(withinRepairWindow('2026-08-10', '2025-07-01', '2026-08-10'), true);
});

test('룩백 시작보다 이전 바는 넣지 않는다', () => {
  assert.equal(withinRepairWindow('2025-06-30', '2025-07-01', '2026-08-10'), false);
  assert.equal(withinRepairWindow('2025-07-01', '2025-07-01', '2026-08-10'), true);
});

test('거래일 기준을 못 구하면(초기 상태) 상한을 걸지 않는다 — 없는 근거로 자르지 않는다', () => {
  assert.equal(withinRepairWindow('2026-08-11', '2025-07-01', null), true);
});
