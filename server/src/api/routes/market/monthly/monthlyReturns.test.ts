import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  START_MONTH, buildMonthlyReturns, isPartialMonth,
  monthIndexOf, monthKeyOf, monthsBetween, suspectKeyOf, type MonthEndClose,
} from './monthlyReturns';

const close = (ticker: string, ym: string, value: number): MonthEndClose =>
  ({ ticker, ym, close: value });

/** 부동소수 꼬리(0.19999999999999996)를 잘라 의도를 그대로 비교한다. */
const r10 = (v: number) => Number(v.toFixed(10));

const ret = (rows: MonthEndClose[], ticker: string): Record<string, number> =>
  Object.fromEntries(
    [...(buildMonthlyReturns(rows).get(ticker) ?? new Map<string, number>())]
      .map(([k, v]) => [k, r10(v)]),
  );

// ── 월 인덱스 ──────────────────────────────────────────────────────────────

test('월 인덱스는 연 경계를 하나로 잇는다', () => {
  assert.equal(monthIndexOf('2026-01') - monthIndexOf('2025-12'), 1);
  assert.equal(monthIndexOf('2026-03') - monthIndexOf('2026-01'), 2);
});

test('월 인덱스는 왕복해도 같다 — 한 자리 달도 0으로 채운다', () => {
  assert.equal(monthKeyOf(monthIndexOf('2026-01')), '2026-01');
  assert.equal(monthKeyOf(monthIndexOf('2025-12')), '2025-12');
});

test('monthsBetween은 양끝을 포함하고 연을 넘어간다', () => {
  assert.deepEqual(monthsBetween('2025-11', '2026-02'),
    ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(monthsBetween('2026-03', '2026-03'), ['2026-03']);
});

// ── 수익률 산출 ────────────────────────────────────────────────────────────

test('월간 수익률은 직전 달 월말 종가 대비', () => {
  const rows = [close('A', '2025-12', 1000), close('A', '2026-01', 1200)];
  assert.deepEqual(ret(rows, 'A'), { '2026-01': 0.2 });
});

test('시작월 수익률의 기준점은 전년 12월 — 연 경계를 넘어 계산된다', () => {
  const rows = [close('A', '2025-12', 500), close('A', START_MONTH, 400)];
  assert.equal(ret(rows, 'A')[START_MONTH], -0.2);
});

test('기준점이 없는 첫 달은 값을 만들지 않는다', () => {
  assert.deepEqual(ret([close('A', '2026-01', 1000)], 'A'), {});
});

test('한 달이 통째로 비면 그 다음 달도 비운다 — 두 달치를 한 달로 부르지 않는다', () => {
  // 거래정지로 2월이 빈 종목. 1월(1000) → 3월(2000)을 3월 수익률 +100%로 표시하면 거짓말이다.
  const rows = [
    close('A', '2025-12', 900), close('A', '2026-01', 1000), close('A', '2026-03', 2000),
  ];
  const out = ret(rows, 'A');
  assert.deepEqual(Object.keys(out), ['2026-01']);
  assert.equal(out['2026-03'], undefined);
});

test('갭 다음 달부터는 다시 계산된다', () => {
  const rows = [
    close('A', '2026-01', 1000), close('A', '2026-03', 2000), close('A', '2026-04', 2200),
  ];
  assert.deepEqual(ret(rows, 'A'), { '2026-04': 0.1 });
});

test('직전 달 종가가 0 이하면 계산하지 않는다 — 분모가 성립하지 않는다', () => {
  assert.deepEqual(ret([close('A', '2026-01', 0), close('A', '2026-02', 100)], 'A'), {});
});

test('종목끼리 섞이지 않는다', () => {
  const rows = [
    close('A', '2026-01', 100), close('A', '2026-02', 110),
    close('B', '2026-01', 200), close('B', '2026-02', 180),
  ];
  const all = buildMonthlyReturns(rows);
  assert.equal(r10(all.get('A')!.get('2026-02')!), 0.1);
  assert.equal(r10(all.get('B')!.get('2026-02')!), -0.1);
});

test('수익률이 하나도 없는 종목은 결과에 담지 않는다 — 빈 Map을 만들지 않는다', () => {
  const all = buildMonthlyReturns([close('A', '2026-01', 100)]);
  assert.equal(all.has('A'), false);
});

test('종가가 숫자가 아니면 건너뛴다', () => {
  const rows = [
    close('A', '2025-12', Number.NaN), close('A', '2026-01', 100), close('A', '2026-02', 120),
  ];
  assert.deepEqual(ret(rows, 'A'), { '2026-02': 0.2 });
});

// ── 기업 액션 오염 구간 제외 ───────────────────────────────────────────────

test('오염으로 표시된 (종목, 달)은 수익률을 만들지 않는다', () => {
  // 실제: 다이나믹디자인이 2026-07-24 하루 만에 224 → 2,240(×10, 액면병합 미반영)이 되어
  // 월간 +900%로 랭킹 1위에 올라 있었다. 그건 수익률이 아니라 눈금이 바뀐 것이다.
  const rows = [close('A', '2026-06', 224), close('A', '2026-07', 2240)];
  const suspects = new Set([suspectKeyOf('A', '2026-07')]);
  assert.equal(buildMonthlyReturns(rows, suspects).has('A'), false);
});

test('오염된 달만 빠지고 다른 달은 그대로 계산된다', () => {
  const rows = [
    close('A', '2026-05', 200), close('A', '2026-06', 224),
    close('A', '2026-07', 2240), close('A', '2026-08', 2464),
  ];
  const out = buildMonthlyReturns(rows, new Set([suspectKeyOf('A', '2026-07')])).get('A')!;
  assert.deepEqual([...out.keys()], ['2026-06', '2026-08']);
  assert.equal(r10(out.get('2026-08')!), 0.1, '오염 이후는 양쪽 다 새 눈금이라 정상이다');
});

test('오염 표시는 종목별로 따로 적용된다', () => {
  const rows = [
    close('A', '2026-06', 100), close('A', '2026-07', 1000),
    close('B', '2026-06', 100), close('B', '2026-07', 120),
  ];
  const all = buildMonthlyReturns(rows, new Set([suspectKeyOf('A', '2026-07')]));
  assert.equal(all.has('A'), false);
  assert.equal(r10(all.get('B')!.get('2026-07')!), 0.2);
});

test('오염 집합이 비면 아무것도 걸러지지 않는다 — 기본값이 안전한 쪽이 아니라 투명한 쪽', () => {
  const rows = [close('A', '2026-06', 224), close('A', '2026-07', 2240)];
  assert.equal(buildMonthlyReturns(rows).get('A')?.get('2026-07'), 9);
});

// ── 진행 중인 달 ───────────────────────────────────────────────────────────

test('마지막 거래일이 달의 끝에 못 미치면 진행 중', () => {
  assert.equal(isPartialMonth('2026-08', '2026-08-10'), true);
  assert.equal(isPartialMonth('2026-08', '2026-08-31'), false, '8월은 31일까지다');
  assert.equal(isPartialMonth('2026-02', '2026-02-28'), false, '2026년 2월은 28일까지다');
  assert.equal(isPartialMonth('2026-02', '2026-02-27'), true);
});

test('다른 달은 진행 중이 아니다', () => {
  assert.equal(isPartialMonth('2026-07', '2026-08-10'), false);
});
