import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedFlowsDate, cronTimeMinutes } from './catchup';

// KST = UTC+9. UTC 시각으로 명시적으로 구성해 KST 판정 경계를 검증한다.
const utc = (y: number, m: number, d: number, h: number, min: number): Date =>
  new Date(Date.UTC(y, m - 1, d, h, min));

test('평일 15:50 이후면 오늘 (금 19:51 KST → 오늘)', () => {
  assert.equal(expectedFlowsDate(utc(2026, 7, 17, 10, 51)), '2026-07-17');
});

test('평일 15:50 이전이면 직전 평일 (금 09:00 KST → 목)', () => {
  assert.equal(expectedFlowsDate(utc(2026, 7, 17, 0, 0)), '2026-07-16');
});

test('토요일이면 직전 평일 (토 12:00 KST → 금)', () => {
  assert.equal(expectedFlowsDate(utc(2026, 7, 18, 3, 0)), '2026-07-17');
});

test('일요일이면 직전 평일 (일 12:00 KST → 금)', () => {
  assert.equal(expectedFlowsDate(utc(2026, 7, 19, 3, 0)), '2026-07-17');
});

test('월요일 마감 전이면 지난주 금 (월 09:00 KST → 전주 금)', () => {
  assert.equal(expectedFlowsDate(utc(2026, 7, 20, 0, 0)), '2026-07-17');
});

test('월요일 15:50 정각이면 오늘 (경계값 포함)', () => {
  assert.equal(expectedFlowsDate(utc(2026, 7, 20, 6, 50)), '2026-07-20');
});

test('월요일 15:49면 아직 마감 전 (전주 금)', () => {
  assert.equal(expectedFlowsDate(utc(2026, 7, 20, 6, 49)), '2026-07-17');
});

test('수요일 마감 전이면 화요일', () => {
  assert.equal(expectedFlowsDate(utc(2026, 7, 22, 0, 0)), '2026-07-21');
});

// --- 크론 예정 시각 파싱 (전체 수집 누락 캐치업 판정 기준) ---

test('"10 18 * * 1-5"에서 예정 시각 18:10을 분 단위로 뽑는다', () => {
  assert.equal(cronTimeMinutes('10 18 * * 1-5'), 18 * 60 + 10);
});

test('한 자리 분·시도 파싱한다', () => {
  assert.equal(cronTimeMinutes('5 9 * * 1-5'), 9 * 60 + 5);
});

test('자정 경계 "0 0 * * *"는 0분이다 — falsy와 혼동하지 않도록', () => {
  assert.equal(cronTimeMinutes('0 0 * * *'), 0);
});

test('분·시가 고정 숫자가 아니면 null — 누락 판정 기준을 세울 수 없다', () => {
  assert.equal(cronTimeMinutes('*/20 8-20 * * 1-5'), null);
  assert.equal(cronTimeMinutes('10 * * * *'), null);
  assert.equal(cronTimeMinutes('* 18 * * 1-5'), null);
});

test('범위를 벗어난 시각은 거부한다', () => {
  assert.equal(cronTimeMinutes('10 24 * * 1-5'), null);
  assert.equal(cronTimeMinutes('60 18 * * 1-5'), null);
});

test('앞뒤 공백·중복 공백이 있어도 파싱한다', () => {
  assert.equal(cronTimeMinutes('  10   18 * * 1-5  '), 18 * 60 + 10);
});
