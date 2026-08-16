import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNaverFuturesPolling } from './naverFutures';

// 네이버 실시간 폴링 API(/api/realtime/domestic/index/FUT,...) 응답 축약 fixture (2026-07-12 실측 마크업 패턴)
const RESPONSE = {
  pollingInterval: 70000,
  datas: [
    {
      itemCode: 'FUT',
      stockName: '코스피 200 선물',
      closePrice: '1,209.55',
      compareToPreviousClosePrice: '30.00',
      compareToPreviousPrice: { code: '2', text: '상승', name: 'RISING' },
      fluctuationsRatio: '2.54',
    },
    {
      itemCode: 'KPI200',
      stockName: '코스피 200',
      closePrice: '1,196.69',
      compareToPreviousClosePrice: '-26.96',
      compareToPreviousPrice: { code: '5', text: '하락', name: 'FALLING' },
      fluctuationsRatio: '-2.30',
    },
  ],
  time: '20260712093234',
};

test('폴링 응답에서 itemCode별 시세를 파싱한다', () => {
  const map = parseNaverFuturesPolling(RESPONSE);

  assert.equal(map.size, 2);
  assert.deepEqual(map.get('FUT'), {
    itemCode: 'FUT',
    name: '코스피 200 선물',
    price: 1209.55,
    change: 30,
    changePct: 2.54,
    up: true,
  });

  const kpi200 = map.get('KPI200')!;
  assert.equal(kpi200.change, -26.96);
  assert.equal(kpi200.up, false);
});

test('datas가 없거나 형식이 다르면 빈 맵을 반환한다', () => {
  assert.equal(parseNaverFuturesPolling({}).size, 0);
  assert.equal(parseNaverFuturesPolling(null).size, 0);
  assert.equal(parseNaverFuturesPolling({ datas: [{ itemCode: 'X' }] }).size, 0); // closePrice 없음 → 제외
});
