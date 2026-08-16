import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcTrendMa, calcMomentumReturn, calcRsPercentile } from './trendIndicators';

test('봉이 충분하면 MA50/150/200을 계산하고 MA200 우상향을 판정한다', () => {
  // Arrange: 221거래일치 종가 — 최신([0])이 가장 크게, 뒤로 갈수록 작아지는 선형 하락
  // (index가 클수록 과거) → 최신 MA200이 21거래일 전 MA200보다 커야 ma200Up = true
  const closes = Array.from({ length: 221 }, (_, i) => 1000 - i);
  const lows = closes.map((v) => v - 5);

  // Act
  const r = calcTrendMa(closes, lows);

  // Assert
  assert.ok(r.ma50 != null && r.ma150 != null && r.ma200 != null);
  assert.equal(r.ma200Up, true);
  assert.equal(r.low52w, Math.min(...lows));
  assert.ok(r.pctFrom52wLow! > 0);
});

test('봉 수가 200개 미만이면 MA200은 null이고 MA50은 계산된다', () => {
  // Arrange
  const closes = Array.from({ length: 60 }, (_, i) => 500 - i);
  const lows = closes.map((v) => v - 2);

  // Act
  const r = calcTrendMa(closes, lows);

  // Assert
  assert.equal(r.ma200, null);
  assert.equal(r.ma150, null);
  assert.ok(r.ma50 != null);
  assert.equal(r.ma200Up, null);
});

test('저가 배열이 비어있으면 52주 저점·저점 대비 상승률이 null이다', () => {
  // Arrange
  const closes = [100, 99, 98];

  // Act
  const r = calcTrendMa(closes, []);

  // Assert
  assert.equal(r.low52w, null);
  assert.equal(r.pctFrom52wLow, null);
});

test('52주 저점 대비 상승률을 수기 계산값과 동일하게 산출한다', () => {
  // Arrange: 최신 종가 120, 52주 저점 80 → (120-80)/80*100 = 50%
  const closes = [120, 110, 100, 90];
  const lows = [115, 105, 95, 80];

  // Act
  const r = calcTrendMa(closes, lows);

  // Assert
  assert.equal(r.low52w, 80);
  assert.ok(Math.abs(r.pctFrom52wLow! - 50) < 1e-9);
});

test('252거래일 이상이면 12개월 수익률을 사용한다', () => {
  // Arrange: closes[0]=200(최신), closes[251]=100(12개월 전) → 100% 수익률
  const closes = Array.from({ length: 260 }, (_, i) => (i === 251 ? 100 : 200 - i * 0.01));

  // Act
  const r = calcMomentumReturn(closes);

  // Assert
  assert.ok(r != null);
  assert.equal(r!.months, 12);
  assert.ok(Math.abs(r!.retPct - 100) < 1e-6);
});

test('12개월치는 부족하지만 6개월치는 있으면 6개월 수익률로 대체한다', () => {
  // Arrange: 130거래일 — 251일 인덱스 없음, 125일 인덱스는 있음. closes[0]=200(최신), closes[125]=100
  const closes = Array.from({ length: 130 }, (_, i) => (i === 125 ? 100 : 200 - i * 0.01));

  // Act
  const r = calcMomentumReturn(closes);

  // Assert
  assert.ok(r != null);
  assert.equal(r!.months, 6);
  assert.ok(Math.abs(r!.retPct - 100) < 1e-6); // (200-100)/100*100
});

test('6개월치도 부족하면 null을 반환한다(RS 순위 제외 대상)', () => {
  // Arrange
  const closes = Array.from({ length: 100 }, (_, i) => 100 - i * 0.1);

  // Act
  const r = calcMomentumReturn(closes);

  // Assert
  assert.equal(r, null);
});

test('RS 백분위: 수익률 오름차순 순위를 0~100으로 정규화한다', () => {
  // Arrange: A(-10%) < B(0%) < C(10%) < D(20%) — 4종목 균등 순위
  const inputs = [
    { ticker: 'D', ret: 20 },
    { ticker: 'A', ret: -10 },
    { ticker: 'C', ret: 10 },
    { ticker: 'B', ret: 0 },
  ];

  // Act
  const result = calcRsPercentile(inputs);
  const byTicker = Object.fromEntries(result.map((r) => [r.ticker, r.rsPercentile]));

  // Assert: 1위=25, 2위=50, 3위=75, 4위(최고)=100
  assert.equal(byTicker.A, 25);
  assert.equal(byTicker.B, 50);
  assert.equal(byTicker.C, 75);
  assert.equal(byTicker.D, 100);
});

test('RS 백분위: 동률 종목은 평균 순위를 공유한다', () => {
  // Arrange: A,B 동률(10%) — 1,2위 평균인 1.5위/3 * 100 = 50, C(20%)는 3위 → 100
  const inputs = [
    { ticker: 'A', ret: 10 },
    { ticker: 'B', ret: 10 },
    { ticker: 'C', ret: 20 },
  ];

  // Act
  const result = calcRsPercentile(inputs);
  const byTicker = Object.fromEntries(result.map((r) => [r.ticker, r.rsPercentile]));

  // Assert
  assert.equal(byTicker.A, 50);
  assert.equal(byTicker.B, 50);
  assert.equal(byTicker.C, 100);
});

test('RS 백분위: 빈 배열은 빈 배열을 반환한다', () => {
  // Act
  const result = calcRsPercentile([]);

  // Assert
  assert.deepEqual(result, []);
});
