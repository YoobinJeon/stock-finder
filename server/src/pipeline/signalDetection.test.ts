import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVolumeSurgeHigh, isInstNewAccum, isRsTopEntry } from './signalDetection';

// ── volume_surge_high ──
test('volume_surge_high: 거래대금급증 3배 이상 + 고점 -3% 이내면 true', () => {
  assert.equal(isVolumeSurgeHigh(3, -2), true);
  assert.equal(isVolumeSurgeHigh(5, 0), true);
});

test('volume_surge_high: 배수는 충분하지만 고점에서 멀면 false', () => {
  assert.equal(isVolumeSurgeHigh(4, -5), false);
});

test('volume_surge_high: 고점 근접이지만 배수가 부족하면 false', () => {
  assert.equal(isVolumeSurgeHigh(2.9, -1), false);
});

test('volume_surge_high: null 입력이면 false', () => {
  assert.equal(isVolumeSurgeHigh(null, -1), false);
  assert.equal(isVolumeSurgeHigh(4, null), false);
});

// ── inst_new_accum ──
test('inst_new_accum: 5일 순매수 양수 + 20일 순매수 0 이하면 true', () => {
  assert.equal(isInstNewAccum(100, 0), true);
  assert.equal(isInstNewAccum(100, -500), true);
});

test('inst_new_accum: 20일도 이미 양수면 신규 매집이 아니므로 false', () => {
  assert.equal(isInstNewAccum(100, 50), false);
});

test('inst_new_accum: 5일이 0 이하면 false', () => {
  assert.equal(isInstNewAccum(0, -100), false);
  assert.equal(isInstNewAccum(-10, -100), false);
});

test('inst_new_accum: null 입력이면 false', () => {
  assert.equal(isInstNewAccum(null, -100), false);
  assert.equal(isInstNewAccum(100, null), false);
});

// ── rs_top_entry ──
test('rs_top_entry: 오늘 ≥90, 직전 <90이면 true (신규 진입)', () => {
  assert.equal(isRsTopEntry(90, 89.9), true);
  assert.equal(isRsTopEntry(95, 40), true);
});

test('rs_top_entry: 직전에도 이미 90 이상이면 false (이미 편입 상태)', () => {
  assert.equal(isRsTopEntry(95, 92), false);
});

test('rs_top_entry: 오늘 90 미만이면 false', () => {
  assert.equal(isRsTopEntry(89.9, 50), false);
});

test('rs_top_entry: null 입력(직전값 없음 등)이면 false', () => {
  assert.equal(isRsTopEntry(95, null), false);
  assert.equal(isRsTopEntry(null, 50), false);
});
