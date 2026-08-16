import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachMetrics, hasUsableEstimate, multipleOf, ttmSum, type FinancialRow } from './metrics';
import { buildAxis, periodIndexOf, type AxisRow, type PeriodKey } from './period';

const row = (
  fiscal_year: number, is_estimate: boolean,
  revenue: number | null, operating_income: number | null, net_income: number | null,
): FinancialRow => ({
  fiscal_year, fiscal_quarter: null, is_estimate, revenue, operating_income, net_income,
});

const qrow = (
  fiscal_year: number, fiscal_quarter: number, is_estimate: boolean,
  revenue: number | null, operating_income: number | null, net_income: number | null,
): FinancialRow => ({
  fiscal_year, fiscal_quarter, is_estimate, revenue, operating_income, net_income,
});

/** 테스트용 축 — 검사하려는 눈금만 직접 나열한다(축 산출은 period.test.ts가 본다). */
const yearAxis = (...years: number[]): PeriodKey[] =>
  years.map((y) => ({ key: String(y), year: y, quarter: null }));

const quarterAxis = (...labels: string[]): PeriodKey[] =>
  labels.map((l) => {
    const [y, q] = l.split('Q');
    return { key: l, year: Number(y), quarter: Number(q) };
  });

// ── 연간 ───────────────────────────────────────────────────────────────────

test('연간 증가율은 직전 연도 대비로 붙는다', () => {
  const rows = [row(2025, false, 1000, 100, 80), row(2026, true, 1200, 150, 100)];
  const out = attachMetrics(rows, yearAxis(2025, 2026), 'year');
  assert.equal(out['2026'].yoy.revenue.growth, 0.2);
  assert.equal(out['2026'].yoy.operatingIncome.growth, 0.5);
  assert.equal(out['2026'].yoy.netIncome.growth, 0.25);
  assert.equal(out['2026'].isEstimate, true);
  assert.equal(out['2026'].opMargin, 0.125);
  assert.equal(out['2026'].qoq, null, '연간 축에 직전 분기는 없다');
});

test('축 첫 해도 축 밖 직전 연도가 있으면 증가율이 나온다', () => {
  const rows = [row(2024, false, 800, 50, 40), row(2025, false, 1000, 100, 80)];
  const out = attachMetrics(rows, yearAxis(2025), 'year');
  assert.equal(out['2025'].yoy.revenue.growth, 0.25);
  assert.equal(out['2024'], undefined, '축 밖 연도는 결과에 담지 않는다');
});

test('직전 연도가 없으면 증가율 null', () => {
  const out = attachMetrics([row(2025, false, 1000, 100, 80)], yearAxis(2025), 'year');
  assert.equal(out['2025'].yoy.revenue.growth, null);
  assert.equal(out['2025'].yoy.operatingIncome.growth, null);
  assert.equal(out['2025'].yoy.operatingIncome.turnaround, false);
});

test('적자→흑자는 증가율 null + 턴어라운드 true', () => {
  const rows = [row(2025, false, 1000, -50, -30), row(2026, true, 1200, 80, 60)];
  const out = attachMetrics(rows, yearAxis(2025, 2026), 'year');
  assert.equal(out['2026'].yoy.operatingIncome.growth, null, '분모가 음수라 백분율이 성립하지 않는다');
  assert.equal(out['2026'].yoy.operatingIncome.turnaround, true);
  assert.equal(out['2026'].yoy.netIncome.turnaround, true);
  assert.equal(out['2026'].yoy.revenue.growth, 0.2, '매출은 정상이므로 증가율이 나온다');
});

test('연도가 중간에 비어도 그 해만 빠진다', () => {
  const rows = [row(2025, false, 1000, 100, 80), row(2027, true, 1500, 200, 160)];
  const out = attachMetrics(rows, yearAxis(2025, 2026, 2027), 'year');
  assert.equal(out['2026'], undefined);
  assert.equal(out['2027'].yoy.revenue.growth, null, '2026이 없으니 2027 증가율은 계산 불가');
});

test('매출이 0이면 영업이익률 null — 0으로 나누지 않는다', () => {
  const out = attachMetrics([row(2025, false, 0, 100, 80)], yearAxis(2025), 'year');
  assert.equal(out['2025'].opMargin, null);
});

test('연간 PER·POR은 그 해 이익 기준', () => {
  const out = attachMetrics([row(2025, false, 1000, 100, 50)], yearAxis(2025), 'year', 1000);
  assert.equal(out['2025'].per, 20);
  assert.equal(out['2025'].por, 10);
});

test('이익이 0 이하면 배수가 성립하지 않는다', () => {
  assert.equal(multipleOf(1000, 0), null);
  assert.equal(multipleOf(1000, -50), null);
  assert.equal(multipleOf(null, 50), null);
  assert.equal(multipleOf(0, 50), null, '시총 0은 값이 아니라 결측이다');
});

// ── 분기 ───────────────────────────────────────────────────────────────────

const FOUR_QUARTERS: FinancialRow[] = [
  qrow(2025, 2, false, 100, 10, 5),
  qrow(2025, 3, false, 110, 12, 6),
  qrow(2025, 4, false, 120, 14, 7),
  qrow(2026, 1, false, 130, 16, 8),
];

test('분기 YoY는 4분기 전, QoQ는 1분기 전 기준', () => {
  const rows = [...FOUR_QUARTERS, qrow(2026, 2, true, 200, 30, 20)];
  const out = attachMetrics(rows, quarterAxis('2026Q2'), 'quarter');
  const cell = out['2026Q2'];
  assert.equal(cell.yoy.revenue.growth, 1, '2025Q2 100 → 200이면 +100%');
  assert.equal(cell.qoq?.revenue.growth, (200 - 130) / 130, '2026Q1 130 대비');
  assert.equal(cell.yoy.netIncome.growth, 3, '5 → 20');
});

test('분기 축 첫 칸도 축 밖 과거를 기준으로 YoY가 나온다', () => {
  const rows = [qrow(2025, 2, false, 100, 10, 5), qrow(2026, 2, false, 150, 15, 9)];
  const out = attachMetrics(rows, quarterAxis('2026Q2'), 'quarter');
  assert.equal(out['2026Q2'].yoy.revenue.growth, 0.5);
  assert.equal(out['2025Q2'], undefined, '축 밖 분기는 결과에 담지 않는다');
});

test('전년 동기가 없으면 YoY만 비고 QoQ는 나온다', () => {
  const rows = [qrow(2026, 1, false, 130, 16, 8), qrow(2026, 2, true, 260, 32, 16)];
  const out = attachMetrics(rows, quarterAxis('2026Q2'), 'quarter');
  assert.equal(out['2026Q2'].yoy.revenue.growth, null);
  assert.equal(out['2026Q2'].qoq?.revenue.growth, 1);
});

test('분기 적자→흑자도 YoY·QoQ 각각 판정된다', () => {
  const rows = [
    qrow(2025, 2, false, 100, -10, -8),
    qrow(2026, 1, false, 120, -5, -4),
    qrow(2026, 2, false, 150, 20, 15),
  ];
  const out = attachMetrics(rows, quarterAxis('2026Q2'), 'quarter');
  assert.equal(out['2026Q2'].yoy.operatingIncome.turnaround, true);
  assert.equal(out['2026Q2'].qoq?.operatingIncome.turnaround, true);
  assert.equal(out['2026Q2'].yoy.operatingIncome.growth, null);
});

// ── TTM ────────────────────────────────────────────────────────────────────

const byIndex = (rows: FinancialRow[]) =>
  new Map(rows.map((r) => [periodIndexOf(r.fiscal_year, r.fiscal_quarter), r]));

test('TTM은 그 분기 포함 직전 4분기 합', () => {
  const m = byIndex(FOUR_QUARTERS);
  assert.equal(ttmSum(m, periodIndexOf(2026, 1), (r) => r.revenue), 460);
  assert.equal(ttmSum(m, periodIndexOf(2026, 1), (r) => r.net_income), 26);
});

test('네 분기 중 하나라도 행이 없으면 TTM은 null', () => {
  const m = byIndex(FOUR_QUARTERS.filter((r) => r.fiscal_quarter !== 3));
  assert.equal(ttmSum(m, periodIndexOf(2026, 1), (r) => r.revenue), null);
});

test('네 분기 중 하나라도 값이 null이면 TTM은 null — 순이익 결측 구간이 그렇다', () => {
  // 실제: 2024년 이하 분기는 DART 백필분이라 순이익이 없다. 그 구간을 포함한 TTM PER은 빈다.
  const rows = [
    qrow(2025, 2, false, 100, 10, null),
    ...FOUR_QUARTERS.slice(1),
  ];
  const m = byIndex(rows);
  assert.equal(ttmSum(m, periodIndexOf(2026, 1), (r) => r.net_income), null);
  assert.equal(ttmSum(m, periodIndexOf(2026, 1), (r) => r.revenue), 460, '매출은 다 있으므로 나온다');
});

test('분기 PER·POR은 TTM 기준 — 분기 이익을 그대로 쓰지 않는다', () => {
  const rows = [...FOUR_QUARTERS];
  const out = attachMetrics(rows, quarterAxis('2026Q1'), 'quarter', 520);
  assert.equal(out['2026Q1'].per, 20, '시총 520 ÷ TTM 순이익 26');
  assert.equal(out['2026Q1'].por, 10, '시총 520 ÷ TTM 영업이익 52');
  assert.notEqual(out['2026Q1'].per, 520 / 8, '그 분기 순이익(8)으로 나누면 안 된다');
});

test('선행 TTM은 확정과 전망을 섞어 합산한다', () => {
  const rows = [
    qrow(2025, 4, false, 120, 14, 7),
    qrow(2026, 1, false, 130, 16, 8),
    qrow(2026, 2, true, 140, 18, 9),
    qrow(2026, 3, true, 150, 20, 10),
  ];
  const out = attachMetrics(rows, quarterAxis('2026Q3'), 'quarter', 340);
  assert.equal(out['2026Q3'].per, 10, '7+8+9+10 = 34');
});

// ── 커버리지 판정 ──────────────────────────────────────────────────────────

test('빈 전망 행은 커버리지로 세지 않는다 — 금액이 전부 null이면 전망이 아니다', () => {
  const empty = attachMetrics(
    [row(2025, false, 1000, 100, 80), row(2026, true, null, null, null)],
    yearAxis(2025, 2026), 'year',
  );
  assert.equal(hasUsableEstimate(empty), false);

  const real = attachMetrics(
    [row(2025, false, 1000, 100, 80), row(2026, true, 1200, null, null)],
    yearAxis(2025, 2026), 'year',
  );
  assert.equal(hasUsableEstimate(real), true, '한 항목만 있어도 전망이다');
});

test('확정만 있으면 전망 보유가 아니다', () => {
  const out = attachMetrics([row(2025, false, 1000, 100, 80)], yearAxis(2025), 'year');
  assert.equal(hasUsableEstimate(out), false);
});

// ── 축 산출과 붙였을 때 ────────────────────────────────────────────────────

test('축이 잡히지 않은 눈금의 값은 응답에 들어가지 않는다', () => {
  const axisRows: AxisRow[] = [
    { ticker: 'A', fiscal_year: 2025, fiscal_quarter: null, is_estimate: false, revenue: 1000, operating_income: 100, net_income: 80 },
    { ticker: 'A', fiscal_year: 2026, fiscal_quarter: null, is_estimate: true, revenue: 1200, operating_income: 150, net_income: 100 },
  ];
  const axis = buildAxis(axisRows, 'year');
  const out = attachMetrics(
    [...axisRows as FinancialRow[], row(2020, false, 1, 1, 1)],
    axis, 'year',
  );
  assert.deepEqual(Object.keys(out).sort(), ['2025', '2026']);
});
