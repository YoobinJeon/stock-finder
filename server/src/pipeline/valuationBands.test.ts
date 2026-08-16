import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeQuantiles,
  computePerBands,
  computePbrBands,
  computePbrRoePoints,
} from './valuationBands';

test('computeQuantiles: 정상 케이스 — 5개 분위수를 선형보간으로 계산한다', () => {
  const result = computeQuantiles([10, 20, 30, 40, 50]);
  const byLabel = new Map(result.map((r) => [r.label, r.multiple]));

  // 기본 분위수는 0/25/50/75/100 — 관측 전 구간을 밴드가 감싸 주가가 밴드 밖으로 나가지 않게 한다
  assert.equal(result.length, 5);
  assert.equal(byLabel.get('P0'), 10);   // 최솟값
  assert.equal(byLabel.get('P50'), 30);  // 중앙값
  assert.equal(byLabel.get('P100'), 50); // 최댓값
});

test('computeQuantiles: 0 이하·null 값(적자 연도)은 분포에서 제외한다', () => {
  const result = computeQuantiles([10, -5, null, 0, 20]);
  const byLabel = new Map(result.map((r) => [r.label, r.multiple]));
  // 유효값은 [10, 20]뿐 — 음수·null·0은 제외
  assert.equal(byLabel.get('P0'), 10);
  assert.equal(byLabel.get('P100'), 20);
});

test('computeQuantiles: 데이터 부족(전부 무효) — 빈 배열을 반환한다', () => {
  assert.deepEqual(computeQuantiles([]), []);
  assert.deepEqual(computeQuantiles([null, -1, 0]), []);
});

test('computeQuantiles: 분위수 경계값(0, 100) — 최소·최대값과 일치한다', () => {
  const result = computeQuantiles([5, 15, 25], [0, 100]);
  const byLabel = new Map(result.map((r) => [r.label, r.multiple]));
  assert.equal(byLabel.get('P0'), 5);
  assert.equal(byLabel.get('P100'), 25);
});

test('computePerBands: EPS × 배수로 회계연도별 밴드 시계열을 만든다', () => {
  const prices = [
    { date: '2024-03-15', close: 1000 },
    { date: '2025-06-20', close: 1200 },
  ];
  const epsByYear = { 2024: 100, 2025: 120 };
  const multiples = [{ label: 'P50', multiple: 10 }];

  // 기준 EPS는 직전 연도말~당해 연도말 선형보간 — 계단식으로 쓰면 실적 성장이 밴드에 안 잡힌다
  const [band] = computePerBands(prices, epsByYear, multiples);
  assert.equal(band.series.length, 2);
  // 2024-03-15: 2023 값이 없어 당해(100) 그대로 → 100 * 10
  assert.deepEqual(band.series[0], { date: '2024-03-15', value: 1000 });
  // 2025-06-20: 2024말 100 → 2025말 120 사이 약 47% 지점 ≈ 109.3 → 1093
  assert.equal(band.series[1].date, '2025-06-20');
  assert.ok(
    band.series[1].value > 1000 && band.series[1].value < 1200,
    `보간값이 두 연도 사이여야 함: ${band.series[1].value}`,
  );
});

test('computePerBands: 적자 연도(EPS 없음 또는 0 이하)는 해당 구간을 건너뛴다', () => {
  const prices = [
    { date: '2023-05-01', close: 500 },
    { date: '2024-05-01', close: 800 },
  ];
  const epsByYear = { 2023: -50, 2024: 80 }; // 2023 적자
  const multiples = [{ label: 'P50', multiple: 10 }];

  const [band] = computePerBands(prices, epsByYear, multiples);
  assert.equal(band.series.length, 1);
  assert.equal(band.series[0].date, '2024-05-01');
});

test('computePerBands: 해당 연도 EPS가 아예 없으면(데이터 부족) 건너뛴다', () => {
  const prices = [{ date: '2020-01-01', close: 100 }];
  const [band] = computePerBands(prices, {}, [{ label: 'P50', multiple: 10 }]);
  assert.deepEqual(band.series, []);
});

test('computePbrBands: BPS × 배수로 계산한다(computePerBands와 동일 로직, 필드만 다름)', () => {
  const prices = [{ date: '2024-01-01', close: 900 }];
  const bpsByYear = { 2024: 300 };
  const [band] = computePbrBands(prices, bpsByYear, [{ label: 'P50', multiple: 3 }]);
  assert.deepEqual(band.series, [{ date: '2024-01-01', value: 900 }]);
});

test('computePbrRoePoints: 정상 케이스 — ROE·PBR이 있는 연도만 점으로 남기고 회귀선을 계산한다', () => {
  const result = computePbrRoePoints([
    { fiscalYear: 2022, roe: 0.10, pbr: 1.0, isEstimate: false },
    { fiscalYear: 2023, roe: 0.15, pbr: 1.5, isEstimate: false },
    { fiscalYear: 2024, roe: 0.20, pbr: 2.0, isEstimate: false },
  ]);

  assert.equal(result.points.length, 3);
  assert.ok(result.fitLine);
  // 완전한 선형관계(pbr = 10*roe) — 기울기 10, 절편 0에 근접
  assert.ok(Math.abs(result.fitLine!.slope - 10) < 1e-6);
  assert.ok(Math.abs(result.fitLine!.intercept - 0) < 1e-6);
});

test('computePbrRoePoints: ROE 또는 PBR이 없는 연도는 점에서 제외한다', () => {
  const result = computePbrRoePoints([
    { fiscalYear: 2022, roe: null, pbr: 1.0, isEstimate: false },
    { fiscalYear: 2023, roe: 0.15, pbr: null, isEstimate: false },
    { fiscalYear: 2024, roe: 0.20, pbr: 2.0, isEstimate: false },
  ]);

  assert.equal(result.points.length, 1);
  assert.equal(result.points[0].fiscalYear, 2024);
});

test('computePbrRoePoints: 점이 3개 미만이면 회귀선은 null이다', () => {
  const result = computePbrRoePoints([
    { fiscalYear: 2023, roe: 0.15, pbr: 1.5, isEstimate: false },
    { fiscalYear: 2024, roe: 0.20, pbr: 2.0, isEstimate: true },
  ]);

  assert.equal(result.points.length, 2);
  assert.equal(result.fitLine, null);
});

test('computePbrRoePoints: 추정연도는 isEstimate=true로 표시되고 연도 오름차순 정렬된다', () => {
  const result = computePbrRoePoints([
    { fiscalYear: 2026, roe: 0.30, pbr: 2.5, isEstimate: true },
    { fiscalYear: 2024, roe: 0.10, pbr: 1.0, isEstimate: false },
    { fiscalYear: 2025, roe: 0.20, pbr: 2.0, isEstimate: false },
  ]);

  assert.deepEqual(result.points.map((p) => p.fiscalYear), [2024, 2025, 2026]);
  assert.equal(result.points[2].isEstimate, true);
});
