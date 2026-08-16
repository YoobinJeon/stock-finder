import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTvFuturesScan } from './tradingviewFutures';

// 트레이딩뷰 scanner API(/global/scan) 응답 fixture (2026-07-12 오케스트레이터 실측)
const RESPONSE = {
  totalCount: 1,
  data: [
    { s: 'KRX:KQI1!', d: ['KQI1!', 1469.8, 0, 'KOSDAQ150 Futures'] },
  ],
};

test('scan 응답에서 티커별 시세를 파싱한다', () => {
  const map = parseTvFuturesScan(RESPONSE);

  assert.equal(map.size, 1);
  assert.deepEqual(map.get('KRX:KQI1!'), {
    ticker: 'KRX:KQI1!',
    name: 'KQI1!',
    price: 1469.8,
    changePct: 0,
    description: 'KOSDAQ150 Futures',
  });
});

test('음수 등락률도 그대로 파싱한다', () => {
  const map = parseTvFuturesScan({
    data: [{ s: 'KRX:KQI1!', d: ['KQI1!', 1450.2, -1.34, 'KOSDAQ150 Futures'] }],
  });

  assert.equal(map.get('KRX:KQI1!')!.changePct, -1.34);
});

test('data가 없거나 형식이 다르면 빈 맵을 반환한다', () => {
  assert.equal(parseTvFuturesScan({}).size, 0);
  assert.equal(parseTvFuturesScan(null).size, 0);
  assert.equal(parseTvFuturesScan({ data: [{ s: 'X' }] }).size, 0); // d 없음 → 제외
  assert.equal(parseTvFuturesScan({ data: [{ s: '', d: ['n', 1, 0, 'desc'] }] }).size, 0); // 티커 없음 → 제외
});
