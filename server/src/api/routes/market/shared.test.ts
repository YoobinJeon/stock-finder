import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTodayBar } from './shared';

// 네이버 realtime domestic/stock 단일 종목 payload 축약 fixture
const SAMPLE = {
  itemCode: '005930',
  closePrice: '71,900',
  openPrice: '71,000',
  highPrice: '72,300',
  lowPrice: '70,800',
  accumulatedTradingVolume: '12,345,678',
  localTradedAt: '2026-07-15T15:30:00+09:00',
};

test('OHLCV+date를 정확히 파싱한다', () => {
  const bar = parseTodayBar(SAMPLE);
  assert.deepEqual(bar, {
    date: '2026-07-15',
    open: 71000,
    high: 72300,
    low: 70800,
    close: 71900,
    volume: 12345678,
  });
});

test('현재가(closePrice) 없으면 null', () => {
  assert.equal(parseTodayBar({ itemCode: '005930' }), null);
});

test('OHL 필드 누락 시 close로 폴백', () => {
  const bar = parseTodayBar({ itemCode: '000660', closePrice: '100', localTradedAt: '2026-07-15T10:00:00+09:00' });
  assert.deepEqual(bar, { date: '2026-07-15', open: 100, high: 100, low: 100, close: 100, volume: 0 });
});
