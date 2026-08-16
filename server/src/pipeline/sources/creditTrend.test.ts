import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nullifyInteriorZeroRuns, type CreditTrendPoint } from './creditTrend';

// ── nullifyInteriorZeroRuns: 원천의 간헐적 "구간 통째로 0" 결함 방어 ──
// 2026-07-26 실측(010120): 동일 요청이 회차에 따라 2026-06-09~06-26을 정상값과 "0"으로 오갔다.

/** 잔고수량만 지정해 추이 1건을 만드는 헬퍼 — 나머지 필드는 잔고에 맞춰 채운다 */
function pt(date: string, remainQty: number | null): CreditTrendPoint {
  const zero = remainQty === 0;
  return {
    date,
    currentPrice: 10000,
    priceChange: 0,
    volume: 1000,
    newQty: zero ? 0 : 100,
    repaidQty: zero ? 0 : 50,
    remainQty,
    remainAmt: remainQty == null ? null : remainQty * 1000,
    changeQty: zero ? 0 : 10,
    shareRatio: zero ? 0 : 1.5,
    remainRatio: zero ? 0 : 0.9,
    settlementDate: date,
    shortRemainQty: zero ? 0 : 5,
    shortRemainRatio: 0,
  };
}

test('앞뒤에 잔고가 있는 내부 0 구간은 결측(null)으로 바꾼다', () => {
  const input = [pt('2026-07-01', 1660000), pt('2026-06-11', 0), pt('2026-06-10', 0), pt('2026-06-01', 1360000)];

  const out = nullifyInteriorZeroRuns(input);

  assert.deepEqual(out.map((p) => p.remainQty), [1660000, null, null, 1360000]);
  assert.deepEqual(out.map((p) => p.remainAmt), [1660000000, null, null, 1360000000]);
  assert.deepEqual(out.map((p) => p.remainRatio), [0.9, null, null, 0.9]);
  assert.deepEqual(out.map((p) => p.newQty), [100, null, null, 100]);
});

test('입력 배열과 원소를 변형하지 않는다 (불변)', () => {
  const input = [pt('2026-07-01', 1000), pt('2026-06-11', 0), pt('2026-06-01', 2000)];

  const out = nullifyInteriorZeroRuns(input);

  assert.equal(input[1].remainQty, 0, '원본 유지');
  assert.notEqual(out, input);
  assert.notEqual(out[1], input[1]);
});

test('잔고가 한 번도 없는 종목(전 구간 0)은 그대로 둔다 — 실제 무잔고', () => {
  const input = [pt('2026-07-01', 0), pt('2026-06-11', 0), pt('2026-06-01', 0)];

  assert.deepEqual(nullifyInteriorZeroRuns(input).map((p) => p.remainQty), [0, 0, 0]);
});

test('선행 0(신용 개시 이전)과 후행 0(잔고 소멸 이후)은 그대로 둔다', () => {
  // 최신순 정렬: 앞쪽 0 = 최근 잔고 소멸, 뒤쪽 0 = 과거 개시 이전
  const input = [pt('2026-07-01', 0), pt('2026-06-11', 5000), pt('2026-06-01', 0)];

  assert.deepEqual(nullifyInteriorZeroRuns(input).map((p) => p.remainQty), [0, 5000, 0]);
});

test('정렬 방향과 무관하게 동작한다 (과거순 입력)', () => {
  const input = [pt('2026-06-01', 1360000), pt('2026-06-10', 0), pt('2026-07-01', 1660000)];

  assert.deepEqual(nullifyInteriorZeroRuns(input).map((p) => p.remainQty), [1360000, null, 1660000]);
});

test('0 구간이 없으면 값이 그대로 유지된다', () => {
  const input = [pt('2026-07-01', 100), pt('2026-06-11', 200), pt('2026-06-01', 300)];

  assert.deepEqual(nullifyInteriorZeroRuns(input).map((p) => p.remainQty), [100, 200, 300]);
});

test('잔고가 null인 행은 0 구간 판정에 쓰이지 않는다', () => {
  const input = [pt('2026-07-01', 1000), pt('2026-06-11', null), pt('2026-06-01', 2000)];

  assert.deepEqual(nullifyInteriorZeroRuns(input).map((p) => p.remainQty), [1000, null, 2000]);
});
