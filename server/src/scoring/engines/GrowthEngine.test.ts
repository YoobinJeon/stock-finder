import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreGrowth, GrowthFinRow } from './GrowthEngine';

test('빈 rows → 중립 50점', () => {
  const result = scoreGrowth([]);
  assert.equal(result.score, 50);
  assert.match(result.reasons[0], /중립\(50점\)/);
});

test('성장 데이터 없음이면 데이터 없음 근거만 남고 50점 유지 (단일 연도, 비교 불가)', () => {
  const rows: GrowthFinRow[] = [
    { fiscal_year: 2025, revenue: 1000, revenue_growth: null, eps_growth: null, operating_income: 100, net_income: 90 },
  ];
  const result = scoreGrowth(rows);
  assert.equal(result.score, 50);
  assert.ok(result.reasons.some((r) => r.includes('매출 성장률 데이터 없음')));
  assert.ok(result.reasons.some((r) => r.includes('EPS 성장률 데이터 없음')));
});

test('견조한 매출·영업이익·EPS 성장이 겹치면 점수가 상승한다', () => {
  const rows: GrowthFinRow[] = [
    { fiscal_year: 2025, revenue: 1000, revenue_growth: 0.12, eps_growth: 0.12, operating_income: 110, net_income: 95 },
    { fiscal_year: 2024, revenue: 890,  revenue_growth: 0.05, eps_growth: null,  operating_income: 100, net_income: 90 },
    { fiscal_year: 2023, revenue: 850,  revenue_growth: null, eps_growth: null,  operating_income: 95,  net_income: 88 },
  ];
  const result = scoreGrowth(rows);
  // 50 + (10 견조한 성장 + 5 연속성장 보너스) + 6 영업이익 성장 + 8 이익 성장 = 79
  assert.equal(result.score, 79);
  assert.ok(result.reasons.some((r) => r.includes('견조한 성장')));
  assert.ok(result.reasons.some((r) => r.includes('영업이익 성장')));
  assert.ok(result.reasons.some((r) => r.includes('이익 성장')));
});

test('역성장 + 영업이익 적자전환 + 이익 감소가 겹치면 점수가 크게 떨어진다', () => {
  const rows: GrowthFinRow[] = [
    { fiscal_year: 2025, revenue: 800, revenue_growth: -0.20, eps_growth: -0.30, operating_income: -50, net_income: -60 },
    { fiscal_year: 2024, revenue: 1000, revenue_growth: 0.05, eps_growth: null, operating_income: 120, net_income: 100 },
  ];
  const result = scoreGrowth(rows);
  // 50 - 15(역성장) - 10(영업이익 적자전환) - 15(이익 감소) = 10
  assert.equal(result.score, 10);
  assert.ok(result.reasons.some((r) => r.includes('역성장')));
  assert.ok(result.reasons.some((r) => r.includes('본업 악화')));
  assert.ok(result.reasons.some((r) => r.includes('이익 감소')));
  assert.ok(result.score >= 0);
});

test('여러 지표가 모두 고성장이면 100점 상한에서 클램프된다', () => {
  const rows: GrowthFinRow[] = [
    { fiscal_year: 2025, revenue: 1000, revenue_growth: 0.35, eps_growth: 0.35, operating_income: 150, net_income: 130 },
    { fiscal_year: 2024, revenue: 800,  revenue_growth: 0.10, eps_growth: null,  operating_income: 100, net_income: 90 },
    { fiscal_year: 2023, revenue: 700,  revenue_growth: null, eps_growth: null,  operating_income: 90,  net_income: 85 },
  ];
  const result = scoreGrowth(rows);
  assert.equal(result.score, 100);
});

test('기저효과 반등: 2년 전보다 매출이 여전히 낮으면 성장 보너스가 절반으로 깎인다', () => {
  const rows: GrowthFinRow[] = [
    { fiscal_year: 2025, revenue: 700, revenue_growth: 0.20, eps_growth: null, operating_income: 100, net_income: 90 },
    { fiscal_year: 2024, revenue: 650, revenue_growth: 0.10, eps_growth: null, operating_income: 95,  net_income: 85 },
    { fiscal_year: 2023, revenue: 900, revenue_growth: null, eps_growth: null, operating_income: 90,  net_income: 80 },
  ];
  const result = scoreGrowth(rows);
  // 50 + 9(18 높은 성장 → 기저효과로 절반) + 2(영업이익 유지) = 61
  assert.equal(result.score, 61);
  assert.ok(result.reasons.some((r) => r.includes('기저효과 반등')));
});

test('일회성 이익이면 EPS 성장은 불인정(가점 0)으로 처리된다', () => {
  const rows: GrowthFinRow[] = [
    { fiscal_year: 2025, revenue: 1000, revenue_growth: 0.05, eps_growth: 0.40, operating_income: 50, net_income: 200 },
    { fiscal_year: 2024, revenue: 950,  revenue_growth: 0.02, eps_growth: null,  operating_income: 48, net_income: 44 },
    { fiscal_year: 2023, revenue: 900,  revenue_growth: null, eps_growth: null,  operating_income: 45, net_income: 40 },
  ];
  const result = scoreGrowth(rows);
  // 50 + (3 완만한 성장 + 5 연속성장 보너스) + 2(영업이익 유지) + 0(EPS 불인정) = 60
  assert.equal(result.score, 60);
  assert.ok(result.reasons.some((r) => r.includes('일회성(영업외) 이익 기인')));
});
