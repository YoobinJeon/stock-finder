import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcEtfFlows, type EtfSnapRow } from './etfFlowCalc';

function row(
  ticker: string,
  snap_date: string,
  overrides: Partial<EtfSnapRow> = {},
): EtfSnapRow {
  return {
    ticker,
    name: `${ticker}-name`,
    tab: 1,
    snap_date,
    close: 10000,
    change_pct: 1,
    market_cap: 1000,
    ...overrides,
  };
}

test('2일치 스냅샷에서 자금유입 추정을 수기 계산값과 동일하게 산출한다', () => {
  // Arrange: day1 시총 1000억, day2 시총 1050억 · 등락률 +2%
  // flow = 1050 - 1000*(1+2/100) = 1050 - 1020 = 30
  const rows = [
    row('A', '2026-07-09', { market_cap: 1000, change_pct: 1 }),
    row('A', '2026-07-10', { market_cap: 1050, change_pct: 2 }),
  ];

  // Act
  const [result] = calcEtfFlows(rows);

  // Assert
  assert.equal(result.ticker, 'A');
  assert.ok(Math.abs(result.flowEst - 30) < 1e-9);
});

test('시총이 null인 날은 그 날 기여를 0으로 스킵한다', () => {
  // Arrange
  const rows = [
    row('B', '2026-07-09', { market_cap: null, change_pct: 1 }),
    row('B', '2026-07-10', { market_cap: 500, change_pct: 5 }),
  ];

  // Act
  const [result] = calcEtfFlows(rows);

  // Assert
  assert.equal(result.flowEst, 0);
});

test('단일 스냅샷만 있으면 flowEst는 0이다', () => {
  // Arrange
  const rows = [row('C', '2026-07-10', { market_cap: 800, change_pct: 3 })];

  // Act
  const [result] = calcEtfFlows(rows);

  // Assert
  assert.equal(result.flowEst, 0);
});

test('기간 누적수익률을 (1+r_t) 누적곱으로 계산한다', () => {
  // Arrange: r1=1%, r2=2% → (1.01 * 1.02 - 1) * 100 = 3.02%
  const rows = [
    row('A', '2026-07-09', { change_pct: 1 }),
    row('A', '2026-07-10', { change_pct: 2 }),
  ];

  // Act
  const [result] = calcEtfFlows(rows);

  // Assert
  assert.ok(Math.abs(result.periodReturnPct - 3.02) < 1e-9);
});

test('누적수익률 계산 시 change_pct가 null인 날은 제외한다', () => {
  // Arrange: 중간 날(null)은 곱셈에서 제외되어 r1=1%, r3=2%만 반영
  const rows = [
    row('D', '2026-07-08', { change_pct: 1 }),
    row('D', '2026-07-09', { change_pct: null }),
    row('D', '2026-07-10', { change_pct: 2 }),
  ];

  // Act
  const [result] = calcEtfFlows(rows);

  // Assert
  assert.ok(Math.abs(result.periodReturnPct - 3.02) < 1e-9);
});

test('RS 백분위는 기간수익률 최저가 0에 가깝고 최고가 100이 되도록 산출한다', () => {
  // Arrange: 4개 티커, 기간수익률 오름차순 -10 < -2 < 5 < 20
  const rows = [
    row('LOW', '2026-07-10', { change_pct: -10 }),
    row('MID1', '2026-07-10', { change_pct: -2 }),
    row('MID2', '2026-07-10', { change_pct: 5 }),
    row('HIGH', '2026-07-10', { change_pct: 20 }),
  ];

  // Act
  const results = calcEtfFlows(rows);
  const byTicker = new Map(results.map((r) => [r.ticker, r]));

  // Assert
  assert.equal(byTicker.get('LOW')!.rsPercentile, 25);   // 1/4*100
  assert.equal(byTicker.get('HIGH')!.rsPercentile, 100); // 4/4*100
});

test('DECIMAL이 문자열로 온 경우도 null 안전하게 숫자로 변환해 계산한다', () => {
  // Arrange: PGlite/pg DECIMAL 컬럼은 문자열로 반환될 수 있음
  const rows = [
    row('E', '2026-07-09', { market_cap: '1000.00' as unknown as number, change_pct: '1.00' as unknown as number }),
    row('E', '2026-07-10', { market_cap: '1050.00' as unknown as number, change_pct: '2.00' as unknown as number }),
  ];

  // Act
  const [result] = calcEtfFlows(rows);

  // Assert
  assert.ok(Math.abs(result.flowEst - 30) < 1e-9);
  assert.ok(Math.abs(result.periodReturnPct - 3.02) < 1e-9);
});

test('market_cap이 문자열 "null" 아닌 실제 null이면 marketCap 필드가 null로 유지된다', () => {
  // Arrange
  const rows = [row('F', '2026-07-10', { market_cap: null })];

  // Act
  const [result] = calcEtfFlows(rows);

  // Assert
  assert.equal(result.marketCap, null);
});
