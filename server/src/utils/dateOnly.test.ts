import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDateOnly,
  formatDateOnly,
  subtractMonthsUTC,
  getUTCYear,
  getUTCMonthOneBased,
  diffDaysUTC,
  countWeekdaysBetweenUTC,
} from './dateOnly';

test('parseDateOnly는 UTC 자정으로 파싱한다', () => {
  // Arrange
  const dateStr = '2026-07-12';

  // Act
  const d = parseDateOnly(dateStr);

  // Assert
  assert.equal(d.getTime(), Date.UTC(2026, 6, 12, 0, 0, 0));
});

test('formatDateOnly는 UTC 기준으로 YYYY-MM-DD를 반환한다', () => {
  // Arrange
  const d = new Date(Date.UTC(2026, 6, 12, 23, 59, 59));

  // Act
  const result = formatDateOnly(d);

  // Assert
  assert.equal(result, '2026-07-12');
});

test('parseDateOnly/formatDateOnly는 서로 역함수다', () => {
  // Arrange
  const dateStr = '2025-12-31';

  // Act
  const result = formatDateOnly(parseDateOnly(dateStr));

  // Assert
  assert.equal(result, dateStr);
});

test('subtractMonthsUTC는 일반적인 월 차감을 수행한다', () => {
  // Arrange & Act & Assert
  assert.equal(subtractMonthsUTC('2026-07-12', 1), '2026-06-12');
  assert.equal(subtractMonthsUTC('2026-07-12', 3), '2026-04-12');
  assert.equal(subtractMonthsUTC('2026-07-12', 6), '2026-01-12');
});

test('subtractMonthsUTC는 연말 경계를 넘어간다', () => {
  // Arrange & Act
  const result = subtractMonthsUTC('2026-01-15', 1);

  // Assert
  assert.equal(result, '2025-12-15');
});

test('subtractMonthsUTC는 여러 해를 거슬러도 정확하다', () => {
  // Arrange & Act
  const result = subtractMonthsUTC('2026-02-01', 14);

  // Assert
  assert.equal(result, '2024-12-01');
});

test('subtractMonthsUTC는 평년 2월 말일 초과분을 3월로 굴린다', () => {
  // Arrange: 2026년은 평년(2월 28일까지) — 3/31에서 1개월 전은 2/31이 없어 3/3으로 롤오버
  // Act
  const result = subtractMonthsUTC('2026-03-31', 1);

  // Assert
  assert.equal(result, '2026-03-03');
});

test('subtractMonthsUTC는 윤년 2월 말일 초과분을 3월로 굴린다', () => {
  // Arrange: 2024년은 윤년(2월 29일까지) — 3/31에서 1개월 전은 2/31이 없어 3/2로 롤오버
  // Act
  const result = subtractMonthsUTC('2024-03-31', 1);

  // Assert
  assert.equal(result, '2024-03-02');
});

test('subtractMonthsUTC는 월 0(months=0)일 때 원본 날짜를 그대로 반환한다', () => {
  // Arrange & Act
  const result = subtractMonthsUTC('2026-07-12', 0);

  // Assert
  assert.equal(result, '2026-07-12');
});

test('getUTCYear는 UTC 기준 연도를 반환한다', () => {
  // Arrange & Act & Assert
  assert.equal(getUTCYear('2026-12-31'), 2026);
  assert.equal(getUTCYear('2026-01-01'), 2026);
});

test('getUTCMonthOneBased는 1~12 범위의 UTC 월을 반환한다', () => {
  // Arrange & Act & Assert
  assert.equal(getUTCMonthOneBased('2026-01-01'), 1);
  assert.equal(getUTCMonthOneBased('2026-12-31'), 12);
  assert.equal(getUTCMonthOneBased('2026-03-31'), 3);
});

test('diffDaysUTC는 두 날짜 문자열의 차이를 일 단위로 반환한다', () => {
  // Arrange & Act & Assert
  assert.equal(diffDaysUTC('2026-01-10', '2026-01-01'), 9);
  assert.equal(diffDaysUTC('2026-01-01', '2026-01-10'), -9);
  assert.equal(diffDaysUTC('2026-01-01', '2026-01-01'), 0);
});

test('diffDaysUTC는 연말·윤년 경계를 넘어도 정확하다', () => {
  // Arrange: 2024는 윤년이라 2/29가 존재 — 2/29 → 3/1은 1일 차이
  // Act & Assert
  assert.equal(diffDaysUTC('2024-03-01', '2024-02-29'), 1);
  assert.equal(diffDaysUTC('2025-01-01', '2024-12-31'), 1);
});

test('countWeekdaysBetweenUTC는 금요일 최신 데이터 → 월요일 조회 시 0을 반환한다 (평상시)', () => {
  // Arrange: 2026-07-17은 금요일, 2026-07-20은 다음 월요일 — 사이는 주말뿐
  // Act
  const result = countWeekdaysBetweenUTC('2026-07-17', '2026-07-20');

  // Assert
  assert.equal(result, 0);
});

test('countWeekdaysBetweenUTC는 최신일이 직전 영업일(인접 평일)이면 0을 반환한다', () => {
  // Arrange: 2026-07-20(월) → 2026-07-21(화), 인접한 평일 사이엔 낄 날이 없음
  // Act & Assert
  assert.equal(countWeekdaysBetweenUTC('2026-07-20', '2026-07-21'), 0);
});

test('countWeekdaysBetweenUTC는 목요일 최신 데이터 → 토요일 조회 시 1(중간 금요일)을 반환한다', () => {
  // Arrange: 2026-07-16(목) 최신, 2026-07-18(토) 오늘 — 사이 2026-07-17(금)이 평일
  // Act
  const result = countWeekdaysBetweenUTC('2026-07-16', '2026-07-18');

  // Assert
  assert.equal(result, 1);
});

test('countWeekdaysBetweenUTC는 공휴일 캘린더를 모르므로 연휴 중 평일도 지연으로 센다 (의도된 근사 한계)', () => {
  // Arrange: 2026-07-15(수) 최신 → 2026-07-21(화) 조회. 사이엔 목·금·토·일·월이 있고
  // 그중 평일(목·금·월) 3일을 센다 — 월요일이 실제로는 대체공휴일이라도 이 함수는 모른다.
  // Act
  const result = countWeekdaysBetweenUTC('2026-07-15', '2026-07-21');

  // Assert
  assert.equal(result, 3);
});

test('countWeekdaysBetweenUTC는 범위가 뒤집혔거나 같은 날이면 0을 반환한다', () => {
  // Arrange & Act & Assert
  assert.equal(countWeekdaysBetweenUTC('2026-07-20', '2026-07-20'), 0);
  assert.equal(countWeekdaysBetweenUTC('2026-07-20', '2026-07-18'), 0);
});
