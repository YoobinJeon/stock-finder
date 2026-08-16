import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideDelistings, DELIST_FETCH_RATIO_THRESHOLD, DELIST_MAX_PER_RUN } from './delisting';

// 활성 100개 중 fetch에 없는 소수(정상 상폐 시나리오) — 비활성화 대상으로 확정된다.
test('정상적인 소수 상폐 — 대상 종목만 반환, 스킵 없음', () => {
  const active = Array.from({ length: 100 }, (_, i) => `A${i}`);
  const fetched = active.slice(0, 98); // 2개 누락 (상폐 추정)

  const result = decideDelistings('all', active, fetched);

  assert.deepEqual(result.toDeactivate.sort(), ['A98', 'A99']);
  assert.equal(result.skipReason, null);
});

test('fetch 수량이 활성 수의 97% 미만이면 급감으로 판단해 스킵', () => {
  const active = Array.from({ length: 100 }, (_, i) => `A${i}`);
  const fetched = active.slice(0, 96); // 96% — 임계 미만

  const result = decideDelistings('all', active, fetched);

  assert.deepEqual(result.toDeactivate, []);
  assert.equal(result.skipReason, 'fetch_count_drop');
});

test('fetch 수량이 정확히 97%면 급감 스킵에 해당하지 않는다 (경계값)', () => {
  const active = Array.from({ length: 100 }, (_, i) => `A${i}`);
  const fetched = active.slice(0, 97); // 정확히 97% — 임계 이상이므로 통과

  const result = decideDelistings('all', active, fetched);

  assert.equal(result.skipReason, null);
  assert.equal(DELIST_FETCH_RATIO_THRESHOLD, 0.97);
});

// 캡 검증은 활성 종목 수를 넉넉히 키워 급감(97%) 가드에 먼저 걸리지 않게 한다
// (캡 초과분이 활성 수의 3%를 넘지 않아야 급감 가드와 분리해서 캡 가드만 검증할 수 있다).
test('비활성화 후보가 상한을 초과하면 스킵 (대량 오폭 방지)', () => {
  const active = Array.from({ length: 2000 }, (_, i) => `A${i}`);
  const fetched = active.slice(0, 2000 - (DELIST_MAX_PER_RUN + 1)); // 상한보다 1개 더 누락

  const result = decideDelistings('all', active, fetched);

  assert.deepEqual(result.toDeactivate, []);
  assert.equal(result.skipReason, 'cap_exceeded');
});

test('비활성화 후보가 정확히 상한이면 스킵되지 않는다 (경계값)', () => {
  const active = Array.from({ length: 2000 }, (_, i) => `A${i}`);
  const fetched = active.slice(0, 2000 - DELIST_MAX_PER_RUN);

  const result = decideDelistings('all', active, fetched);

  assert.equal(result.skipReason, null);
  assert.equal(result.toDeactivate.length, DELIST_MAX_PER_RUN);
});

test('scope가 all이 아니면(top200/kospi) 안전 가드가 없어도 실행하지 않는다', () => {
  const active = ['A1', 'A2', 'A3'];
  const fetched: string[] = []; // 부분 목록이므로 전부 없어도 상폐 판정 대상이 아님

  const top200 = decideDelistings('top200', active, fetched);
  const kospi = decideDelistings('kospi', active, fetched);

  assert.deepEqual(top200.toDeactivate, []);
  assert.equal(top200.skipReason, 'not_all_scope');
  assert.deepEqual(kospi.toDeactivate, []);
  assert.equal(kospi.skipReason, 'not_all_scope');
});

test('활성 종목이 없으면(초기 DB) 비활성화 대상도 없다', () => {
  const result = decideDelistings('all', [], ['N1', 'N2']);

  assert.deepEqual(result.toDeactivate, []);
  assert.equal(result.skipReason, null);
});
