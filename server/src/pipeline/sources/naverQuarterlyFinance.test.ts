import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuarterlyFinance } from './naverQuarterlyFinance';

const EOK = 1e8;

/** 실제 응답(005930, 2026-07-29 실측)에서 형태만 남기고 줄인 픽스처 */
function payload(over: {
  titles?: Array<{ key: string; isConsensus?: string }>;
  rows?: Array<{ title: string; columns: Record<string, { value: string }> }>;
} = {}) {
  return {
    itemCode: '005930',
    financeInfo: {
      trTitleList: over.titles ?? [
        { isConsensus: 'N', title: '2025.03.', key: '202503' },
        { isConsensus: 'N', title: '2025.06.', key: '202506' },
        { isConsensus: 'Y', title: '2026.06.', key: '202606' },
      ],
      rowList: over.rows ?? [
        {
          title: '매출액',
          columns: {
            202503: { value: '791,405' },
            202506: { value: '745,663' },
            202606: { value: '1,738,644' },
          },
        },
        {
          title: '영업이익',
          columns: {
            202503: { value: '66,853' },
            202506: { value: '46,761' },
            202606: { value: '850,494' },
          },
        },
        {
          title: 'ROE',
          columns: {
            202503: { value: '1.72' },
            202506: { value: '1.26' },
            202606: { value: '-' },
          },
        },
      ],
    },
  };
}

test('억원 단위 금액을 원으로 환산한다', () => {
  const rows = parseQuarterlyFinance(payload());

  assert.equal(rows[0].fiscalYear, 2025);
  assert.equal(rows[0].fiscalQuarter, 1);
  assert.equal(rows[0].revenue, 791405 * EOK);
  assert.equal(rows[0].operatingIncome, 66853 * EOK);
});

test('isConsensus로 확정·추정을 구분한다', () => {
  const rows = parseQuarterlyFinance(payload());

  assert.deepEqual(
    rows.map((r) => `${r.fiscalYear}Q${r.fiscalQuarter}${r.isEstimate ? '(E)' : ''}`),
    ['2025Q1', '2025Q2', '2026Q2(E)'],
  );
});

test('분기 말월을 분기 번호로 옮긴다 (03/06/09/12 → 1/2/3/4)', () => {
  const rows = parseQuarterlyFinance(
    payload({
      titles: [
        { key: '202503' }, { key: '202506' }, { key: '202509' }, { key: '202512' },
      ],
      rows: [],
    }),
  );

  assert.deepEqual(rows.map((r) => r.fiscalQuarter), [1, 2, 3, 4]);
});

test('분기 말월이 아닌 열은 버린다', () => {
  const rows = parseQuarterlyFinance(
    payload({ titles: [{ key: '202503' }, { key: '202507' }], rows: [] }),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].fiscalQuarter, 1);
});

test('결측 표기 "-"는 null로 둔다 (0으로 뭉개지 않는다)', () => {
  const rows = parseQuarterlyFinance(payload());
  const consensus = rows.find((r) => r.isEstimate)!;

  assert.equal(consensus.roe, null);
  assert.notEqual(consensus.roe, 0);
});

test('음수 금액을 부호까지 파싱한다 (적자 분기)', () => {
  const rows = parseQuarterlyFinance(
    payload({
      titles: [{ key: '202503' }],
      rows: [{ title: '영업이익', columns: { 202503: { value: '-1,234' } } }],
    }),
  );

  assert.equal(rows[0].operatingIncome, -1234 * EOK);
});

test('ROE는 % → 소수로 바꾼다', () => {
  const rows = parseQuarterlyFinance(payload());

  assert.ok(Math.abs(rows[0].roe! - 0.0172) < 1e-9);
});

test('없는 계정과목은 null이며 예외를 던지지 않는다', () => {
  const rows = parseQuarterlyFinance(payload({ titles: [{ key: '202503' }], rows: [] }));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].revenue, null);
  assert.equal(rows[0].operatingIncome, null);
  assert.equal(rows[0].eps, null);
});

test('연도·분기 오름차순으로 정렬한다', () => {
  const rows = parseQuarterlyFinance(
    payload({
      titles: [{ key: '202603' }, { key: '202503' }, { key: '202512' }],
      rows: [],
    }),
  );

  assert.deepEqual(
    rows.map((r) => `${r.fiscalYear}Q${r.fiscalQuarter}`),
    ['2025Q1', '2025Q4', '2026Q1'],
  );
});

test('응답이 비었거나 형식이 깨져도 빈 배열을 준다', () => {
  assert.deepEqual(parseQuarterlyFinance(null), []);
  assert.deepEqual(parseQuarterlyFinance({}), []);
  assert.deepEqual(parseQuarterlyFinance({ financeInfo: {} }), []);
  assert.deepEqual(parseQuarterlyFinance('<!doctype html>'), []);
});
