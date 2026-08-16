import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcThemeRotation, type ThemeSnapRow } from './themeRotation';

function row(
  theme_no: number,
  snap_date: string,
  overrides: Partial<ThemeSnapRow> = {},
): ThemeSnapRow {
  return {
    theme_no,
    name: `테마${theme_no}`,
    snap_date,
    chg_pct: 1,
    up_cnt: 10,
    total_cnt: 20,
    ...overrides,
  };
}

test('최근 3일 평균과 이전 5일 평균의 차를 모멘텀으로 수기 계산값과 동일하게 산출한다', () => {
  // Arrange: 이전 5일 chg=1%(평균 1), 최근 3일 chg=2%(평균 2) → momentum = 2 - 1 = 1
  const rows = [
    row(1, '2026-07-01', { chg_pct: 1 }),
    row(1, '2026-07-02', { chg_pct: 1 }),
    row(1, '2026-07-03', { chg_pct: 1 }),
    row(1, '2026-07-04', { chg_pct: 1 }),
    row(1, '2026-07-05', { chg_pct: 1 }),
    row(1, '2026-07-06', { chg_pct: 2 }),
    row(1, '2026-07-07', { chg_pct: 2 }),
    row(1, '2026-07-08', { chg_pct: 2 }),
  ];

  // Act
  const [result] = calcThemeRotation(rows);

  // Assert
  assert.equal(result.themeNo, 1);
  assert.ok(Math.abs(result.recentAvg - 2) < 1e-9);
  assert.ok(Math.abs(result.prevAvg - 1) < 1e-9);
  assert.ok(Math.abs(result.momentum - 1) < 1e-9);
});

test('이전 구간 데이터가 없으면 prevAvg는 0, momentum은 recentAvg와 같다', () => {
  // Arrange: 스냅샷 2일치만 존재 (recentAvg = (1+2)/2 = 1.5)
  const rows = [
    row(2, '2026-07-09', { chg_pct: 1 }),
    row(2, '2026-07-10', { chg_pct: 2 }),
  ];

  // Act
  const [result] = calcThemeRotation(rows);

  // Assert
  assert.equal(result.prevAvg, 0);
  assert.ok(Math.abs(result.recentAvg - 1.5) < 1e-9);
  assert.ok(Math.abs(result.momentum - result.recentAvg) < 1e-9);
});

test('중간에 하락한 날이 있으면 연속 상승 streak가 거기서 끊긴다', () => {
  // Arrange: chg = [1, 2, -1, 3, 4] → 최신일부터 4>0, 3>0, -1(중단) → upStreak=2
  const rows = [
    row(3, '2026-07-06', { chg_pct: 1 }),
    row(3, '2026-07-07', { chg_pct: 2 }),
    row(3, '2026-07-08', { chg_pct: -1 }),
    row(3, '2026-07-09', { chg_pct: 3 }),
    row(3, '2026-07-10', { chg_pct: 4 }),
  ];

  // Act
  const [result] = calcThemeRotation(rows);

  // Assert
  assert.equal(result.upStreak, 2);
});

test('전체 기간 누적수익률을 (1+r_t) 누적곱으로 계산한다', () => {
  // Arrange: r1=1%, r2=2% → (1.01 * 1.02 - 1) * 100 = 3.02%
  const rows = [
    row(4, '2026-07-09', { chg_pct: 1 }),
    row(4, '2026-07-10', { chg_pct: 2 }),
  ];

  // Act
  const [result] = calcThemeRotation(rows);

  // Assert
  assert.ok(Math.abs(result.cumReturnPct - 3.02) < 1e-9);
});

test('DECIMAL이 문자열로 온 경우도 null 안전하게 숫자로 변환해 계산한다', () => {
  // Arrange: PGlite/pg DECIMAL 컬럼은 문자열로 반환될 수 있음
  const rows = [
    row(5, '2026-07-09', { chg_pct: '1.00' as unknown as number }),
    row(5, '2026-07-10', { chg_pct: '2.00' as unknown as number }),
  ];

  // Act
  const [result] = calcThemeRotation(rows);

  // Assert
  assert.ok(Math.abs(result.cumReturnPct - 3.02) < 1e-9);
  assert.equal(result.lastChgPct, 2);
});

test('chg_pct가 null인 날은 평균·누적·streak 계산에서 제외한다', () => {
  // Arrange: 중간 날(null)은 제외되어 유효값 [1, 2]만 반영
  const rows = [
    row(6, '2026-07-08', { chg_pct: 1 }),
    row(6, '2026-07-09', { chg_pct: null }),
    row(6, '2026-07-10', { chg_pct: 2 }),
  ];

  // Act
  const [result] = calcThemeRotation(rows);

  // Assert
  assert.ok(Math.abs(result.cumReturnPct - 3.02) < 1e-9);
  assert.ok(Math.abs(result.recentAvg - 1.5) < 1e-9);
  assert.equal(result.upStreak, 2);
  assert.equal(result.lastChgPct, 2);
});
