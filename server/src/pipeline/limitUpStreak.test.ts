import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcLimitUpStreak, type PriceRow } from './limitUpStreak';

function row(trade_date: string, overrides: Partial<PriceRow> = {}): PriceRow {
  return {
    trade_date,
    close: 10000,
    prev_close: 10000,
    ...overrides,
  };
}

test('+29.5% 등락률은 상한가로 포함된다 (경계값)', () => {
  // Arrange: 129500/100000 - 1 === 0.295 (부동소수점 오차 있음, EPS로 흡수 확인)
  const rows = [row('2026-07-10', { close: 129500, prev_close: 100000 })];

  // Act
  const result = calcLimitUpStreak(rows);

  // Assert
  assert.equal(result.streak, 1);
});

test('+29.4% 등락률은 상한가 미포함이다', () => {
  // Arrange
  const rows = [row('2026-07-10', { close: 129400, prev_close: 100000 })];

  // Act
  const result = calcLimitUpStreak(rows);

  // Assert
  assert.equal(result.streak, 0);
});

test('2일 연속 상한가면 streak가 2다', () => {
  // Arrange: 둘 다 +30%
  const rows = [
    row('2026-07-09', { close: 13000, prev_close: 10000 }),
    row('2026-07-10', { close: 16900, prev_close: 13000 }),
  ];

  // Act
  const result = calcLimitUpStreak(rows);

  // Assert
  assert.equal(result.streak, 2);
});

test('중간에 상한가가 끊기면 그 이전 연속분만 카운트한다', () => {
  // Arrange: 최신일(07-10) 상한가, 하루 전(07-09) 상한가 미달 → streak 1에서 멈춤
  const rows = [
    row('2026-07-08', { close: 13000, prev_close: 10000 }),
    row('2026-07-09', { close: 10500, prev_close: 10000 }), // +5%, 상한가 아님
    row('2026-07-10', { close: 13650, prev_close: 10500 }), // +30%
  ];

  // Act
  const result = calcLimitUpStreak(rows);

  // Assert
  assert.equal(result.streak, 1);
});

test('prev_close가 null인 날을 만나면 판정 불가로 중단한다', () => {
  // Arrange: 최신일은 상한가, 그 전날은 prev_close 없음(신규상장 등)
  const rows = [
    row('2026-07-09', { close: 10000, prev_close: null }),
    row('2026-07-10', { close: 13000, prev_close: 10000 }), // +30%
  ];

  // Act
  const result = calcLimitUpStreak(rows);

  // Assert
  assert.equal(result.streak, 1);
});

test('DECIMAL이 문자열로 온 경우도 null 안전하게 숫자로 변환해 계산한다', () => {
  // Arrange: PGlite/pg DECIMAL 컬럼은 문자열로 반환될 수 있음
  const rows = [
    row('2026-07-10', { close: '13000.00', prev_close: '10000.00' }),
  ];

  // Act
  const result = calcLimitUpStreak(rows);

  // Assert
  assert.equal(result.streak, 1);
  assert.ok(Math.abs(result.lastChangePct! - 30) < 1e-9);
  assert.equal(result.lastClose, 13000);
});

test('빈 배열이면 streak 0과 null 필드를 반환한다', () => {
  // Arrange
  const rows: PriceRow[] = [];

  // Act
  const result = calcLimitUpStreak(rows);

  // Assert
  assert.equal(result.streak, 0);
  assert.equal(result.lastChangePct, null);
  assert.equal(result.lastClose, null);
});

test('정렬되지 않은 입력도 trade_date 기준 내림차순으로 정리해 계산한다', () => {
  // Arrange: 배열 순서가 날짜 오름차순이 아니어도 결과는 동일해야 함
  const rows = [
    row('2026-07-10', { close: 16900, prev_close: 13000 }), // +30%
    row('2026-07-09', { close: 13000, prev_close: 10000 }), // +30%
  ];

  // Act
  const result = calcLimitUpStreak(rows);

  // Assert
  assert.equal(result.streak, 2);
  assert.equal(result.lastClose, 16900);
});
