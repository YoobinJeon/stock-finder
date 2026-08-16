import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreQuality, QualityFinRow } from './QualityEngine';

const row = (overrides: Partial<QualityFinRow>): QualityFinRow => ({
  fiscal_year: 2025,
  roe: null,
  roa: null,
  debt_ratio: null,
  revenue: null,
  operating_income: null,
  net_income: null,
  ...overrides,
});

test('빈 rows → 중립 50점', () => {
  const result = scoreQuality([]);
  assert.equal(result.score, 50);
  assert.match(result.reasons[0], /중립\(50점\)/);
});

test('양호한 ROE·영업이익률·부채비율이 겹치면 점수가 상승한다', () => {
  const result = scoreQuality([
    row({ roe: 0.12, revenue: 1000, operating_income: 100, net_income: 90, debt_ratio: 0.6 }),
  ]);
  // 50 + 8(ROE 양호) + 5(영업이익률 10% 양호) + 8(부채비율 60% 건전) = 71
  assert.equal(result.score, 71);
  assert.ok(result.reasons.some((r) => r.includes('양호')));
  assert.ok(result.reasons.some((r) => r.includes('건전')));
});

test('ROE 경계값: 10%는 "양호"(+8), 5%는 "보통"(0), 4.9%는 "수익성 저조"(-15)', () => {
  const at10 = scoreQuality([row({ roe: 0.10 })]);
  assert.equal(at10.score, 58);
  assert.ok(at10.reasons.some((r) => r.includes('양호')));

  const at5 = scoreQuality([row({ roe: 0.05 })]);
  assert.equal(at5.score, 50);
  assert.ok(at5.reasons.some((r) => r.includes('보통')));

  const below5 = scoreQuality([row({ roe: 0.049 })]);
  assert.equal(below5.score, 35);
  assert.ok(below5.reasons.some((r) => r.includes('수익성 저조')));
});

test('적자 ROE + 영업적자 + 과다 부채가 겹치면 0점까지 클램프된다', () => {
  const result = scoreQuality([
    row({ roe: -0.05, revenue: 1000, operating_income: -50, net_income: -60, debt_ratio: 2.5 }),
  ]);
  // 50 - 25(ROE 적자) - 15(영업적자) - 15(부채 과다) = -5 → clamp 0
  assert.equal(result.score, 0);
});

test('3년 연속 ROE 10% 이상이면 꾸준한 수익성 보너스(+5)가 붙는다', () => {
  const result = scoreQuality([
    row({ fiscal_year: 2025, roe: 0.12 }),
    row({ fiscal_year: 2024, roe: 0.11 }),
    row({ fiscal_year: 2023, roe: 0.10 }),
  ]);
  // 50 + 8(ROE 양호) + 5(3년 연속 보너스) = 63
  assert.equal(result.score, 63);
  assert.ok(result.reasons.some((r) => r.includes('꾸준한 수익성')));
});

test('일회성 이익 의심 시 감점되고 ROE 보너스도 절반만 인정된다', () => {
  const result = scoreQuality([
    row({ roe: 0.20, revenue: 1000, operating_income: 50, net_income: 200, debt_ratio: 0.5 }),
  ]);
  // 50 - 10(일회성 감점) + 13(ROE 초우량 25 → 절반) + 0(영업이익률 5% 저마진) + 8(부채비율 50% 건전) = 61
  assert.equal(result.score, 61);
  assert.ok(result.reasons.some((r) => r.includes('이익의 질 낮음')));
  assert.ok(result.reasons.some((r) => r.includes('절반만 인정')));
});
