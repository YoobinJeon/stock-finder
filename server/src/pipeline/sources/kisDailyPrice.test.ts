import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffAdjustmentSeries, parseKisDailyPrices } from './kisDailyPrice';
import type { DailyPrice } from './yahooPrices';

// 010120 실측 응답 축약본 (2026-07-26 조회, tr_id=FHKST03010100, FID_ORG_ADJ_PRC=0).
// 원천은 최신일 우선 내림차순으로 내려준다 — 파서가 오름차순으로 뒤집는지 확인하기 위해 그대로 둔다.
const LS_RESPONSE = {
  rt_cd: '0',
  msg1: '정상처리 되었습니다.',
  output2: [
    {
      stck_bsop_date: '20260724', stck_clpr: '202000', stck_oprc: '218500',
      stck_hgpr: '226000', stck_lwpr: '200000', acml_vol: '1120437',
      flng_cls_code: '00', prtt_rate: '0.00', mod_yn: 'N', revl_issu_reas: '',
    },
    {
      stck_bsop_date: '20260723', stck_clpr: '223500', stck_oprc: '220000',
      stck_hgpr: '225000', stck_lwpr: '218000', acml_vol: '850000',
      flng_cls_code: '00', prtt_rate: '0.00', mod_yn: 'N', revl_issu_reas: '',
    },
    {
      stck_bsop_date: '20260722', stck_clpr: '219000', stck_oprc: '215000',
      stck_hgpr: '221000', stck_lwpr: '214500', acml_vol: '720000',
      flng_cls_code: '00', prtt_rate: '0.00', mod_yn: 'N', revl_issu_reas: '',
    },
  ],
};

test('과거→최신 오름차순으로 파싱한다', () => {
  const result = parseKisDailyPrices(LS_RESPONSE);

  assert.deepEqual(
    result.map((r) => r.trade_date),
    ['2026-07-22', '2026-07-23', '2026-07-24'],
  );
});

test('OHLCV를 숫자로 변환한다', () => {
  const result = parseKisDailyPrices(LS_RESPONSE);
  const latest = result[result.length - 1];

  assert.equal(latest.trade_date, '2026-07-24');
  assert.equal(latest.open, 218500);
  assert.equal(latest.high, 226000);
  assert.equal(latest.low, 200000);
  assert.equal(latest.close, 202000);
  assert.equal(latest.volume, 1120437);
});

test('rt_cd가 0이 아니면 빈 배열', () => {
  assert.deepEqual(parseKisDailyPrices({ rt_cd: '1', msg1: '오류', output2: [] }), []);
});

test('output2가 없거나 배열이 아니어도 예외를 던지지 않는다', () => {
  assert.deepEqual(parseKisDailyPrices({ rt_cd: '0' }), []);
  assert.deepEqual(parseKisDailyPrices({ rt_cd: '0', output2: '이상한값' }), []);
  assert.deepEqual(parseKisDailyPrices(null), []);
  assert.deepEqual(parseKisDailyPrices(undefined), []);
});

test('날짜 형식이 어긋나거나 종가가 없는 행은 건너뛴다', () => {
  const raw = {
    rt_cd: '0',
    output2: [
      { stck_bsop_date: '2026-07-24', stck_clpr: '100' }, // 하이픈 포함 → 형식 불량
      { stck_clpr: '200' },                                // 날짜 없음
      { stck_bsop_date: '20260723', stck_clpr: '' },       // 종가 없음
      { stck_bsop_date: '20260722', stck_clpr: '300' },
    ],
  };

  const result = parseKisDailyPrices(raw);

  assert.equal(result.length, 1);
  assert.equal(result[0].trade_date, '2026-07-22');
  assert.equal(result[0].close, 300);
});

// --- 기업행위 감지 ---------------------------------------------------------
// 005930 2018-05 액면분할 50:1 실측값. flng_cls_code는 실제로 '00'이었으므로 쓰지 않고,
// 수정주가/원주가 두 계열의 종가 비율로 판정한다.

const bar = (trade_date: string, close: number): DailyPrice => ({
  trade_date, open: close, high: close, low: close, close, volume: 1000,
});

const SAMSUNG_ADJUSTED = [
  bar('2018-04-25', 50400), bar('2018-04-26', 52140), bar('2018-04-27', 53000),
  bar('2018-05-04', 51900), bar('2018-05-08', 52600), bar('2018-05-09', 50900),
];
const SAMSUNG_ORIGINAL = [
  bar('2018-04-25', 2520000), bar('2018-04-26', 2607000), bar('2018-04-27', 2650000),
  bar('2018-05-04', 51900), bar('2018-05-08', 52600), bar('2018-05-09', 50900),
];

test('액면분할을 조정 완료 첫 거래일과 배수로 감지한다', () => {
  const events = diffAdjustmentSeries(SAMSUNG_ADJUSTED, SAMSUNG_ORIGINAL);

  assert.equal(events.length, 1);
  assert.equal(events[0].date, '2018-05-04', '조정이 끝나 두 계열이 같아지는 첫 거래일');
  assert.ok(
    Math.abs(events[0].factor - 50) < 0.1,
    `분할 배수 50에 근접해야 함 (실제 ${events[0].factor})`,
  );
});

test('기업행위가 없으면 빈 배열 — 두 계열이 내내 같을 때', () => {
  const same = [bar('2026-07-22', 1000), bar('2026-07-23', 1100), bar('2026-07-24', 1050)];

  assert.deepEqual(diffAdjustmentSeries(same, same), []);
});

test('반올림 오차(2% 이내)는 기업행위로 보지 않는다', () => {
  // NAVER 5:1 실측에서 비율이 4.99~5.00으로 흔들렸다 — 이 정도 흔들림에 이벤트가 나면 안 된다.
  const adjusted = [bar('2018-10-05', 140999), bar('2018-10-08', 141000)];
  const original = [bar('2018-10-05', 704000), bar('2018-10-08', 704500)];

  assert.deepEqual(diffAdjustmentSeries(adjusted, original), []);
});

test('공통 거래일이 2일 미만이면 판정하지 않는다', () => {
  assert.deepEqual(diffAdjustmentSeries([bar('2026-07-24', 100)], [bar('2026-07-24', 100)]), []);
  assert.deepEqual(diffAdjustmentSeries([bar('2026-07-24', 100)], [bar('2026-07-23', 100)]), []);
});

test('종가가 0 이하인 날은 비율 산출에서 제외한다', () => {
  const adjusted = [bar('2026-07-22', 0), bar('2026-07-23', 100), bar('2026-07-24', 100)];
  const original = [bar('2026-07-22', 500), bar('2026-07-23', 100), bar('2026-07-24', 100)];

  assert.deepEqual(diffAdjustmentSeries(adjusted, original), []);
});
