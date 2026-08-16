import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConsensusRows, parseQuarterlyConsensusRows } from './naverConsensus';

// 005930 실측 응답 축약본(2026-07-25 조회) — 확정 4개년(A) + 추정 3개년(E)
const SAMSUNG_JSON = JSON.stringify({
  JsonData: [
    { YYMM: '2022.12(A)', SALES: '3,022,313.6', YOY: '8.09', OP: '433,766.3', NP: '547,300.2', EPS: '8,057', BPS: '50,817', PER: '6.86', PBR: '1.09', ROE: '17.07', EV: '3.23', MAIN: 'IFRS연결', TOT_ROW: 7 },
    { YYMM: '2023.12(A)', SALES: '2,589,354.9', YOY: '-14.33', OP: '65,669.8', NP: '144,734.0', EPS: '2,131', BPS: '52,002', PER: '36.84', PBR: '1.51', ROE: '4.14', EV: '9.73', MAIN: 'IFRS연결', TOT_ROW: 7 },
    { YYMM: '2024.12(A)', SALES: '3,008,709.0', YOY: '16.20', OP: '327,259.6', NP: '336,213.6', EPS: '4,950', BPS: '57,981', PER: '10.75', PBR: '0.92', ROE: '9.03', EV: '3.46', MAIN: 'IFRS연결', TOT_ROW: 7 },
    { YYMM: '2025.12(A)', SALES: '3,336,059.4', YOY: '10.88', OP: '436,010.5', NP: '442,609.6', EPS: '6,564', BPS: '63,997', PER: '18.27', PBR: '1.87', ROE: '10.85', EV: '7.53', MAIN: 'IFRS연결', TOT_ROW: 7 },
    { YYMM: '2026.12(E)', SALES: '7,324,741.2', YOY: '119.56', OP: '3,832,416.1', NP: '3,112,642.4', EPS: '46,664', BPS: '109,170', PER: '5.35', PBR: '2.29', ROE: '54.54', EV: '3.00', MAIN: 'IFRS연결', TOT_ROW: 7 },
    { YYMM: '2027.12(E)', SALES: '9,465,111.5', YOY: '29.22', OP: '5,422,608.6', NP: '4,374,955.0', EPS: '65,802', BPS: '167,744', PER: '3.79', PBR: '1.49', ROE: '48.10', EV: '1.68', MAIN: 'IFRS연결', TOT_ROW: 7 },
    { YYMM: '2028.12(E)', SALES: '9,985,223.7', YOY: '5.50', OP: '5,327,749.5', NP: '4,381,947.9', EPS: '65,907', BPS: '230,996', PER: '3.79', PBR: '1.08', ROE: '33.46', EV: '1.23', MAIN: 'IFRS연결', TOT_ROW: 7 },
  ],
});

// 187870(미커버) 실측 응답 축약본 — 추정 3개년 전부 빈 문자열
const UNCOVERED_JSON = JSON.stringify({
  JsonData: [
    { YYMM: '2025.12(A)', SALES: '840.8', YOY: '78.29', OP: '173.3', NP: '169.2', EPS: '1,229', BPS: '11,958', PER: '5.75', PBR: '0.59', ROE: '11.11', EV: '1.87', MAIN: 'IFRS연결', TOT_ROW: 7 },
    { YYMM: '2026.12(E)', SALES: '', YOY: '', OP: '', NP: '', EPS: '', BPS: '', PER: '', PBR: '', ROE: '', EV: '', MAIN: 'IFRS연결', TOT_ROW: 7 },
    { YYMM: '2027.12(E)', SALES: '', YOY: '', OP: '', NP: '', EPS: '', BPS: '', PER: '', PBR: '', ROE: '', EV: '', MAIN: 'IFRS연결', TOT_ROW: 7 },
    { YYMM: '2028.12(E)', SALES: '', YOY: '', OP: '', NP: '', EPS: '', BPS: '', PER: '', PBR: '', ROE: '', EV: '', MAIN: 'IFRS연결', TOT_ROW: 7 },
  ],
});

// (A)만 있고 (E)가 전혀 없는 종목(예: 컨센서스 미형성) 가정 fixture
const NO_ESTIMATE_JSON = JSON.stringify({
  JsonData: [
    { YYMM: '2023.12(A)', SALES: '100.0', YOY: '1.0', OP: '10.0', NP: '5.0', EPS: '100', BPS: '1,000', PER: '10.0', PBR: '1.0', ROE: '5.0', EV: '1.0', MAIN: 'IFRS연결', TOT_ROW: 4 },
    { YYMM: '2024.12(A)', SALES: '110.0', YOY: '10.0', OP: '11.0', NP: '5.5', EPS: '110', BPS: '1,100', PER: '11.0', PBR: '1.1', ROE: '5.5', EV: '1.1', MAIN: 'IFRS연결', TOT_ROW: 4 },
  ],
});

test('정상 응답에서 추정(E) 연도만 3개년 파싱하고 확정(A) 연도는 제외한다', () => {
  const result = parseConsensusRows(SAMSUNG_JSON);

  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((r) => r.fiscalYear),
    [2026, 2027, 2028],
  );
});

test('금액은 콤마 제거 후 억원 단위를 원 단위로 환산하고, 비율 필드는 소수로 변환한다', () => {
  const [first] = parseConsensusRows(SAMSUNG_JSON);

  assert.equal(first.fiscalYear, 2026);
  assert.equal(first.revenue, Math.round(7_324_741.2 * 1e8));
  assert.equal(first.operatingIncome, Math.round(3_832_416.1 * 1e8));
  assert.equal(first.netIncome, Math.round(3_112_642.4 * 1e8));
  assert.equal(first.eps, 46664); // EPS는 원 단위 그대로(스케일 없음)
  assert.equal(first.bps, 109170); // BPS도 EPS와 동일하게 원 단위 그대로
  assert.equal(first.per, 5.35);
  assert.equal(first.pbr, 2.29);
  assert.equal(first.roe, 0.5454); // 54.54% → 0.5454
  assert.equal(first.revenueGrowth, 1.1956); // 119.56% → 1.1956
});

test('미커버 종목은 빈 문자열 필드를 모두 null로 반환한다("없으면 기입하지 않음")', () => {
  const result = parseConsensusRows(UNCOVERED_JSON);

  assert.equal(result.length, 3);
  for (const r of result) {
    assert.equal(r.revenue, null);
    assert.equal(r.operatingIncome, null);
    assert.equal(r.netIncome, null);
    assert.equal(r.eps, null);
    assert.equal(r.bps, null);
    assert.equal(r.per, null);
    assert.equal(r.pbr, null);
    assert.equal(r.roe, null);
    assert.equal(r.revenueGrowth, null);
  }
});

test('(E) 연도가 없는 응답은 빈 배열을 반환한다', () => {
  assert.deepEqual(parseConsensusRows(NO_ESTIMATE_JSON), []);
});

test('JsonData가 없거나 형식이 어긋나면 빈 배열을 반환한다', () => {
  assert.deepEqual(parseConsensusRows(JSON.stringify({})), []);
  assert.deepEqual(parseConsensusRows(JSON.stringify({ JsonData: null })), []);
  assert.deepEqual(parseConsensusRows(JSON.stringify({ JsonData: 'not-an-array' })), []);
});

test('잘못된 JSON(파싱 불가)이면 예외를 던지지 않고 빈 배열을 반환한다', () => {
  assert.deepEqual(parseConsensusRows('{invalid json'), []);
  assert.deepEqual(parseConsensusRows(''), []);
  assert.deepEqual(parseConsensusRows('<html>점검 중</html>'), []);
});

// 005930 분기(frq=1) 실측 응답 축약본(2026-07-25 조회) — 확정 4개 분기(A) + 추정 3개 분기(E).
// 추정 분기는 ROE가 빈 문자열로 내려온다(소스 실측).
const QUARTERLY_JSON = JSON.stringify({
  JsonData: [
    { YYMM: '2025.06(A)', SALES: '745,663.2', YOY: '0.67', OP: '46,760.6', NP: '49,340.3', EPS: '686', PER: '81.63', ROE: '1.26', MAIN: 'IFRS연결', TOT_ROW: 7 },
    { YYMM: '2025.09(A)', SALES: '860,617.5', YOY: '8.80', OP: '121,660.6', NP: '120,064.6', EPS: '1,672', PER: '47.07', ROE: '3.04', MAIN: 'IFRS연결', TOT_ROW: 7 },
    { YYMM: '2025.12(A)', SALES: '938,373.7', YOY: '23.82', OP: '200,736.6', NP: '192,920.5', EPS: '2,688', PER: '41.86', ROE: '4.67', MAIN: 'IFRS연결', TOT_ROW: 7 },
    { YYMM: '2026.03(A)', SALES: '1,338,734.4', YOY: '69.16', OP: '572,328.0', NP: '471,011.9', EPS: '6,563', PER: '23.91', ROE: '10.49', MAIN: 'IFRS연결', TOT_ROW: 7 },
    { YYMM: '2026.06(E)', SALES: '1,738,643.9', YOY: '133.17', OP: '850,493.7', NP: '706,534.6', EPS: '9,846', PER: '29.13', ROE: '', MAIN: 'IFRS연결', TOT_ROW: 7 },
    { YYMM: '2026.09(E)', SALES: '2,078,079.6', YOY: '141.46', OP: '1,136,818.3', NP: '936,114.0', EPS: '13,047', PER: '17.72', ROE: '', MAIN: 'IFRS연결', TOT_ROW: 7 },
    { YYMM: '2026.12(E)', SALES: '2,189,247.5', YOY: '133.30', OP: '1,243,715.8', NP: '1,030,741.0', EPS: '14,362', PER: '16.09', ROE: '', MAIN: 'IFRS연결', TOT_ROW: 7 },
  ],
});

test('분기 응답은 확정(A)·추정(E) 7개 분기를 모두 연도·분기 오름차순으로 파싱한다', () => {
  const result = parseQuarterlyConsensusRows(QUARTERLY_JSON);

  assert.equal(result.length, 7);
  assert.deepEqual(
    result.map((r) => [r.fiscalYear, r.fiscalQuarter]),
    [[2025, 2], [2025, 3], [2025, 4], [2026, 1], [2026, 2], [2026, 3], [2026, 4]],
  );
});

test('YYMM의 분기 말월(03/06/09/12)을 분기 번호(1~4)로 매핑한다', () => {
  const result = parseQuarterlyConsensusRows(QUARTERLY_JSON);
  const byQuarter = new Map(result.map((r) => [`${r.fiscalYear}.${r.fiscalQuarter}`, r]));

  assert.equal(byQuarter.get('2026.1')?.fiscalQuarter, 1); // .03
  assert.equal(byQuarter.get('2025.2')?.fiscalQuarter, 2); // .06
  assert.equal(byQuarter.get('2025.3')?.fiscalQuarter, 3); // .09
  assert.equal(byQuarter.get('2025.4')?.fiscalQuarter, 4); // .12
});

test('(A)는 isEstimate=false, (E)는 isEstimate=true로 구분한다', () => {
  const result = parseQuarterlyConsensusRows(QUARTERLY_JSON);

  assert.equal(result.filter((r) => !r.isEstimate).length, 4);
  assert.equal(result.filter((r) => r.isEstimate).length, 3);
  assert.ok(result.slice(0, 4).every((r) => !r.isEstimate));
  assert.ok(result.slice(4).every((r) => r.isEstimate));
});

test('추정 분기의 ROE 빈 문자열은 null로, 확정 분기는 소수로 변환한다', () => {
  const result = parseQuarterlyConsensusRows(QUARTERLY_JSON);

  const q2025_2 = result.find((r) => r.fiscalYear === 2025 && r.fiscalQuarter === 2);
  assert.equal(q2025_2?.roe, 0.0126); // 1.26% → 0.0126

  const estimateQuarters = result.filter((r) => r.isEstimate);
  for (const q of estimateQuarters) {
    assert.equal(q.roe, null);
  }
});

test('금액은 콤마 제거 후 억원 단위를 원 단위로 환산하고, YOY는 소수로 변환한다', () => {
  const q2026_1 = parseQuarterlyConsensusRows(QUARTERLY_JSON)
    .find((r) => r.fiscalYear === 2026 && r.fiscalQuarter === 1);

  assert.equal(q2026_1?.revenue, Math.round(1_338_734.4 * 1e8));
  assert.equal(q2026_1?.operatingIncome, Math.round(572_328.0 * 1e8));
  assert.equal(q2026_1?.netIncome, Math.round(471_011.9 * 1e8));
  assert.equal(q2026_1?.revenueGrowth, 0.6916); // 69.16% → 0.6916
});

test('분기 응답에 BPS·PBR 필드가 없으면 null로 방어한다(실측 샘플에는 해당 필드 없음)', () => {
  const q2026_1 = parseQuarterlyConsensusRows(QUARTERLY_JSON)
    .find((r) => r.fiscalYear === 2026 && r.fiscalQuarter === 1);

  assert.equal(q2026_1?.bps, null);
  assert.equal(q2026_1?.pbr, null);
});

test('분기 응답에 BPS·PBR 필드가 있으면 EPS·PER과 동일한 방식으로 파싱한다', () => {
  const withBpsPbr = JSON.stringify({
    JsonData: [
      { YYMM: '2025.12(A)', SALES: '100.0', YOY: '1.0', OP: '10.0', NP: '5.0', EPS: '100', BPS: '1,000', PER: '10.0', PBR: '1.0', ROE: '5.0', MAIN: 'IFRS연결', TOT_ROW: 1 },
    ],
  });
  const [row] = parseQuarterlyConsensusRows(withBpsPbr);
  assert.equal(row.bps, 1000);
  assert.equal(row.pbr, 1.0);
});

test('분기 말월이 아닌 이상치(예: .07)는 방어적으로 건너뛴다', () => {
  const malformed = JSON.stringify({
    JsonData: [
      { YYMM: '2025.07(A)', SALES: '100.0', YOY: '1.0', OP: '10.0', NP: '5.0', EPS: '100', PER: '10.0', ROE: '5.0', MAIN: 'IFRS연결', TOT_ROW: 1 },
      { YYMM: '2025.09(A)', SALES: '110.0', YOY: '2.0', OP: '11.0', NP: '5.5', EPS: '110', PER: '11.0', ROE: '5.5', MAIN: 'IFRS연결', TOT_ROW: 1 },
    ],
  });

  const result = parseQuarterlyConsensusRows(malformed);
  assert.equal(result.length, 1);
  assert.equal(result[0].fiscalQuarter, 3);
});

test('분기 파서도 JsonData 부재·잘못된 JSON에 예외 없이 빈 배열을 반환한다', () => {
  assert.deepEqual(parseQuarterlyConsensusRows(JSON.stringify({})), []);
  assert.deepEqual(parseQuarterlyConsensusRows('{invalid json'), []);
  assert.deepEqual(parseQuarterlyConsensusRows(''), []);
});
