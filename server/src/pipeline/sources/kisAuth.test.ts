import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRetryableKisError,
  kisRetryDelayMs,
  kisYmdToIso,
  parseKisExpiry,
  prevYmd,
  toKisYmd,
} from './kisAuth';

test('토큰 만료 문자열을 KST로 해석한다', () => {
  // 2026-07-27 07:47:08 KST == 2026-07-26 22:47:08 UTC
  assert.equal(parseKisExpiry('2026-07-27 07:47:08'), Date.UTC(2026, 6, 26, 22, 47, 8));
});

test('만료 형식이 어긋나면 null (호출측이 기본 TTL로 폴백)', () => {
  assert.equal(parseKisExpiry('20260727074708'), null);
  assert.equal(parseKisExpiry(''), null);
  assert.equal(parseKisExpiry(null), null);
});

test('prevYmd는 월·연 경계를 넘어간다', () => {
  assert.equal(prevYmd('20260602'), '20260601');
  assert.equal(prevYmd('20260601'), '20260531');
  assert.equal(prevYmd('20260101'), '20251231');
});

test('kisYmdToIso는 8자리만 받아들인다', () => {
  assert.equal(kisYmdToIso('20260724'), '2026-07-24');
  assert.equal(kisYmdToIso('2026-07-24'), null);
  assert.equal(kisYmdToIso(''), null);
  assert.equal(kisYmdToIso(null), null);
});

test('toKisYmd는 KST 기준으로 날짜를 뽑는다', () => {
  // 2026-07-24 23:30 UTC == 2026-07-25 08:30 KST → 하루 넘어간 날짜여야 한다
  assert.equal(toKisYmd(new Date(Date.UTC(2026, 6, 24, 23, 30))), '20260725');
  assert.equal(toKisYmd(new Date(Date.UTC(2026, 6, 24, 10, 0))), '20260724');
});

test('EGW00201(초당 거래건수 초과)은 재시도 대상', () => {
  assert.equal(isRetryableKisError(undefined, 'EGW00201'), true);
  assert.equal(isRetryableKisError(200, 'EGW00201'), true);
});

test('500·429는 재시도 대상 — 실측에서 연속 조회 중 500이 떨어졌다', () => {
  assert.equal(isRetryableKisError(500, undefined), true);
  assert.equal(isRetryableKisError(503, undefined), true);
  assert.equal(isRetryableKisError(429, undefined), true);
});

test('상태코드가 없으면(네트워크 오류·타임아웃) 재시도 대상', () => {
  assert.equal(isRetryableKisError(undefined, undefined), true);
});

test('400·401은 재시도해도 같은 결과 — 한도만 소모하므로 즉시 포기', () => {
  assert.equal(isRetryableKisError(400, undefined), false);
  assert.equal(isRetryableKisError(401, undefined), false);
  assert.equal(isRetryableKisError(403, 'EGW00133'), false);
});

test('백오프는 회차마다 2배로 늘어난다', () => {
  assert.equal(kisRetryDelayMs(0), 600);
  assert.equal(kisRetryDelayMs(1), 1200);
  assert.equal(kisRetryDelayMs(2), 2400);
});
