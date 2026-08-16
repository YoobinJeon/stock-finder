import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeReturnPct,
  summarizeReturns,
  aggregateSignalPerformance,
  type SignalReturnRow,
} from './signalPerformance';

test('computeReturnPct — 상승/하락 수익률(%) 계산', () => {
  assert.equal(computeReturnPct(10000, 11000), 10);
  assert.equal(computeReturnPct(10000, 9000), -10);
  assert.equal(computeReturnPct(10000, 10000), 0);
});

test('summarizeReturns — 평균수익률·승률 계산, 반올림 규칙 준수', () => {
  const stats = summarizeReturns([10, -5, 5]);
  assert.equal(stats.n, 3);
  assert.equal(stats.avgRet, Math.round(((10 - 5 + 5) / 3) * 100) / 100);
  assert.equal(stats.winRate, Math.round((2 / 3) * 1000) / 10);
});

test('summarizeReturns — 빈 배열이면 n=0, avgRet/winRate=0 (NaN 아님)', () => {
  const stats = summarizeReturns([]);
  assert.deepEqual(stats, { n: 0, avgRet: 0, winRate: 0 });
});

test('summarizeReturns — 입력 배열 불변', () => {
  const rets = [1, 2, 3];
  const snapshot = [...rets];
  summarizeReturns(rets);
  assert.deepEqual(rets, snapshot);
});

const row = (over: Partial<SignalReturnRow>): SignalReturnRow => ({
  type: 'golden_cross',
  baseClose: 10000,
  close5d: 11000,
  close20d: 12000,
  ...over,
});

test('aggregateSignalPerformance — 타입별로 ret5d/ret20d 분리 집계', () => {
  const rows = [
    row({ type: 'golden_cross', close5d: 11000, close20d: 12000 }),
    row({ type: 'high_52w', close5d: 9000, close20d: 8000 }),
  ];
  const out = aggregateSignalPerformance(rows);
  const golden = out.find((o) => o.type === 'golden_cross')!;
  const high52w = out.find((o) => o.type === 'high_52w')!;
  assert.equal(golden.ret5d.avgRet, 10);
  assert.equal(golden.ret20d.avgRet, 20);
  assert.equal(high52w.ret5d.avgRet, -10);
  assert.equal(high52w.ret20d.avgRet, -20);
});

test('aggregateSignalPerformance — 기간 미도래(close가 null)는 pending 카운트로 제외', () => {
  const rows = [
    row({ close5d: 11000, close20d: null }),
    row({ close5d: null, close20d: null }),
  ];
  const out = aggregateSignalPerformance(rows);
  const golden = out.find((o) => o.type === 'golden_cross')!;
  assert.equal(golden.count, 2);
  assert.equal(golden.ret5d.n, 1);
  assert.equal(golden.pending5d, 1);
  assert.equal(golden.ret20d.n, 0);
  assert.equal(golden.pending20d, 2);
});

test('aggregateSignalPerformance — ret5d.avgRet 내림차순 정렬', () => {
  const rows = [
    row({ type: 'a', baseClose: 10000, close5d: 9500 }),  // -5%
    row({ type: 'b', baseClose: 10000, close5d: 10500 }), // +5%
  ];
  const out = aggregateSignalPerformance(rows);
  assert.deepEqual(out.map((o) => o.type), ['b', 'a']);
});

test('aggregateSignalPerformance — 입력 배열 불변', () => {
  const rows = [row({}), row({ type: 'high_52w' })];
  const snapshot = JSON.stringify(rows);
  aggregateSignalPerformance(rows);
  assert.equal(JSON.stringify(rows), snapshot);
});

test('aggregateSignalPerformance — 빈 입력이면 빈 배열 반환', () => {
  assert.deepEqual(aggregateSignalPerformance([]), []);
});
