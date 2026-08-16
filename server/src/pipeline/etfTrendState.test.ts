import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcTrendState } from './etfTrendState';
import type { Candle } from './sources/naverEtfDetail';

/** 종가 시퀀스 → Candle[] (open=high=low=close, 거래량 고정) 합성 캔들 헬퍼 */
function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  }));
}

/** flatDays 동안 base로 횡보 후, 이후 매일 step씩 상승하는 종가 시퀀스 생성 */
function flatThenRamp(totalDays: number, flatDays: number, base: number, step: number): number[] {
  const closes: number[] = [];
  for (let i = 0; i < totalDays; i += 1) {
    closes.push(i < flatDays ? base : base + step * (i - flatDays + 1));
  }
  return closes;
}

test('장기간 상승 추세면 정배열 지속(aligned)이고 alignedStreak가 5 초과다', () => {
  // Arrange: 100일 내내 종가가 매일 1씩 상승 → ma5>ma20>ma60이 오래 유지됨
  const candles = makeCandles(flatThenRamp(100, 0, 100, 1));

  // Act
  const result = calcTrendState(candles);

  // Assert
  assert.equal(result.state, 'aligned');
  assert.ok(result.alignedStreak > 5);
  assert.equal(result.alignedStreak, 30); // 최근 30일 창 상한
});

test('신규진입 경계값 — alignedStreak가 정확히 5면 entered다', () => {
  // Arrange: 95일 횡보 후 상승 전환 → 정배열 연속일수가 정확히 5일째
  const candles = makeCandles(flatThenRamp(100, 95, 100, 1));

  // Act
  const result = calcTrendState(candles);

  // Assert
  assert.equal(result.state, 'entered');
  assert.equal(result.alignedStreak, 5);
});

test('신규진입 경계값 — alignedStreak가 6이 되면 aligned로 넘어간다', () => {
  // Arrange: 위 테스트보다 하루 이르게 상승 전환 → 연속일수 6일째
  const candles = makeCandles(flatThenRamp(100, 94, 100, 1));

  // Act
  const result = calcTrendState(candles);

  // Assert
  assert.equal(result.state, 'aligned');
  assert.equal(result.alignedStreak, 6);
});

test('20일선을 1.5% 넘게 하회하면 이탈(exited)이다', () => {
  // Arrange: 90일 연속 하락 — 정배열은 이미 깨졌고 종가가 20일선 아래로 크게 밀림
  const closes: number[] = [];
  for (let i = 0; i < 90; i += 1) closes.push(200 - i * 1.2);
  const candles = makeCandles(closes);

  // Act
  const result = calcTrendState(candles);

  // Assert
  assert.equal(result.state, 'exited');
  // 하락이 오래전부터 진행돼 5거래일 전에도 이미 이탈 상태 — 최근 급전환이 아니다
  assert.equal(result.recentExit, false);
});

test('20일선 하회가 1.5% 버퍼 이내면 이탈이 아닌 걸침(neutral)이다', () => {
  // Arrange: 99일 횡보(100) 후 마지막 날만 99로 소폭 하락 → 종가/MA20 ≈ 0.9905 (버퍼 0.985보다 큼)
  const closes = new Array(99).fill(100);
  closes.push(99);
  const candles = makeCandles(closes);

  // Act
  const result = calcTrendState(candles);

  // Assert
  assert.equal(result.state, 'neutral');
});

test('20일선 위이지만 정배열이 아니면 걸침(neutral)이다', () => {
  // Arrange: 65일 하락 후 5일 반등 — 최근 20일선 위로 올라섰지만 60일선 정배열 조건은 미충족
  const closes: number[] = [];
  for (let i = 0; i < 65; i += 1) closes.push(150 - i * 0.8);
  for (let i = 0; i < 5; i += 1) closes.push(closes[closes.length - 1] + 0.8);
  const candles = makeCandles(closes);

  // Act
  const result = calcTrendState(candles);

  // Assert
  assert.equal(result.state, 'neutral');
});

test('일봉이 60개 미만이면 판정 불가로 neutral·streak 0을 반환한다', () => {
  // Arrange
  const candles = makeCandles(flatThenRamp(59, 0, 100, 1));

  // Act
  const result = calcTrendState(candles);

  // Assert
  assert.equal(result.state, 'neutral');
  assert.equal(result.alignedStreak, 0);
});

test('빈 배열이면 neutral·streak 0을 반환한다', () => {
  // Arrange
  const candles: Candle[] = [];

  // Act
  const result = calcTrendState(candles);

  // Assert
  assert.equal(result.state, 'neutral');
  assert.equal(result.alignedStreak, 0);
});

test('정배열 지속 중 급전환 이탈이면 recentExit이 true다', () => {
  // Arrange: 95일간 매일 1씩 상승(정배열 지속) 후 마지막 5일 급락 —
  // 5거래일 전 시점(마지막 5봉 제거)은 여전히 정배열, 오늘은 이탈
  const closes: number[] = [];
  for (let i = 0; i < 95; i += 1) closes.push(100 + i); // day0..94: 100..194
  const crash = [150, 130, 110, 90, 70];
  const candles = makeCandles([...closes, ...crash]);

  // Act
  const result = calcTrendState(candles);

  // Assert
  assert.equal(result.state, 'exited');
  assert.equal(result.recentExit, true);
});

test('오래전부터 이탈 상태였다면 recentExit은 false다', () => {
  // Arrange: 95일 연속 하락 — 5거래일 전 시점도 이미 이탈 상태 (급전환이 아님)
  const closes: number[] = [];
  for (let i = 0; i < 95; i += 1) closes.push(200 - i * 1.2);
  const candles = makeCandles(closes);

  // Act
  const result = calcTrendState(candles);

  // Assert
  assert.equal(result.state, 'exited');
  assert.equal(result.recentExit, false);
});

test('5거래일 전이 걸침(neutral)이었다가 이탈해도 recentExit은 false다', () => {
  // Arrange: 65일 하락 + 5일 반등(=neutral, 기존 걸침 테스트와 동일한 70봉 구간) 뒤
  // 마지막 5일간 20일선 아래로 크게 밀려 이탈 — 급전환 직전 시점은 정배열이 아니라 걸침이었음
  const closes: number[] = [];
  for (let i = 0; i < 65; i += 1) closes.push(150 - i * 0.8);
  for (let i = 0; i < 5; i += 1) closes.push(closes[closes.length - 1] + 0.8);
  const crash = [90, 80, 70, 60, 50];
  const candles = makeCandles([...closes, ...crash]);

  // Act
  const result = calcTrendState(candles);

  // Assert
  assert.equal(result.state, 'exited');
  assert.equal(result.recentExit, false);
});

test('전체 봉이 60개대라 5거래일 전 판정에 데이터가 부족하면 recentExit은 false다', () => {
  // Arrange: 63일 연속 하락 — 오늘은 이탈이지만, 마지막 5봉을 제거하면 58개로
  // MA60 계산에 필요한 최소 60개에 못 미쳐 과거 시점 판정 자체가 불가능하다
  const closes: number[] = [];
  for (let i = 0; i < 63; i += 1) closes.push(200 - i * 1.2);
  const candles = makeCandles(closes);

  // Act
  const result = calcTrendState(candles);

  // Assert
  assert.equal(result.state, 'exited');
  assert.equal(result.recentExit, false);
});
