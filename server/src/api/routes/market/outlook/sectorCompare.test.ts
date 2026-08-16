import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_SAMPLES_FOR_CELL, aggregateCell, buildCompareRow, buildCompareRows, valueOf,
} from './sectorCompare';
import type { OutlookPeriod } from './metrics';
import type { PeriodKey } from './period';

const AXIS: PeriodKey[] = [
  { key: '2026', year: 2026, quarter: null },
  { key: '2027', year: 2027, quarter: null },
];

const noDelta = { growth: null, turnaround: false };

function period(key: string, over: Partial<OutlookPeriod> = {}): OutlookPeriod {
  return {
    key,
    year: Number(key.slice(0, 4)),
    quarter: null,
    isEstimate: true,
    revenue: null,
    operatingIncome: null,
    netIncome: null,
    yoy: { revenue: noDelta, operatingIncome: noDelta, netIncome: noDelta },
    qoq: null,
    opMargin: null,
    per: null,
    por: null,
    ...over,
  };
}

/** 매출 YoY만 채운 종목 하나. */
function stock(growthByKey: Record<string, number | null>, hasEstimate = true) {
  const periods: Record<string, OutlookPeriod> = {};
  for (const [key, growth] of Object.entries(growthByKey)) {
    periods[key] = period(key, {
      yoy: { revenue: { growth, turnaround: false }, operatingIncome: noDelta, netIncome: noDelta },
    });
  }
  return { periods, hasEstimate };
}

test('항목 값 꺼내기 — 금액은 증가율, 배수는 배수 자체', () => {
  const p = period('2026', {
    yoy: {
      revenue: { growth: 0.2, turnaround: false },
      operatingIncome: { growth: 0.5, turnaround: false },
      netIncome: noDelta,
    },
    per: 12.5,
    por: 8,
  });
  assert.equal(valueOf(p, 'revenue', 'yoy'), 0.2);
  assert.equal(valueOf(p, 'operatingIncome', 'yoy'), 0.5);
  assert.equal(valueOf(p, 'netIncome', 'yoy'), null);
  assert.equal(valueOf(p, 'per', 'yoy'), 12.5);
  assert.equal(valueOf(p, 'por', 'yoy'), 8);
});

test('연간 축에서 QoQ를 물으면 값을 지어내지 않고 비운다', () => {
  const p = period('2026', {
    yoy: { revenue: { growth: 0.2, turnaround: false }, operatingIncome: noDelta, netIncome: noDelta },
    qoq: null,
  });
  assert.equal(valueOf(p, 'revenue', 'qoq'), null, 'yoy로 조용히 대체하면 라벨이 거짓말이 된다');
});

test('배수 항목은 기준(yoy/qoq)과 무관하게 같은 값', () => {
  const p = period('2026', { per: 10 });
  assert.equal(valueOf(p, 'per', 'qoq'), 10);
});

test('표본이 최소치에 못 미치면 칸을 만들지 않는다', () => {
  assert.equal(MIN_SAMPLES_FOR_CELL, 2);
  assert.equal(aggregateCell([]), null);
  assert.equal(aggregateCell([0.3]), null, '1종목은 산업 대표값이 아니라 그 종목 자체다');
  assert.deepEqual(aggregateCell([0.1, 0.3]), { median: 0.2, count: 2 });
});

test('중앙값은 한 종목의 극단값에 끌려가지 않는다 — 합계 대신 중앙값을 쓰는 이유', () => {
  const cell = aggregateCell([0.05, 0.06, 0.07, 12])!;
  assert.equal(Number(cell.median.toFixed(10)), 0.065);
  assert.equal(cell.count, 4);
});

test('산업 행 — 눈금마다 값을 가진 종목만 세어 중앙값을 낸다', () => {
  const row = buildCompareRow({
    sector: '반도체',
    totalCount: 10,
    items: [
      stock({ 2026: 0.1, 2027: 0.3 }),
      stock({ 2026: 0.3, 2027: 0.5 }),
      stock({ 2026: null, 2027: 0.4 }), // 2026은 값이 없다
    ],
  }, AXIS, 'yoy');

  assert.equal(row.cells['2026'].revenue!.count, 2);
  assert.equal(Number(row.cells['2026'].revenue!.median.toFixed(10)), 0.2);
  assert.equal(row.cells['2027'].revenue!.count, 3);
  assert.equal(Number(row.cells['2027'].revenue!.median.toFixed(10)), 0.4);
});

test('커버리지 — 분모는 활성 종목 수, 분자는 쓸 만한 전망을 가진 종목 수', () => {
  const row = buildCompareRow({
    sector: '반도체',
    totalCount: 166,
    items: [stock({ 2026: 0.1 }), stock({ 2026: 0.2 }, false)],
  }, AXIS, 'yoy');
  assert.equal(row.totalCount, 166);
  assert.equal(row.coveredCount, 1);
});

test('축에 없는 눈금은 결과에 넣지 않는다', () => {
  const row = buildCompareRow({
    sector: '반도체',
    totalCount: 3,
    items: [stock({ 2025: 0.1, 2026: 0.2 }), stock({ 2025: 0.3, 2026: 0.4 })],
  }, AXIS, 'yoy');
  assert.equal(row.cells['2025'], undefined, '축이 곧 열이다 — 축 밖 눈금이 새면 열이 어긋난다');
  assert.ok(row.cells['2026']);
});

test('NaN·Infinity는 표본에 넣지 않는다', () => {
  const row = buildCompareRow({
    sector: '반도체',
    totalCount: 3,
    items: [stock({ 2026: Infinity }), stock({ 2026: 0.2 }), stock({ 2026: NaN })],
  }, AXIS, 'yoy');
  assert.equal(row.cells['2026'], undefined, '유효 표본이 1개뿐이라 칸이 없어야 한다');
});

test('값이 하나도 없는 산업은 행을 만들지 않는다', () => {
  const rows = buildCompareRows([
    { sector: '빈산업', totalCount: 4, items: [stock({ 2026: null })] },
    { sector: '반도체', totalCount: 4, items: [stock({ 2026: 0.1 }), stock({ 2026: 0.2 })] },
  ], AXIS, 'yoy');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sector, '반도체');
});
