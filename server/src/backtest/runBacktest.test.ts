import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePitFactors, combinePitFactors, pitScore } from './runBacktest';

// pitScore = combinePitFactors(computePitFactors(...)) 리팩터 회귀 확인

test('재무 정보가 전혀 없으면 가치·퀄리티·성장 팩터는 중립 50', () => {
  const closes = new Array(130).fill(10000); // 변동 없는 종가
  const factors = computePitFactors(null, closes);
  assert.equal(factors.value, 50);
  assert.equal(factors.quality, 50);
  assert.equal(factors.growth, 50);
});

test('변동 없는 종가(등락 0)는 RSI 계산상 gains=losses=0 → rs=100 취급되어 momentum이 40으로 내려간다', () => {
  // calcRSI의 "losses===0이면 rs=100" 분기가 무변동 구간을 극단 과매수로 취급하는 기존 동작 —
  // 리팩터(computePitFactors 추출)로 값이 달라지지 않았음을 회귀 확인.
  const closes = new Array(130).fill(10000);
  const factors = computePitFactors(null, closes);
  assert.equal(factors.momentum, 40);
});

test('combinePitFactors({50,50,50,50})은 50 — 4팩터 전부 중립이면 총점도 중립', () => {
  const score = combinePitFactors({ value: 50, quality: 50, growth: 50, momentum: 50 });
  assert.equal(score, 50);
});

test('저PER + 고ROE + 고성장 재무면 가치·퀄리티·성장 팩터가 중립보다 높다', () => {
  const closes = new Array(130).fill(10000);
  const f = {
    eps: 2000,          // PER = 10000/2000 = 5 → 저PER 구간
    roe: 0.25,           // 25% → 최고 구간
    debt_ratio: 0.3,     // 30% → 우량
    revenue: 1000,
    operating_income: 200, // 영업이익률 20%
    net_income: 150,
    revenue_growth: 0.30,  // 30%
    eps_growth: 0.30,
  };
  const factors = computePitFactors(f, closes);
  assert.ok(factors.value > 50);
  assert.ok(factors.quality > 50);
  assert.ok(factors.growth > 50);
});

test('combinePitFactors는 0~100 클램프 후 가중합(V.30/Q.25/G.20/M.15 재정규화)을 반올림한다', () => {
  const score = combinePitFactors({ value: 100, quality: 0, growth: 0, momentum: 0 });
  // W_SUM = 0.30+0.25+0.20+0.15 = 0.90 → 100*0.30/0.90 = 33.33 → round 33
  assert.equal(score, 33);
});

test('모든 팩터가 100이면 combinePitFactors도 100', () => {
  const score = combinePitFactors({ value: 100, quality: 100, growth: 100, momentum: 100 });
  assert.equal(score, 100);
});

test('pitScore는 combinePitFactors(computePitFactors(f, closes))와 정확히 일치한다', () => {
  const closes = new Array(130).fill(10000);
  const f = { eps: 2000, roe: 0.25, debt_ratio: 0.3, revenue: 1000, operating_income: 200, net_income: 150 };
  const factors = computePitFactors(f, closes);
  assert.equal(pitScore(f, closes), combinePitFactors(factors));
});
