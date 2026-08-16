import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTodayBar } from './mergeTodayBar';

interface Bar { date: string; close: number }
const d = (date: string, close: number): Bar => ({ date, close });
const getDate = (b: Bar) => b.date;

test('todayRow가 null이면 원본 그대로', () => {
  const rows = [d('2026-07-14', 100)];
  assert.deepEqual(mergeTodayBar(rows, null, getDate), rows);
});

test('오늘 date가 최신이면 append', () => {
  const rows = [d('2026-07-14', 100)];
  const out = mergeTodayBar(rows, d('2026-07-15', 110), getDate);
  assert.deepEqual(out, [d('2026-07-14', 100), d('2026-07-15', 110)]);
});

test('오늘 date가 마지막과 같으면 replace', () => {
  const rows = [d('2026-07-14', 100), d('2026-07-15', 105)];
  const out = mergeTodayBar(rows, d('2026-07-15', 110), getDate);
  assert.deepEqual(out, [d('2026-07-14', 100), d('2026-07-15', 110)]);
});

test('오늘 date가 과거면 그대로', () => {
  const rows = [d('2026-07-15', 105)];
  const out = mergeTodayBar(rows, d('2026-07-14', 90), getDate);
  assert.deepEqual(out, rows);
});

test('빈 배열이면 오늘 봉만', () => {
  const out = mergeTodayBar([], d('2026-07-15', 110), getDate);
  assert.deepEqual(out, [d('2026-07-15', 110)]);
});

test('입력 배열을 변경하지 않는다(불변)', () => {
  const rows = [d('2026-07-14', 100)];
  mergeTodayBar(rows, d('2026-07-15', 110), getDate);
  assert.equal(rows.length, 1);
});
