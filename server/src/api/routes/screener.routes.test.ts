import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEarningsTrendFilter } from './screener.routes';

// ── 모드 화이트리스트: 이 값이 SQL 컬럼명을 고르므로 임의 문자열이 새면 안 된다 ──

test('세 모드만 기간으로 해석된다', () => {
  assert.deepEqual(resolveEarningsTrendFilter('yoy', null).periods, ['yoy']);
  assert.deepEqual(resolveEarningsTrendFilter('qoq', null).periods, ['qoq']);
  assert.deepEqual(resolveEarningsTrendFilter('both', null).periods, ['yoy', 'qoq']);
});

test('모드가 없거나 알 수 없으면 조건을 걸지 않는다', () => {
  assert.deepEqual(resolveEarningsTrendFilter(undefined, null).periods, []);
  assert.deepEqual(resolveEarningsTrendFilter(null, null).periods, []);
  assert.deepEqual(resolveEarningsTrendFilter('', null).periods, []);
  assert.deepEqual(resolveEarningsTrendFilter('YOY', null).periods, []); // 대소문자 구분
  assert.deepEqual(resolveEarningsTrendFilter('yoy; DROP TABLE stocks', null).periods, []);
});

test('문자열이 아닌 모드는 무시한다 (JSON 바디로 배열·객체가 올 수 있다)', () => {
  assert.deepEqual(resolveEarningsTrendFilter(['yoy'], null).periods, []);
  assert.deepEqual(resolveEarningsTrendFilter({ toString: () => 'yoy' }, null).periods, []);
  assert.deepEqual(resolveEarningsTrendFilter(1, null).periods, []);
});

test('Object.prototype 키는 모드로 통하지 않는다', () => {
  assert.deepEqual(resolveEarningsTrendFilter('constructor', null).periods, []);
  assert.deepEqual(resolveEarningsTrendFilter('toString', null).periods, []);
  assert.deepEqual(resolveEarningsTrendFilter('__proto__', null).periods, []);
});

// ── 임계값 ──

test('유한한 수는 그대로 임계값이 된다 (0·음수 포함)', () => {
  assert.equal(resolveEarningsTrendFilter('yoy', 20).growthFloor, 20);
  assert.equal(resolveEarningsTrendFilter('yoy', '20').growthFloor, 20);
  assert.equal(resolveEarningsTrendFilter('yoy', 0).growthFloor, 0);
  assert.equal(resolveEarningsTrendFilter('yoy', -10).growthFloor, -10);
});

test('빈 값은 임계값 없음으로 본다 (입력칸을 비워둔 상태)', () => {
  assert.equal(resolveEarningsTrendFilter('yoy', null).growthFloor, null);
  assert.equal(resolveEarningsTrendFilter('yoy', undefined).growthFloor, null);
  assert.equal(resolveEarningsTrendFilter('yoy', '').growthFloor, null);
});

test('수가 아닌 임계값은 무시한다 — NaN이 새면 조용히 0건이 된다', () => {
  assert.equal(resolveEarningsTrendFilter('yoy', 'abc').growthFloor, null);
  assert.equal(resolveEarningsTrendFilter('yoy', NaN).growthFloor, null);
  assert.equal(resolveEarningsTrendFilter('yoy', Infinity).growthFloor, null);
  assert.equal(resolveEarningsTrendFilter('yoy', {}).growthFloor, null);
});

test('임계값만 있고 모드가 없으면 아무 조건도 걸리지 않는다', () => {
  const r = resolveEarningsTrendFilter(undefined, 30);

  assert.deepEqual(r.periods, []);
  assert.equal(r.growthFloor, 30);
});
