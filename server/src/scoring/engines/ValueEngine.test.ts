import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreValue, ValueFinRow } from './ValueEngine';

const row = (overrides: Partial<ValueFinRow>): ValueFinRow => ({
  fiscal_year: 2025,
  per: null,
  pbr: null,
  div_yield: null,
  ev_ebitda: null,
  revenue: 1_000_000_000_000,
  operating_income: 100_000_000_000,
  net_income: 90_000_000_000,
  ...overrides,
});

test('빈 rows → 중립 50점', () => {
  const result = scoreValue([]);
  assert.equal(result.score, 50);
  assert.equal(result.reasons.length, 1);
  assert.match(result.reasons[0], /중립\(50점\)/);
});

test('저PER(<=8)이면 점수가 50점 위로 올라간다', () => {
  const result = scoreValue([row({ per: 6 })]);
  assert.equal(result.score, 70); // 50 + 20
  assert.ok(result.reasons.some((r) => r.includes('크게 저평가')));
});

test('PER 경계값 8은 "크게 저평가"(+20), 15는 "저평가 구간"(+10)', () => {
  const at8 = scoreValue([row({ per: 8 })]);
  assert.equal(at8.score, 70);
  assert.ok(at8.reasons.some((r) => r.includes('크게 저평가')));

  const at15 = scoreValue([row({ per: 15 })]);
  assert.equal(at15.score, 60);
  assert.ok(at15.reasons.some((r) => r.includes('저평가 구간')));
});

test('적자 기업(PER<0)은 감점', () => {
  const result = scoreValue([row({ per: -3 })]);
  assert.equal(result.score, 35); // 50 - 15
  assert.ok(result.reasons.some((r) => r.includes('적자 기업')));
});

test('여러 지표가 모두 저평가 방향이면 100점 상한에서 클램프된다', () => {
  const result = scoreValue([
    row({ per: 5, pbr: 0.5, div_yield: 0.05, ev_ebitda: 5 }),
  ]);
  // 50 + 20(PER) + 15(PBR) + 10(배당) + 10(EV/EBITDA) = 105 → clamp 100
  assert.equal(result.score, 100);
});

test('일회성 이익 의심 시 경고 근거와 PER 보너스 제한이 반영된다', () => {
  const rows: ValueFinRow[] = [
    row({ fiscal_year: 2025, per: 10, operating_income: 50_000_000_000, net_income: 200_000_000_000 }),
    row({ fiscal_year: 2024, operating_income: 50_000_000_000, net_income: 45_000_000_000 }),
    row({ fiscal_year: 2023, operating_income: 45_000_000_000, net_income: 40_000_000_000 }),
  ];
  const result = scoreValue(rows);
  assert.ok(result.reasons.some((r) => r.includes('일회성 이익 의심')));
  assert.ok(result.reasons.some((r) => r.includes('일회성 이익 왜곡 가능')));
  assert.equal(result.score, 55); // 50 + 5 (oneOff PER<=15 제한 보너스)
});

test('모든 지표가 고평가/적자 방향이어도 0 미만으로 내려가지 않는다', () => {
  const result = scoreValue([row({ per: -3, pbr: 5, ev_ebitda: 30 })]);
  // 50 - 15(PER 적자) - 5(PBR 프리미엄) - 5(EV/EBITDA 고평가) = 25
  assert.equal(result.score, 25);
  assert.ok(result.score >= 0);
});
