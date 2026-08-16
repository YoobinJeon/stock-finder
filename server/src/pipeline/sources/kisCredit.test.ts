import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKisCreditTrend } from './kisCredit';

// 010120 실측 응답 축약본 (2026-07-26 조회, tr_id=FHPST04760000) — 거래일 3건.
// 20260624 행은 키움 ka10013이 결제일 20260626으로 같은 값(1,633,820주)을 내려준 것과 교차확인됨.
const LS_RESPONSE = {
  rt_cd: '0',
  msg1: '정상처리 되었습니다.',
  output: [
    {
      deal_date: '20260624', stlm_date: '20260626', stck_prpr: '224500', prdy_vrss: '-8000',
      acml_vol: '934529', whol_loan_new_stcn: '228988', whol_loan_rdmp_stcn: '185798',
      whol_loan_rmnd_stcn: '1633820', whol_loan_rmnd_amt: '33675546',
      whol_loan_rmnd_rate: '1.08', whol_loan_gvrt: '24.49',
      whol_stln_rmnd_stcn: '2370', whol_stln_rmnd_rate: '0.00',
    },
    {
      deal_date: '20260609', stlm_date: '20260611', stck_prpr: '219500', prdy_vrss: '+3000',
      acml_vol: '500000', whol_loan_new_stcn: '67008', whol_loan_rdmp_stcn: '71218',
      whol_loan_rmnd_stcn: '1308514', whol_loan_rmnd_amt: '26224100',
      whol_loan_rmnd_rate: '0.87', whol_loan_gvrt: '20.10',
      whol_stln_rmnd_stcn: '1774', whol_stln_rmnd_rate: '0.00',
    },
    {
      deal_date: '20260601', stlm_date: '20260604', stck_prpr: '239500', prdy_vrss: '-1000',
      acml_vol: '700000', whol_loan_new_stcn: '262301', whol_loan_rdmp_stcn: '383582',
      whol_loan_rmnd_stcn: '1352347', whol_loan_rmnd_amt: '27420100',
      whol_loan_rmnd_rate: '0.89', whol_loan_gvrt: '22.00',
      whol_stln_rmnd_stcn: '2227', whol_stln_rmnd_rate: '0.00',
    },
  ],
};

test('거래일 기준 최신일 우선으로 파싱한다', () => {
  const result = parseKisCreditTrend(LS_RESPONSE);

  assert.equal(result.length, 3);
  assert.deepEqual(result.map((r) => r.date), ['2026-06-24', '2026-06-09', '2026-06-01']);
});

test('거래일과 결제일을 각각 보존한다 — 키움은 결제일만 주던 부분', () => {
  const [latest] = parseKisCreditTrend(LS_RESPONSE);

  assert.equal(latest.date, '2026-06-24');
  assert.equal(latest.settlementDate, '2026-06-26');
});

test('잔고금액 단위를 만원 → 원으로 환산한다 (키움 백만원×100과 교차확인)', () => {
  const [latest] = parseKisCreditTrend(LS_RESPONSE);

  assert.equal(latest.remainQty, 1633820);
  assert.equal(latest.remainAmt, 33675546 * 10000);
});

test('잔고 전일대비는 신규-상환으로 산출한다 (KIS가 직접 주지 않음)', () => {
  const [latest] = parseKisCreditTrend(LS_RESPONSE);

  assert.equal(latest.changeQty, 228988 - 185798);
});

test('대주(공매도) 잔고를 같은 응답에서 채운다', () => {
  const [latest] = parseKisCreditTrend(LS_RESPONSE);

  assert.equal(latest.shortRemainQty, 2370);
  assert.equal(latest.shortRemainRatio, 0);
});

test('공여율·잔고율은 원본 % 값을 그대로 유지한다', () => {
  const [latest] = parseKisCreditTrend(LS_RESPONSE);

  assert.equal(latest.remainRatio, 1.08);
  assert.equal(latest.shareRatio, 24.49);
});

test('rt_cd가 0이 아니면 빈 배열', () => {
  assert.deepEqual(parseKisCreditTrend({ rt_cd: '1', msg1: '오류', output: [] }), []);
});

test('output이 없거나 배열이 아니어도 예외를 던지지 않는다', () => {
  assert.deepEqual(parseKisCreditTrend({ rt_cd: '0' }), []);
  assert.deepEqual(parseKisCreditTrend({ rt_cd: '0', output: '이상한값' }), []);
  assert.deepEqual(parseKisCreditTrend(null), []);
  assert.deepEqual(parseKisCreditTrend(undefined), []);
});

test('deal_date가 없거나 형식이 어긋난 행은 건너뛴다', () => {
  const raw = {
    rt_cd: '0',
    output: [
      { deal_date: '2026-06-24', whol_loan_rmnd_stcn: '100' }, // 하이픈 포함 → 형식 불량
      { whol_loan_rmnd_stcn: '200' },                          // deal_date 없음
      { deal_date: '20260624', whol_loan_rmnd_stcn: '300' },
    ],
  };

  const result = parseKisCreditTrend(raw);

  assert.equal(result.length, 1);
  assert.equal(result[0].remainQty, 300);
});

test('필드가 비어 있으면 0이 아니라 null로 남긴다', () => {
  const raw = { rt_cd: '0', output: [{ deal_date: '20260624', whol_loan_rmnd_stcn: '', whol_loan_rmnd_amt: '' }] };

  const [row] = parseKisCreditTrend(raw);

  assert.equal(row.remainQty, null);
  assert.equal(row.remainAmt, null);
  assert.equal(row.changeQty, null, '신규·상환이 없으면 전일대비도 산출 불가');
});
