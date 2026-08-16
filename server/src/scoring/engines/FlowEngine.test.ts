import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreFlow, FlowIndicatorRow } from './FlowEngine';

const NEUTRAL: FlowIndicatorRow = {
  foreign_amt_5d: null, foreign_amt_20d: null, inst_amt_5d: null, inst_amt_20d: null,
  foreign_buy_streak: null, inst_buy_streak: null, obv_trend: null,
};

test('수급 컬럼이 전부 null이면 중립(50점) + dataMissing', () => {
  const result = scoreFlow(NEUTRAL);
  assert.equal(result.score, 50);
  assert.equal(result.dataMissing, true);
  assert.match(result.reasons[0], /수급 데이터 없음/);
});

test('indicators 자체가 undefined/null이어도 dataMissing 처리', () => {
  assert.equal(scoreFlow(null).dataMissing, true);
  assert.equal(scoreFlow(undefined).dataMissing, true);
});

test('외인·기관 쌍끌이(5·20일 모두 순매수)면 +12', () => {
  const result = scoreFlow({
    ...NEUTRAL,
    foreign_amt_5d: 1_000_000, foreign_amt_20d: 3_000_000,
    inst_amt_5d: 500_000, inst_amt_20d: 1_500_000,
  });
  assert.equal(result.score, 62);
  assert.ok(result.reasons.some((r) => r.includes('쌍끌이')));
});

test('외인만 순매수(기관 미동반)면 +6', () => {
  const result = scoreFlow({
    ...NEUTRAL,
    foreign_amt_5d: 1_000_000, foreign_amt_20d: 3_000_000,
    inst_amt_5d: -500_000, inst_amt_20d: 1_500_000,
  });
  assert.equal(result.score, 56);
  assert.ok(result.reasons.some((r) => r.includes('외인 매수 우위')));
});

test('기관만 순매수(외인 미동반)면 +6', () => {
  const result = scoreFlow({
    ...NEUTRAL,
    foreign_amt_5d: -1_000_000, foreign_amt_20d: 3_000_000,
    inst_amt_5d: 500_000, inst_amt_20d: 1_500_000,
  });
  assert.equal(result.score, 56);
  assert.ok(result.reasons.some((r) => r.includes('기관 매수 우위')));
});

test('20일 금액이 음수면(5일만 양수) 쌍끌이/편측 가점 없음', () => {
  const result = scoreFlow({
    ...NEUTRAL,
    foreign_amt_5d: 1_000_000, foreign_amt_20d: -3_000_000,
    inst_amt_5d: 500_000, inst_amt_20d: -1_500_000,
  });
  assert.equal(result.score, 50);
});

test('외인·기관 둘 다 연속 순매수 5일 이상이면 +8', () => {
  const result = scoreFlow({ ...NEUTRAL, foreign_buy_streak: 6, inst_buy_streak: 5 });
  assert.equal(result.score, 58);
  assert.ok(result.reasons.some((r) => r.includes('동시 연속 순매수')));
});

test('외인만 연속 순매수 5일 이상이면 +5', () => {
  const result = scoreFlow({ ...NEUTRAL, foreign_buy_streak: 5, inst_buy_streak: 2 });
  assert.equal(result.score, 55);
  assert.ok(result.reasons.some((r) => r.includes('외인 연속 순매수 5일')));
});

test('연속 순매수가 4일이면(임계 미달) streak 가점 없음', () => {
  const result = scoreFlow({ ...NEUTRAL, foreign_buy_streak: 4, inst_buy_streak: 4 });
  assert.equal(result.score, 50);
});

test('OBV 상승 추세(1)면 +4', () => {
  const result = scoreFlow({ ...NEUTRAL, obv_trend: 1 });
  assert.equal(result.score, 54);
  assert.ok(result.reasons.some((r) => r.includes('OBV 상승 추세')));
});

test('OBV 하락(-1)/보합(0)이면 가점 없음', () => {
  assert.equal(scoreFlow({ ...NEUTRAL, obv_trend: -1 }).score, 50);
  assert.equal(scoreFlow({ ...NEUTRAL, obv_trend: 0 }).score, 50);
});

test('외인·기관 동반 이탈(5일 모두 순매도)이면 -8', () => {
  const result = scoreFlow({
    ...NEUTRAL,
    foreign_amt_5d: -1_000_000, foreign_amt_20d: 2_000_000,
    inst_amt_5d: -500_000, inst_amt_20d: 1_000_000,
  });
  assert.equal(result.score, 42);
  assert.ok(result.reasons.some((r) => r.includes('동반 이탈')));
});

test('쌍끌이 + streak 동시 + OBV 상승이 겹치면 가점이 합산된다', () => {
  const result = scoreFlow({
    foreign_amt_5d: 1_000_000, foreign_amt_20d: 3_000_000,
    inst_amt_5d: 500_000, inst_amt_20d: 1_500_000,
    foreign_buy_streak: 7, inst_buy_streak: 6,
    obv_trend: 1,
  });
  // 50 + 12(쌍끌이) + 8(streak 동시) + 4(OBV) = 74
  assert.equal(result.score, 74);
});

test('DB 문자열 타입(BIGINT 등)으로 와도 정상 계산된다', () => {
  const result = scoreFlow({
    foreign_amt_5d: '1000000', foreign_amt_20d: '3000000',
    inst_amt_5d: '500000', inst_amt_20d: '1500000',
    foreign_buy_streak: '6', inst_buy_streak: null, obv_trend: '1',
  });
  // 50 + 12(쌍끌이) + 4(OBV) = 66 (streak는 기관 null이라 외인 6일만 → +5 추가)
  assert.equal(result.score, 71);
});
