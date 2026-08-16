import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAxis, periodIndexOf, periodFromIndex, type AxisRow } from './period';

/**
 * 축 산출은 종목별 최신 확정 눈금의 **최빈값**을 기준으로 삼으므로 ticker가 필요하고,
 * "값이 있는 눈금만 축에 넣는다"는 규칙 때문에 금액도 필요하다. 기본 매출 1로 채운다 —
 * 금액 결측 자체를 보는 테스트만 명시적으로 null을 넘긴다.
 */
const y = (
  fiscal_year: number, is_estimate: boolean, ticker = 'A', revenue: number | null = 1,
): AxisRow => ({
  ticker, fiscal_year, fiscal_quarter: null, is_estimate,
  revenue, operating_income: null, net_income: null,
});

const q = (
  fiscal_year: number, fiscal_quarter: number, is_estimate: boolean,
  ticker = 'A', revenue: number | null = 1,
): AxisRow => ({
  ticker, fiscal_year, fiscal_quarter, is_estimate,
  revenue, operating_income: null, net_income: null,
});

const keys = (rows: AxisRow[], type: 'year' | 'quarter') =>
  buildAxis(rows, type).map((p) => p.key);

// ── 인덱스 왕복 ────────────────────────────────────────────────────────────

test('분기 인덱스는 단조 증가하고 왕복해도 같다', () => {
  assert.equal(periodIndexOf(2026, 1) - periodIndexOf(2025, 4), 1, '연 경계도 1칸이다');
  assert.equal(periodIndexOf(2026, 2) - periodIndexOf(2025, 2), 4, '전년 동기는 4칸 전이다');
  assert.deepEqual(periodFromIndex(periodIndexOf(2026, 3), 'quarter'),
    { key: '2026Q3', year: 2026, quarter: 3 });
  assert.deepEqual(periodFromIndex(2026, 'year'),
    { key: '2026', year: 2026, quarter: null });
});

// ── 연간 축 ────────────────────────────────────────────────────────────────

test('연간 축은 확정 최신연도부터 최대 4개', () => {
  const rows = [y(2023, false), y(2024, false), y(2025, false), y(2026, true), y(2027, true), y(2028, true)];
  assert.deepEqual(keys(rows, 'year'), ['2025', '2026', '2027', '2028']);
});

test('전망이 적으면 있는 만큼만 — 없는 연도를 만들지 않는다', () => {
  assert.deepEqual(keys([y(2024, false), y(2025, false), y(2026, true)], 'year'), ['2025', '2026']);
  assert.deepEqual(keys([y(2025, false)], 'year'), ['2025']);
});

test('전망이 4개 이상이어도 4개로 자른다', () => {
  const rows = [y(2025, false), y(2026, true), y(2027, true), y(2028, true), y(2029, true)];
  assert.deepEqual(keys(rows, 'year'), ['2025', '2026', '2027', '2028']);
});

test('확정 행이 없으면 값이 있는 가장 이른 전망 연도부터', () => {
  assert.deepEqual(keys([y(2027, true), y(2026, true)], 'year'), ['2026', '2027']);
});

test('데이터가 없으면 빈 축', () => {
  assert.deepEqual(keys([], 'year'), []);
});

test('축은 산업 전체에 하나 — 종목별 확정연도가 달라도 최빈값으로 정한다', () => {
  const rows = [
    ...[y(2024, false, 'A'), y(2025, false, 'A'), y(2026, true, 'A')],
    ...[y(2024, false, 'B'), y(2025, false, 'B'), y(2026, true, 'B')],
    ...[y(2024, false, 'C')], // 이 종목만 2024까지
  ];
  assert.deepEqual(keys(rows, 'year'), ['2025', '2026']);
});

test('소수 종목이 앞서 마감해도 축이 끌려가지 않는다 — 최빈값이라 이상치에 견딘다', () => {
  // 실제 사고: IT서비스 109종목 중 2종목만 2026 확정인데 최댓값을 쓰는 바람에 축이 2026부터
  // 시작해 나머지 107종목의 2025 확정 실적이 화면에서 통째로 사라졌다(2026-08-11 레드팀).
  const rows: AxisRow[] = [];
  for (let i = 0; i < 20; i++) {
    rows.push(y(2025, false, `n${i}`), y(2026, true, `n${i}`), y(2027, true, `n${i}`));
  }
  rows.push(y(2026, false, 'early1'), y(2027, true, 'early1'));
  rows.push(y(2026, false, 'early2'), y(2027, true, 'early2'));
  assert.deepEqual(keys(rows, 'year'), ['2025', '2026', '2027']);
});

test('최빈값이 동률이면 더 최근 연도를 기준으로 — 앞서 마감한 쪽을 버리지 않는다', () => {
  const rows = [
    y(2025, false, 'a'), y(2026, true, 'a'),
    y(2026, false, 'b'), y(2027, true, 'b'),
  ];
  assert.deepEqual(keys(rows, 'year'), ['2026', '2027']);
});

// ── 값이 없는 눈금 배제 ────────────────────────────────────────────────────

test('아무도 값을 갖지 않은 눈금은 축에 넣지 않는다', () => {
  // 커버리지 없는 종목에도 금액이 전부 null인 빈 전망 행이 만들어져 있다(2027Q1 10건).
  const rows = [
    y(2025, false, 'a'), y(2026, true, 'a'),
    y(2027, true, 'a', null), y(2027, true, 'b', null),
  ];
  assert.deepEqual(keys(rows, 'year'), ['2025', '2026'], '2027은 유령 열이다');
});

test('한 종목이라도 값을 가지면 그 눈금은 남는다', () => {
  const rows = [
    y(2025, false, 'a'), y(2027, true, 'a', null),
    y(2025, false, 'b'), y(2027, true, 'b', 500),
  ];
  assert.deepEqual(keys(rows, 'year'), ['2025', '2027']);
});

test('값 없는 확정 행은 축 기준(base)을 정하지 못한다', () => {
  const rows = [
    y(2025, false, 'a'), y(2026, true, 'a'),
    y(2025, false, 'b'), y(2026, true, 'b'),
    y(2026, false, 'ghost', null), // 금액 없는 확정 행 — base를 끌어올리면 안 된다
  ];
  assert.deepEqual(keys(rows, 'year'), ['2025', '2026']);
});

// ── 분기 축 ────────────────────────────────────────────────────────────────

test('분기 축은 확정 4 + 전망 3 = 7칸', () => {
  const rows: AxisRow[] = [];
  for (const [yr, qt] of [[2025, 1], [2025, 2], [2025, 3], [2025, 4], [2026, 1]] as const) {
    rows.push(q(yr, qt, false));
  }
  for (const qt of [2, 3, 4] as const) rows.push(q(2026, qt, true));
  assert.deepEqual(keys(rows, 'quarter'),
    ['2025Q2', '2025Q3', '2025Q4', '2026Q1', '2026Q2', '2026Q3', '2026Q4'],
    '2025Q1은 확정 4칸 범위 밖이라 빠진다');
});

test('분기 축도 최빈값 — 조기 결산 소수 종목이 축을 끌어올리지 못한다', () => {
  // 실제 데이터: 2026Q2에 확정이 10종목 섞여 있다. 최댓값을 쓰면 축이 한 칸 밀린다.
  const rows: AxisRow[] = [];
  for (let i = 0; i < 30; i++) {
    const t = `n${i}`;
    rows.push(q(2025, 3, false, t), q(2025, 4, false, t), q(2026, 1, false, t));
    rows.push(q(2026, 2, true, t), q(2026, 3, true, t), q(2026, 4, true, t));
  }
  rows.push(q(2026, 2, false, 'early'), q(2026, 3, true, 'early'));
  const axis = keys(rows, 'quarter');
  assert.equal(axis[axis.length - 4], '2026Q1', '기준은 여전히 2026Q1이다');
  assert.deepEqual(axis.slice(-3), ['2026Q2', '2026Q3', '2026Q4']);
});

test('값 없는 미래 분기는 축에서 빠진다', () => {
  const rows: AxisRow[] = [
    q(2025, 4, false), q(2026, 1, false),
    q(2026, 2, true), q(2026, 3, true), q(2026, 4, true),
    q(2027, 1, true, 'A', null), // 금액 전부 null — 실제 DB에 10건 있다
  ];
  assert.equal(keys(rows, 'quarter').includes('2027Q1'), false);
});

test('연간 축과 분기 축은 서로의 행을 보지 않는다', () => {
  const mixed: AxisRow[] = [
    y(2025, false), y(2026, true),
    q(2026, 1, false), q(2026, 2, true),
  ];
  assert.deepEqual(keys(mixed, 'year'), ['2025', '2026']);
  assert.deepEqual(keys(mixed, 'quarter'), ['2026Q1', '2026Q2']);
});
