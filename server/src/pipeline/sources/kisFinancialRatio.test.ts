import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKisAnnualFinancials } from './kisFinancialRatio';

// 005930 실측 응답 축약본 (2026-07-26 조회, tr_id=FHKST66430300, FID_DIV_CLS_CODE=0).
// 맨 앞 202603은 **연간이 아니다** — 12월 결산인데 3월 기준 TTM 행이 섞여 내려온다.
const SAMSUNG_RESPONSE = {
  rt_cd: '0',
  msg1: '정상처리 되었습니다.',
  output: [
    { stac_yymm: '202603', eps: '6993.00', bps: '71907.00', roe_val: '19.16', sps: '57655' },
    { stac_yymm: '202512', eps: '6564.00', bps: '68000.00', roe_val: '18.50', sps: '55000' },
    { stac_yymm: '202412', eps: '4950.00', bps: '62000.00', roe_val: '15.20', sps: '50000' },
    { stac_yymm: '200412', eps: '1259.00', bps: '4464.00', roe_val: '0.00', sps: '0' },
  ],
};

test('TTM 행(결산월이 다른 행)을 걸러낸다', () => {
  const result = parseKisAnnualFinancials(SAMSUNG_RESPONSE);

  assert.deepEqual(
    result.map((r) => r.fiscalYear),
    [2004, 2024, 2025],
    '202603 TTM 행은 빠지고 12월 결산 3개만 남아야 한다',
  );
});

test('오래된 연도부터 오름차순으로 반환한다', () => {
  const result = parseKisAnnualFinancials(SAMSUNG_RESPONSE);

  assert.equal(result[0].fiscalYear, 2004);
  assert.equal(result[result.length - 1].fiscalYear, 2025);
});

test('EPS·BPS·ROE·SPS를 숫자로 변환한다', () => {
  const result = parseKisAnnualFinancials(SAMSUNG_RESPONSE);
  const y2025 = result.find((r) => r.fiscalYear === 2025)!;

  assert.equal(y2025.eps, 6564);
  assert.equal(y2025.bps, 68000);
  assert.equal(y2025.roe, 18.5);
  assert.equal(y2025.sps, 55000);
});

test('12월 결산이 아닌 종목도 다수 결산월 기준으로 걸러진다', () => {
  const raw = {
    rt_cd: '0',
    output: [
      { stac_yymm: '202512', eps: '100' }, // TTM (소수 월)
      { stac_yymm: '202503', eps: '200' },
      { stac_yymm: '202403', eps: '300' },
      { stac_yymm: '202303', eps: '400' },
    ],
  };

  const result = parseKisAnnualFinancials(raw);

  assert.deepEqual(result.map((r) => r.fiscalYear), [2023, 2024, 2025]);
  assert.equal(result[result.length - 1].eps, 200, '3월 결산 행만 남아야 한다');
});

test('rt_cd가 0이 아니면 빈 배열', () => {
  assert.deepEqual(parseKisAnnualFinancials({ rt_cd: '1', msg1: '오류', output: [] }), []);
});

test('output이 없거나 배열이 아니어도 예외를 던지지 않는다', () => {
  assert.deepEqual(parseKisAnnualFinancials({ rt_cd: '0' }), []);
  assert.deepEqual(parseKisAnnualFinancials({ rt_cd: '0', output: '이상한값' }), []);
  assert.deepEqual(parseKisAnnualFinancials(null), []);
  assert.deepEqual(parseKisAnnualFinancials(undefined), []);
});

test('stac_yymm 형식이 어긋난 행은 건너뛴다', () => {
  const raw = {
    rt_cd: '0',
    output: [
      { stac_yymm: '2025-12', eps: '100' }, // 하이픈 포함
      { eps: '200' },                        // 기간 없음
      { stac_yymm: '202512', eps: '300' },
      { stac_yymm: '202412', eps: '400' },
    ],
  };

  const result = parseKisAnnualFinancials(raw);

  assert.deepEqual(result.map((r) => r.fiscalYear), [2024, 2025]);
});

test('값이 비어 있으면 0이 아니라 null로 남긴다', () => {
  const raw = { rt_cd: '0', output: [{ stac_yymm: '202512', eps: '', bps: '100' }] };

  const [row] = parseKisAnnualFinancials(raw);

  assert.equal(row.eps, null);
  assert.equal(row.bps, 100);
  assert.equal(row.roe, null);
});
