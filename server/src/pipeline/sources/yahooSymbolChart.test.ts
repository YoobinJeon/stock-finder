import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYahooSymbolChart } from './yahooSymbolChart';

// 야후 v8 chart 응답 축약 fixture (2026-07-12 실측: 6981.T 무라타, 3거래일 분만 축약)
const MURATA_RESPONSE = {
  chart: {
    result: [
      {
        meta: {
          currency: 'JPY',
          symbol: '6981.T',
          exchangeName: 'JPX',
          longName: 'Murata Manufacturing Co., Ltd.',
          regularMarketPrice: 9860,
          chartPreviousClose: 2131, // 액면분할 등으로 신뢰 불가 — 사용하지 않음
          fiftyTwoWeekHigh: 12895,
          fiftyTwoWeekLow: 2105,
        },
        timestamp: [1751500800, 1751587200, 1751673600],
        indicators: {
          quote: [
            {
              open: [9700, 9750, 9800],
              high: [9800, 9850, 9900],
              low: [9650, 9700, 9750],
              close: [9750, 9800, 9860],
            },
          ],
        },
      },
    ],
    error: null,
  },
};

test('야후 chart 응답에서 캔들과 메타 정보를 파싱한다', () => {
  const parsed = parseYahooSymbolChart(MURATA_RESPONSE);

  assert.ok(parsed);
  assert.equal(parsed!.candles.length, 3);
  assert.deepEqual(parsed!.candles[2], {
    trade_date: '2025-07-05',
    open: 9800,
    high: 9900,
    low: 9750,
    close: 9860,
  });

  // regularMarketPrice 우선 사용, chartPreviousClose는 신뢰 불가라 무시하고 직전 봉 종가로 등락률 계산
  assert.equal(parsed!.meta.price, 9860);
  assert.ok(Math.abs(parsed!.meta.changePct! - ((9860 - 9800) / 9800) * 100) < 1e-9);
  assert.equal(parsed!.meta.currency, 'JPY');
  assert.equal(parsed!.meta.exchange, 'JPX');
  assert.equal(parsed!.meta.longName, 'Murata Manufacturing Co., Ltd.');
  assert.equal(parsed!.meta.high52w, 12895);
  assert.equal(parsed!.meta.low52w, 2105);
});

test('fiftyTwoWeekHigh/Low가 meta에 없으면 일봉에서 계산한다', () => {
  const noMeta = {
    chart: {
      result: [
        {
          meta: { currency: 'USD', regularMarketPrice: 100 },
          timestamp: [1751500800, 1751587200],
          indicators: { quote: [{ open: [90, 95], high: [110, 105], low: [85, 90], close: [95, 100] }] },
        },
      ],
    },
  };
  const parsed = parseYahooSymbolChart(noMeta);
  assert.equal(parsed!.meta.high52w, 110);
  assert.equal(parsed!.meta.low52w, 85);
});

test('result가 없거나 종가가 전부 null이면 null을 반환한다', () => {
  assert.equal(parseYahooSymbolChart({ chart: { result: [] } }), null);
  assert.equal(parseYahooSymbolChart(null), null);
  assert.equal(
    parseYahooSymbolChart({ chart: { result: [{ meta: {}, timestamp: [1], indicators: { quote: [{ close: [null] }] } }] } }),
    null,
  );
});
