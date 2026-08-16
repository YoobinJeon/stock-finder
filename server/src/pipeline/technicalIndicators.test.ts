import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcMACD, calcBollinger, calcATR, calcOBV, calcTurnoverSurge } from './technicalIndicators';

const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ── MACD ──
test('MACD: 봉 부족(<35)이면 null', () => {
  assert.equal(calcMACD(Array(34).fill(10)), null);
});

test('MACD: 무변동 종가 40봉이면 macd·signal·histogram 모두 0', () => {
  const out = calcMACD(Array(40).fill(10));
  assert.ok(out != null);
  assert.ok(approx(out.macd, 0) && approx(out.signal, 0) && approx(out.histogram, 0));
});

test('MACD: 최신순 상승 추세면 macd > 0 (단기 EMA가 장기보다 위)', () => {
  // 최신순 [40,39,...,1] → 실제 오래된→최신은 상승
  const closes = Array.from({ length: 40 }, (_, i) => 40 - i);
  const out = calcMACD(closes);
  assert.ok(out != null && out.macd > 0);
});

// ── Bollinger ──
test('Bollinger: 봉 부족이면 null', () => {
  assert.equal(calcBollinger(Array(19).fill(10), 20), null);
});

test('Bollinger: 무변동이면 상단=중심=하단, pctB 0.5, bandwidth 0', () => {
  const out = calcBollinger(Array(20).fill(10), 20, 2);
  assert.ok(out != null);
  assert.ok(approx(out.upper, 10) && approx(out.mid, 10) && approx(out.lower, 10));
  assert.ok(approx(out.pctB, 0.5) && approx(out.bandwidth, 0));
});

test('Bollinger: lower ≤ mid ≤ upper 불변식', () => {
  const closes = Array.from({ length: 25 }, (_, i) => 100 + (i % 5) * 3);
  const out = calcBollinger(closes, 20, 2);
  assert.ok(out != null && out.lower <= out.mid && out.mid <= out.upper);
});

// ── ATR (손계산) ──
test('ATR: period=2, 손계산 검증 atr=1.5·atrPct=15', () => {
  const closes = [10, 11, 12]; // 최신순
  const highs = [10.5, 11.5, 12.5];
  const lows = [9.5, 10.5, 11.5];
  const out = calcATR(highs, lows, closes, 2);
  assert.ok(out != null);
  assert.ok(approx(out.atr, 1.5) && approx(out.atrPct, 15));
});

test('ATR: 길이 불일치·봉 부족이면 null', () => {
  assert.equal(calcATR([1, 2], [1], [1, 2], 14), null);
  assert.equal(calcATR([1, 2], [1, 2], [1, 2], 14), null);
});

// ── OBV (손계산) ──
test('OBV: 손계산 obv=300·trend=1', () => {
  const closes = [12, 11, 10]; // 최신순 → 오래된→최신 [10,11,12] 상승
  const volumes = [100, 200, 300];
  const out = calcOBV(closes, volumes);
  assert.ok(out != null);
  assert.equal(out.obv, 300);
  assert.equal(out.trend, 1);
});

test('OBV: 봉 부족·길이 불일치면 null', () => {
  assert.equal(calcOBV([10], [100]), null);
  assert.equal(calcOBV([10, 11], [100]), null);
});

// ── 거래대금 급증 (손계산) ──
test('거래대금 급증: 당일 3000 / 평균 1000 = 3배', () => {
  const closes = [10, 10, 10]; // 최신순
  const volumes = [300, 100, 100];
  assert.equal(calcTurnoverSurge(closes, volumes, 2), 3);
});

test('거래대금 급증: 봉 부족이면 null', () => {
  assert.equal(calcTurnoverSurge([10, 10], [100, 100], 20), null);
});
