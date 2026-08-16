import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKisFuturesQuote } from './kisNightFutures';

// 10100000 야간 세션(CM) 실측 응답 축약본 (2026-07-26 조회, tr_id=FHMIF10000000).
// 같은 시각 주간(F)은 prpr 1063.50 / vrss -69.00 / ctrt -6.09 / clpr 1132.50 — 세션이 갈린다.

// **등락 기준에 주의**: 야간의 vrss(-29.45)는 전일 야간 종가(clpr 1121.00)가 아니라
// **기준가(sdpr 1063.50 = 당일 주간 종가)** 대비다. 1034.05 - 1063.50 = -29.45.
// 야간 티커로서는 이게 맞는 의미다 — 주간 마감 이후의 오버나이트 변동을 보여준다.
const NIGHT_RESPONSE = {
  rt_cd: '0',
  msg1: '정상처리 되었습니다.',
  output1: {
    hts_kor_isnm: 'F 202609',
    futs_prpr: '1034.05',
    futs_prdy_vrss: '-29.45',
    futs_prdy_ctrt: '-2.77',
    futs_prdy_clpr: '1121.00',
    futs_sdpr: '1063.50',
    acml_vol: '25397',
    futs_last_tr_date: '20260910',
  },
};

test('야간 세션 시세를 파싱한다', () => {
  const q = parseKisFuturesQuote(NIGHT_RESPONSE, '10100000');

  assert.ok(q);
  assert.equal(q.itemCode, '10100000');
  assert.equal(q.price, 1034.05);
  assert.equal(q.change, -29.45, '전일 야간 종가가 아니라 기준가(주간 종가) 대비');
  assert.equal(q.changePct, -2.77);
  assert.equal(q.up, false);
});

test('종목명은 원본 그대로 보존한다 (만기 확인용)', () => {
  const q = parseKisFuturesQuote(NIGHT_RESPONSE, '10100000');

  assert.equal(q?.name, 'F 202609');
});

test('상승이면 up=true', () => {
  const raw = { rt_cd: '0', output1: { futs_prpr: '1100.00', futs_prdy_vrss: '5.50', futs_prdy_ctrt: '0.50' } };

  assert.equal(parseKisFuturesQuote(raw, '10100000')?.up, true);
});

// --- 실측으로 확인한 함정 2개 -------------------------------------------------

test('output(단수)에만 값이 있으면 파싱하지 않는다 — 컨테이너는 output1이다', () => {
  const raw = { rt_cd: '0', output: { futs_prpr: '1034.05', futs_prdy_vrss: '-86.95' } };

  assert.equal(
    parseKisFuturesQuote(raw, '10100000'),
    null,
    'output만 읽던 초기 프로브가 전 코드를 미지원으로 오판했던 지점',
  );
});

test('잘못된 종목코드도 rt_cd=0을 주므로 시세 필드로 판정한다', () => {
  // 실측: 16500000·11100000·10700000 모두 rt_cd=0이지만 시세 필드가 없었다
  const raw = { rt_cd: '0', msg1: '정상처리 되었습니다.', output1: { hts_kor_isnm: '종합' } };

  assert.equal(parseKisFuturesQuote(raw, '16500000'), null);
});

test('현재가가 0 이하면 미거래로 보고 null', () => {
  assert.equal(parseKisFuturesQuote({ rt_cd: '0', output1: { futs_prpr: '0.00' } }, 'x'), null);
  assert.equal(parseKisFuturesQuote({ rt_cd: '0', output1: { futs_prpr: '' } }, 'x'), null);
});

test('rt_cd가 0이 아니면 null', () => {
  assert.equal(
    parseKisFuturesQuote({ rt_cd: '2', msg1: '오류', output1: { futs_prpr: '1034.05' } }, 'x'),
    null,
  );
});

test('응답이 비정상이어도 예외를 던지지 않는다', () => {
  assert.equal(parseKisFuturesQuote(null, 'x'), null);
  assert.equal(parseKisFuturesQuote(undefined, 'x'), null);
  assert.equal(parseKisFuturesQuote({ rt_cd: '0' }, 'x'), null);
  assert.equal(parseKisFuturesQuote({ rt_cd: '0', output1: '이상한값' }, 'x'), null);
});

test('전일대비가 없으면 0으로 두되 현재가는 살린다', () => {
  const q = parseKisFuturesQuote({ rt_cd: '0', output1: { futs_prpr: '1034.05' } }, 'x');

  assert.equal(q?.price, 1034.05);
  assert.equal(q?.change, 0);
  assert.equal(q?.changePct, 0);
});
