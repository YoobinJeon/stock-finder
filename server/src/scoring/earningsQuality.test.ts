import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessEarningsQuality, FinYearRow } from './earningsQuality';

const row = (fiscal_year: number, revenue: number | null, operating_income: number | null, net_income: number | null): FinYearRow =>
  ({ fiscal_year, revenue, operating_income, net_income });

test('최신 연도만 순이익>영업이익×2 이면 일회성(oneOff) 플래그', () => {
  const out = assessEarningsQuality([
    row(2025, 1000, 100, 500), // ni(500) > op(100)*2 → 급증
    row(2024, 1000, 100, 90),  // 정상
  ]);
  assert.equal(out.oneOff, true);
  assert.equal(out.structural, false);
});

test('매년 순이익>영업이익×2(영업흑자)이면 구조적 → 일회성 면제', () => {
  const out = assessEarningsQuality([
    row(2025, 1000, 100, 500),
    row(2024, 1000, 80, 400), // 과거에도 op>0 & ni>op*2 → 지주사형
  ]);
  assert.equal(out.structural, true);
  assert.equal(out.oneOff, false);
});

test('영업적자인데 순이익 흑자 → niDominates(oneOff)', () => {
  const out = assessEarningsQuality([
    row(2025, 1000, -50, 200), // op<=0 이고 ni>0 → dominates
  ]);
  assert.equal(out.oneOff, true);
});

test('정상 이익구조는 oneOff 아님', () => {
  const out = assessEarningsQuality([
    row(2025, 1000, 200, 150), // ni < op*2
  ]);
  assert.equal(out.oneOff, false);
  assert.equal(out.structural, false);
});

test('영업이익 YoY 성장률 계산 (직전 양수일 때만)', () => {
  const out = assessEarningsQuality([
    row(2025, 1000, 150, 100),
    row(2024, 1000, 100, 80),
  ]);
  assert.ok(out.opGrowth != null && Math.abs(out.opGrowth - 0.5) < 1e-9); // (150-100)/100
});

test('영업 적자→흑자 전환 감지', () => {
  const out = assessEarningsQuality([
    row(2025, 1000, 50, 40),
    row(2024, 1000, -30, -20),
  ]);
  assert.equal(out.opTurnaround, true);
  assert.equal(out.opCollapse, false);
  assert.equal(out.opGrowth, null);
});

test('영업 흑자→적자 전환 감지', () => {
  const out = assessEarningsQuality([
    row(2025, 1000, -20, -10),
    row(2024, 1000, 80, 60),
  ]);
  assert.equal(out.opCollapse, true);
  assert.equal(out.opTurnaround, false);
});

test('영업이익률 계산 (매출 양수)', () => {
  const out = assessEarningsQuality([row(2025, 1000, 250, 200)]);
  assert.ok(out.opMargin != null && Math.abs(out.opMargin - 0.25) < 1e-9);
});

test('매출 0/음수·null이면 opMargin null', () => {
  assert.equal(assessEarningsQuality([row(2025, 0, 10, 5)]).opMargin, null);
  assert.equal(assessEarningsQuality([row(2025, null, 10, 5)]).opMargin, null);
});

test('전년 없으면 성장·전환 지표 모두 기본값', () => {
  const out = assessEarningsQuality([row(2025, 1000, 100, 80)]);
  assert.equal(out.opGrowth, null);
  assert.equal(out.opTurnaround, false);
  assert.equal(out.opCollapse, false);
});
