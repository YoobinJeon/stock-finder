import { test } from 'node:test';
import assert from 'node:assert/strict';
// 클라이언트 순수 함수를 서버 러너로 검증 (clientSort.test.ts와 같은 방식).
import {
  periodKindOf, periodHeaderLabel, periodLabel, deltaOf, METRICS,
  type Deltas, type OutlookItem, type OutlookPeriod,
} from '../../../client/src/pages/outlook/outlookTypes';

const NO_DELTA: Deltas = {
  revenue: { growth: null, turnaround: false },
  operatingIncome: { growth: null, turnaround: false },
  netIncome: { growth: null, turnaround: false },
};

const cell = (isEstimate: boolean, overrides: Partial<OutlookPeriod> = {}): OutlookPeriod => ({
  key: '2026', year: 2026, quarter: null, isEstimate,
  revenue: 1, operatingIncome: 1, netIncome: 1,
  yoy: NO_DELTA, qoq: null, opMargin: null, per: null, por: null,
  ...overrides,
});

const item = (name: string, periods: Record<string, OutlookPeriod>): OutlookItem => ({
  ticker: name, name, market: 'KOSPI', marketCap: 1, totalScore: null, periods, hasEstimate: false,
});

test('모두 확정이면 actual', () => {
  const items = [item('a', { '2025': cell(false) }), item('b', { '2025': cell(false) })];
  assert.equal(periodKindOf(items, '2025'), 'actual');
});

test('모두 전망이면 estimate', () => {
  const items = [item('a', { '2027': cell(true) }), item('b', { '2027': cell(true) })];
  assert.equal(periodKindOf(items, '2027'), 'estimate');
});

test('하나라도 섞이면 mixed — 결산이 앞선 종목이 끼어드는 실제 상황', () => {
  const items = [
    item('보통', { '2026': cell(true) }),
    item('보통2', { '2026': cell(true) }),
    item('조기결산', { '2026': cell(false) }),
  ];
  assert.equal(periodKindOf(items, '2026'), 'mixed');
});

test('그 눈금에 값이 아무도 없으면 null', () => {
  assert.equal(periodKindOf([item('a', { '2025': cell(false) })], '2028'), null);
  assert.equal(periodKindOf([], '2025'), null);
});

test('값이 없는 종목은 판정에 끼어들지 않는다', () => {
  const items = [item('a', { '2025': cell(false) }), item('b', {})];
  assert.equal(periodKindOf(items, '2025'), 'actual');
});

test('분기 열도 값에서 판정한다 — 2026Q2에 확정이 섞인 실제 상황', () => {
  const items = [
    item('보통', { '2026Q2': cell(true, { key: '2026Q2', quarter: 2 }) }),
    item('조기결산', { '2026Q2': cell(false, { key: '2026Q2', quarter: 2 }) }),
  ];
  assert.equal(periodKindOf(items, '2026Q2'), 'mixed');
});

// ── 열 머리 표기 ───────────────────────────────────────────────────────────

test('연간은 네 자리, 분기는 두 자리 연도 + 분기', () => {
  assert.equal(periodLabel({ key: '2026', year: 2026, quarter: null }), '2026');
  assert.equal(periodLabel({ key: '2026Q2', year: 2026, quarter: 2 }), '26Q2');
});

test('확정·전망은 머리에 A/E로, 혼재면 붙이지 않는다', () => {
  const p = { key: '2026Q1', year: 2026, quarter: 1 };
  assert.equal(periodHeaderLabel(p, 'actual'), '26Q1A');
  assert.equal(periodHeaderLabel(p, 'estimate'), '26Q1E');
  assert.equal(periodHeaderLabel(p, 'mixed'), '26Q1', '혼재 열은 단정하지 않는다');
  assert.equal(periodHeaderLabel(p, null), '26Q1');
});

// ── 증가율 선택 ────────────────────────────────────────────────────────────

const REVENUE = METRICS[0];
const PER = METRICS[3];

test('연간 눈금에 QoQ를 물으면 null — 없는 기준을 지어내지 않는다', () => {
  const c = cell(false);
  assert.deepEqual(deltaOf(REVENUE, c, 'yoy'), NO_DELTA.revenue);
  assert.equal(deltaOf(REVENUE, c, 'qoq'), null);
});

test('분기 눈금은 두 기준 모두 답한다', () => {
  const qoq: Deltas = {
    revenue: { growth: 0.1, turnaround: false },
    operatingIncome: { growth: null, turnaround: true },
    netIncome: { growth: -0.2, turnaround: false },
  };
  const c = cell(true, { key: '2026Q2', quarter: 2, qoq });
  assert.equal(deltaOf(REVENUE, c, 'qoq')?.growth, 0.1);
  assert.equal(deltaOf(REVENUE, c, 'yoy')?.growth, null);
});

test('배수 항목은 증가율이 없다', () => {
  assert.equal(deltaOf(PER, cell(false), 'yoy'), null);
});
