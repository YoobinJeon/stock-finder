import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMultiAcnt, deriveQ4 } from './dartQuarterly';

/** fnlttMultiAcnt 응답 행 (실제 형태에서 필요한 필드만) */
function row(over: {
  corp: string; fs?: string; account: string; amount: string;
}) {
  return {
    corp_code: over.corp,
    fs_div: over.fs ?? 'CFS',
    account_nm: over.account,
    thstrm_amount: over.amount,
    sj_div: 'IS',
  };
}

test('콤마 섞인 금액을 수치로 파싱한다', () => {
  const m = parseMultiAcnt({
    list: [
      row({ corp: '00126380', account: '매출액', amount: '86,061,747,000,000' }),
      row({ corp: '00126380', account: '영업이익', amount: '12,166,062,000,000' }),
    ],
  });

  assert.equal(m.get('00126380')?.revenue, 86061747000000);
  assert.equal(m.get('00126380')?.operatingIncome, 12166062000000);
});

test('음수 금액(적자)을 부호까지 파싱한다', () => {
  const m = parseMultiAcnt({
    list: [row({ corp: 'A', account: '영업이익', amount: '-1,234,000,000' })],
  });

  assert.equal(m.get('A')?.operatingIncome, -1234000000);
});

test('연결(CFS)이 별도(OFS)보다 우선한다', () => {
  const m = parseMultiAcnt({
    list: [
      row({ corp: 'A', fs: 'OFS', account: '매출액', amount: '100' }),
      row({ corp: 'A', fs: 'CFS', account: '매출액', amount: '500' }),
    ],
  });

  assert.equal(m.get('A')?.revenue, 500);
});

test('연결이 없으면 별도로 폴백한다', () => {
  const m = parseMultiAcnt({
    list: [row({ corp: 'A', fs: 'OFS', account: '매출액', amount: '100' })],
  });

  assert.equal(m.get('A')?.revenue, 100);
});

test('계정명 변형을 매출액으로 인정한다', () => {
  for (const name of ['매출액', '수익(매출액)', '영업수익']) {
    const m = parseMultiAcnt({ list: [row({ corp: 'A', account: name, amount: '777' })] });
    assert.equal(m.get('A')?.revenue, 777, `${name} 미인식`);
  }
});

test('영업이익(손실) 표기도 영업이익으로 인정한다', () => {
  const m = parseMultiAcnt({
    list: [row({ corp: 'A', account: '영업이익(손실)', amount: '-50' })],
  });

  assert.equal(m.get('A')?.operatingIncome, -50);
});

test('금융업처럼 매출액 계정이 없으면 매출은 null로 남는다', () => {
  // 하나금융지주 실측: 주요계정에 이자수익·순이자손익만 있고 매출액이 없다.
  const m = parseMultiAcnt({
    list: [
      row({ corp: 'A', account: '이자수익', amount: '1000' }),
      row({ corp: 'A', account: '순이자손익', amount: '500' }),
      row({ corp: 'A', account: '영업이익(손실)', amount: '300' }),
    ],
  });

  assert.equal(m.get('A')?.revenue, null);
  assert.equal(m.get('A')?.operatingIncome, 300);
});

test('같은 계정이 반복되면 첫 값을 유지한다 (재작성분 방어)', () => {
  const m = parseMultiAcnt({
    list: [
      row({ corp: 'A', account: '매출액', amount: '100' }),
      row({ corp: 'A', account: '매출액', amount: '999' }),
    ],
  });

  assert.equal(m.get('A')?.revenue, 100);
});

test('관심 없는 계정·알 수 없는 fs_div는 무시한다', () => {
  const m = parseMultiAcnt({
    list: [
      row({ corp: 'A', account: '당기순이익', amount: '100' }),
      row({ corp: 'A', fs: 'XXX', account: '매출액', amount: '999' }),
    ],
  });

  assert.equal(m.has('A'), false);
});

test('결측 "-"·빈 금액은 null', () => {
  const m = parseMultiAcnt({
    list: [
      row({ corp: 'A', account: '매출액', amount: '-' }),
      row({ corp: 'A', account: '영업이익', amount: '' }),
    ],
  });

  assert.equal(m.get('A')?.revenue, null);
  assert.equal(m.get('A')?.operatingIncome, null);
});

test('응답이 비었거나 형식이 깨져도 빈 맵', () => {
  assert.equal(parseMultiAcnt(null).size, 0);
  assert.equal(parseMultiAcnt({}).size, 0);
  assert.equal(parseMultiAcnt({ list: 'nope' }).size, 0);
  assert.equal(parseMultiAcnt({ list: [] }).size, 0);
});

// ── deriveQ4: 사업보고서는 연간 누적만 주므로 4분기를 유도해야 한다 ──

test('4분기 = 연간 − (1~3분기)', () => {
  // 삼성전자 2024 실측(억원 아님, 원 단위): Q1~Q3 + 연간 → Q4 75.79조
  assert.equal(deriveQ4(100, 200, 300, 1000), 400);
});

test('4분기 유도: 적자 분기도 부호대로 나온다', () => {
  assert.equal(deriveQ4(100, 100, 100, 250), -50);
});

test('4분기 유도: 하나라도 결측이면 유도하지 않는다 (0으로 보면 Q4가 부풀려진다)', () => {
  assert.equal(deriveQ4(null, 200, 300, 1000), null);
  assert.equal(deriveQ4(100, null, 300, 1000), null);
  assert.equal(deriveQ4(100, 200, null, 1000), null);
  assert.equal(deriveQ4(100, 200, 300, null), null);
});

test('4분기 유도: 합이 정확히 연간이면 0', () => {
  assert.equal(deriveQ4(100, 200, 300, 600), 0);
});
