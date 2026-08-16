import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEtfList } from './naverEtf';

// 실제 응답 구조를 축약한 합성 fixture (필드명 오타 amonut 포함)
const FIXTURE = {
  resultCode: 'success',
  result: {
    etfItemList: [
      {
        itemcode: '069500', etfTabCode: 1, itemname: 'KODEX 200',
        nowVal: 122480, risefall: '2', changeVal: 4780, changeRate: 4.06,
        nav: 122396.0, threeMonthEarnRate: 35.4985,
        quant: 18466222, amonut: 2259947, marketSum: 266149,
      },
      {
        itemcode: '999999', etfTabCode: 6, itemname: 'NAV 없는 채권 ETF',
        nowVal: 50000, changeRate: -0.1, nav: null, threeMonthEarnRate: null,
        quant: 100, amonut: 5, marketSum: 300,
      },
      // 신형 영문 혼합 코드 — 유효
      {
        itemcode: '00088A', etfTabCode: 4, itemname: '영문코드 ETF',
        nowVal: 10000, changeRate: 1.0, nav: 10000, threeMonthEarnRate: 2.0,
        quant: 10, amonut: 1, marketSum: 100,
      },
      // 형식 불량 행 — 건너뛰어야 함
      { itemcode: 'ABC', nowVal: 1000 },
      { itemcode: '123456', nowVal: 0 },
    ],
  },
};

test('ETF JSON에서 시세·NAV 괴리율·분류를 파싱한다', () => {
  const items = parseEtfList(FIXTURE);

  assert.equal(items.length, 3);
  assert.equal(items[2].ticker, '00088A'); // 신형 영문 혼합 코드 수용
  const kodex = items[0];
  assert.equal(kodex.ticker, '069500');
  assert.equal(kodex.tab, 1);
  assert.equal(kodex.price, 122480);
  assert.equal(kodex.changePct, 4.06);
  assert.equal(kodex.amount, 2259947); // amonut 오타 필드 수용
  assert.ok(kodex.deviationPct != null && Math.abs(kodex.deviationPct - 0.0686) < 0.01);

  const bond = items[1];
  assert.equal(bond.nav, null);
  assert.equal(bond.deviationPct, null);
  assert.equal(bond.threeMonthReturn, null);
});

test('래핑 구조가 다르거나 비어 있으면 빈 배열을 반환한다', () => {
  assert.deepEqual(parseEtfList({}), []);
  assert.deepEqual(parseEtfList(null), []);
  assert.deepEqual(parseEtfList({ result: { etfItemList: 'oops' } }), []);
});
