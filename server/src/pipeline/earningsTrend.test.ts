import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideEarningsTrend, comparePeriods, type QuarterPoint } from './earningsTrend';

const EOK = 1e8; // 소스가 억원 단위라 테스트도 같은 스케일로 맞춘다

function q(
  fiscalYear: number,
  fiscalQuarter: number,
  revenue: number | null,
  operatingIncome: number | null,
  isEstimate = false,
): QuarterPoint {
  return {
    fiscalYear,
    fiscalQuarter,
    isEstimate,
    revenue: revenue == null ? null : revenue * EOK,
    operatingIncome: operatingIncome == null ? null : operatingIncome * EOK,
  };
}

/** 확정 5분기(2025Q1~2026Q1) — YoY(2026Q1 vs 2025Q1)·QoQ(2026Q1 vs 2025Q4) 둘 다 성립하는 기본형 */
function fiveActualQuarters(
  over: Partial<Record<'y25q1' | 'y25q4' | 'y26q1', [number | null, number | null]>> = {},
): QuarterPoint[] {
  const y25q1 = over.y25q1 ?? [1000, 100];
  const y25q4 = over.y25q4 ?? [1100, 110];
  const y26q1 = over.y26q1 ?? [1200, 130];
  return [
    q(2025, 1, y25q1[0], y25q1[1]),
    q(2025, 2, 1050, 105),
    q(2025, 3, 1080, 108),
    q(2025, 4, y25q4[0], y25q4[1]),
    q(2026, 1, y26q1[0], y26q1[1]),
  ];
}

// ── comparePeriods ────────────────────────────────────────────

test('comparePeriods: 매출·영업이익 모두 증가하면 개선', () => {
  const r = comparePeriods(q(2026, 1, 1200, 130), q(2025, 1, 1000, 100));

  assert.equal(r.improving, true);
  assert.ok(Math.abs(r.revenueGrowth! - 0.2) < 1e-9);
  assert.ok(Math.abs(r.opGrowth! - 0.3) < 1e-9);
  assert.equal(r.opTurnaround, false);
});

test('comparePeriods: 매출만 증가하고 영업이익이 줄면 개선 아님', () => {
  const r = comparePeriods(q(2026, 1, 1200, 90), q(2025, 1, 1000, 100));

  assert.equal(r.improving, false);
  assert.ok(r.revenueGrowth! > 0);
  assert.ok(r.opGrowth! < 0);
});

test('comparePeriods: 영업이익만 증가하고 매출이 줄면 개선 아님', () => {
  const r = comparePeriods(q(2026, 1, 900, 130), q(2025, 1, 1000, 100));

  assert.equal(r.improving, false);
});

test('comparePeriods: 적자 → 흑자는 증가율 없이도 개선(흑자전환)', () => {
  const r = comparePeriods(q(2026, 1, 1200, 50), q(2025, 1, 1000, -80));

  assert.equal(r.improving, true);
  assert.equal(r.opTurnaround, true);
  // 분모가 음수면 백분율이 의미를 잃으므로 증가율은 기입하지 않는다
  assert.equal(r.opGrowth, null);
});

test('comparePeriods: 적자 축소는 개선이 아니다 (적자 → 적자)', () => {
  const r = comparePeriods(q(2026, 1, 1200, -30), q(2025, 1, 1000, -80));

  assert.equal(r.improving, false);
  assert.equal(r.opTurnaround, false);
  assert.equal(r.opGrowth, null);
});

test('comparePeriods: 흑자 → 적자(적자전환)는 개선 아님', () => {
  const r = comparePeriods(q(2026, 1, 1200, -30), q(2025, 1, 1000, 100));

  assert.equal(r.improving, false);
  assert.equal(r.opTurnaround, false);
  assert.ok(r.opGrowth! < 0);
});

test('comparePeriods: 직전 영업이익이 정확히 0이면 흑자전환으로 본다', () => {
  const r = comparePeriods(q(2026, 1, 1200, 40), q(2025, 1, 1000, 0));

  assert.equal(r.improving, true);
  assert.equal(r.opTurnaround, true);
  assert.equal(r.opGrowth, null);
});

test('comparePeriods: 직전 매출이 0이면 매출 증가율을 낼 수 없어 개선 아님', () => {
  const r = comparePeriods(q(2026, 1, 1200, 130), q(2025, 1, 0, 100));

  assert.equal(r.improving, false);
  assert.equal(r.revenueGrowth, null);
});

test('comparePeriods: 값이 결측이면 개선 아님', () => {
  assert.equal(comparePeriods(q(2026, 1, null, 130), q(2025, 1, 1000, 100)).improving, false);
  assert.equal(comparePeriods(q(2026, 1, 1200, null), q(2025, 1, 1000, 100)).improving, false);
});

test('comparePeriods: 비교 대상 분기가 없으면 개선 아님 (판정 불가 ≠ 통과)', () => {
  const r = comparePeriods(q(2026, 1, 1200, 130), undefined);

  assert.equal(r.improving, false);
  assert.equal(r.revenueGrowth, null);
  assert.equal(r.opGrowth, null);
});

test('comparePeriods: 증가율 0(보합)은 개선 아님 — 초과여야 한다', () => {
  const r = comparePeriods(q(2026, 1, 1000, 100), q(2025, 1, 1000, 100));

  assert.equal(r.improving, false);
  assert.equal(r.revenueGrowth, 0);
  assert.equal(r.opGrowth, 0);
});

// ── decideEarningsTrend ───────────────────────────────────────

test('decideEarningsTrend: 최신 확정 분기를 기준으로 YoY·QoQ를 낸다', () => {
  const t = decideEarningsTrend(fiveActualQuarters())!;

  assert.equal(t.baseYear, 2026);
  assert.equal(t.baseQuarter, 1);
  assert.equal(t.yoy.improving, true); // 2026Q1(1200/130) vs 2025Q1(1000/100)
  assert.equal(t.qoq.improving, true); // 2026Q1(1200/130) vs 2025Q4(1100/110)
});

test('decideEarningsTrend: 입력 순서가 뒤섞여도 결과가 같다', () => {
  const ordered = fiveActualQuarters();
  const shuffled = [ordered[3], ordered[0], ordered[4], ordered[2], ordered[1]];

  assert.deepEqual(decideEarningsTrend(shuffled), decideEarningsTrend(ordered));
});

test('decideEarningsTrend: 1분기 기준의 QoQ는 전년 4분기와 비교한다', () => {
  // 2025Q4 대비 매출이 줄었으므로 QoQ는 개선이 아니어야 한다(연 경계를 건너뛰면 이 검사가 깨진다)
  const t = decideEarningsTrend(fiveActualQuarters({ y25q4: [1500, 200] }))!;

  assert.equal(t.baseQuarter, 1);
  assert.equal(t.qoq.improving, false);
  assert.ok(t.qoq.revenueGrowth! < 0);
});

test('decideEarningsTrend: 전년 동분기가 없으면 YoY는 개선 아님, QoQ는 그대로 판정', () => {
  // 확정 4분기(2025Q2~2026Q1)만 보유 — 와이즈리포트 단독 창에서 실제로 발생하던 상태
  const t = decideEarningsTrend(fiveActualQuarters().slice(1))!;

  assert.equal(t.yoy.improving, false);
  assert.equal(t.yoy.revenueGrowth, null);
  assert.equal(t.qoq.improving, true);
});

test('decideEarningsTrend: 전년 동분기가 추정 행이면 YoY 비교에 쓰지 않는다', () => {
  // 수집이 끊긴 사이 소스 창이 지나가 (E)로 굳은 행 — 확정치를 추정치와 견주면 안 된다.
  const quarters = fiveActualQuarters().slice(1); // 2025Q2~2026Q1 확정
  const staleEstimate = q(2025, 1, 1000, 100, true);
  const t = decideEarningsTrend([...quarters, staleEstimate])!;

  assert.equal(t.baseYear, 2026);
  assert.equal(t.baseQuarter, 1);
  assert.equal(t.yoy.improving, false);
  assert.equal(t.yoy.revenueGrowth, null);
  assert.equal(t.qoq.improving, true); // QoQ(확정 2025Q4 대비)는 영향 없음
});

test('decideEarningsTrend: 직전 분기가 추정 행이면 QoQ 비교에 쓰지 않는다', () => {
  const quarters = fiveActualQuarters().filter(
    (x) => !(x.fiscalYear === 2025 && x.fiscalQuarter === 4),
  );
  const t = decideEarningsTrend([...quarters, q(2025, 4, 1100, 110, true)])!;

  assert.equal(t.qoq.improving, false);
  assert.equal(t.qoq.revenueGrowth, null);
  assert.equal(t.yoy.improving, true); // YoY(확정 2025Q1 대비)는 영향 없음
});

test('decideEarningsTrend: 확정 분기가 없으면 null (추정만 있는 종목)', () => {
  const onlyEstimates = [q(2026, 2, 1200, 130, true), q(2026, 3, 1300, 140, true)];

  assert.equal(decideEarningsTrend(onlyEstimates), null);
  assert.equal(decideEarningsTrend([]), null);
});

test('decideEarningsTrend: 추정 분기는 기준 분기가 되지 않는다', () => {
  const quarters = [...fiveActualQuarters(), q(2026, 2, 1400, 150, true)];
  const t = decideEarningsTrend(quarters)!;

  assert.equal(t.baseYear, 2026);
  assert.equal(t.baseQuarter, 1);
});

test('decideEarningsTrend: 컨센서스 개선 여부는 최초 추정 분기 기준으로 낸다', () => {
  // 2026Q2(E) vs 2025Q2(1050/105) → YoY 개선, vs 2026Q1(1200/130) → QoQ 개선
  const t = decideEarningsTrend([...fiveActualQuarters(), q(2026, 2, 1400, 150, true)])!;

  assert.equal(t.estimate?.yoy.improving === true, true);
  assert.equal(t.estimate?.qoq.improving === true, true);
});

test('decideEarningsTrend: 컨센서스가 꺾이면 추정 개선 플래그가 내려간다', () => {
  const t = decideEarningsTrend([...fiveActualQuarters(), q(2026, 2, 1100, 90, true)])!;

  assert.equal(t.yoy.improving, true); // 확정 기준 판정은 그대로
  assert.equal(t.estimate?.yoy.improving === true, false);
  assert.equal(t.estimate?.qoq.improving === true, false);
});

test('decideEarningsTrend: 추정 분기가 없으면 추정 플래그는 false', () => {
  const t = decideEarningsTrend(fiveActualQuarters())!;

  assert.equal(t.estimate?.yoy.improving === true, false);
  assert.equal(t.estimate?.qoq.improving === true, false);
});

test('decideEarningsTrend: 기준 분기보다 과거인 추정 행은 컨센서스 기준에서 제외한다', () => {
  // 실적이 발표돼 확정이 앞질러 갔는데 낡은 전망 행이 남아 있는 상태 —
  // 이 행을 "미래 컨센서스"로 오인하면 이미 지난 분기로 배지를 켜게 된다.
  const stale = q(2025, 2, 5000, 900, true);
  const quarters = fiveActualQuarters().filter((x) => !(x.fiscalYear === 2025 && x.fiscalQuarter === 2));
  const t = decideEarningsTrend([...quarters, stale])!;

  assert.equal(t.baseQuarter, 1);
  assert.equal(t.baseYear, 2026);
  assert.equal(t.estimate?.yoy.improving === true, false);
  assert.equal(t.estimate?.qoq.improving === true, false);
});

test('decideEarningsTrend: 흑자전환 종목은 YoY 개선으로 잡히고 증가율은 비어 있다', () => {
  const t = decideEarningsTrend(fiveActualQuarters({ y25q1: [1000, -50] }))!;

  assert.equal(t.yoy.improving, true);
  assert.equal(t.yoy.opTurnaround, true);
  assert.equal(t.yoy.opGrowth, null);
  assert.ok(t.yoy.revenueGrowth! > 0);
});

// ── 연속 개선 분기 수 (DART 이력 백필 후 의미가 생긴다) ──

/** 확정 분기를 연속 생성 — startYear Q1부터 count개, 값은 amounts[i] */
function series(
  startYear: number,
  count: number,
  amounts: Array<[number, number]>,
): QuarterPoint[] {
  const out: QuarterPoint[] = [];
  for (let i = 0; i < count; i++) {
    const [rev, op] = amounts[i];
    out.push(q(startYear + Math.floor(i / 4), (i % 4) + 1, rev, op));
  }
  return out;
}

test('연속 개선: 매 분기 YoY 개선이면 비교 가능한 분기 수만큼 센다', () => {
  // 12분기(2023Q1~2025Q4). 매출·영익이 매 분기 증가하므로 YoY는 2024Q1부터 8분기 개선.
  const amounts = Array.from({ length: 12 }, (_, i) => [1000 + i * 100, 100 + i * 10] as [number, number]);
  const t = decideEarningsTrend(series(2023, 12, amounts))!;

  assert.equal(t.baseYear, 2025);
  assert.equal(t.baseQuarter, 4);
  // 2023Q1~Q4는 전년 동분기가 없어 판정 불가 → 확인된 연속은 8
  assert.equal(t.yoyStreak, 8);
});

test('연속 개선: 중간에 꺾이면 그 지점에서 멈춘다', () => {
  const amounts = Array.from({ length: 12 }, (_, i) => [1000 + i * 100, 100 + i * 10] as [number, number]);
  amounts[9] = [900, 50]; // 2025Q2에서 급감 → 그 분기의 YoY가 깨진다
  const t = decideEarningsTrend(series(2023, 12, amounts))!;

  // 최신(2025Q4)부터 거꾸로: Q4 개선, Q3 개선, Q2 악화 → 2
  assert.equal(t.yoyStreak, 2);
});

test('연속 개선: 최신 분기가 개선이 아니면 0', () => {
  const amounts = Array.from({ length: 12 }, (_, i) => [1000 + i * 100, 100 + i * 10] as [number, number]);
  amounts[11] = [500, 10];
  const t = decideEarningsTrend(series(2023, 12, amounts))!;

  assert.equal(t.yoyStreak, 0);
  assert.equal(t.yoy.improving, false);
});

test('연속 개선: 이력이 얕으면 판정 불가로 끊긴다 (얕은 이력이 긴 연속을 얻지 못한다)', () => {
  // 5분기만 보유 — YoY 비교가 가능한 분기는 최신 1개뿐
  const t = decideEarningsTrend(fiveActualQuarters())!;

  assert.equal(t.yoy.improving, true);
  assert.equal(t.yoyStreak, 1);
});

test('연속 개선: QoQ 연속은 직전 분기 기준으로 따로 센다', () => {
  const amounts = Array.from({ length: 8 }, (_, i) => [1000 + i * 100, 100 + i * 10] as [number, number]);
  const t = decideEarningsTrend(series(2024, 8, amounts))!;

  // QoQ는 첫 분기만 비교 대상이 없으므로 7분기 연속
  assert.equal(t.qoqStreak, 7);
  // YoY는 2025Q1~Q4의 4분기
  assert.equal(t.yoyStreak, 4);
});

// ── 다음 분기 컨센서스 전망 수치 ──

test('컨센서스 전망: 분기·금액·증가율을 함께 낸다', () => {
  const t = decideEarningsTrend([...fiveActualQuarters(), q(2026, 2, 1400, 150, true)])!;

  assert.equal(t.estimate?.fiscalYear, 2026);
  assert.equal(t.estimate?.fiscalQuarter, 2);
  assert.equal(t.estimate?.revenue, 1400 * EOK);
  assert.equal(t.estimate?.operatingIncome, 150 * EOK);
  // 2026Q2(E) 1400 vs 2025Q2 1050 → 매출 YoY +33.3%
  assert.ok(Math.abs(t.estimate!.yoy.revenueGrowth! - (1400 - 1050) / 1050) < 1e-9);
  // vs 2026Q1 1200 → QoQ +16.7%
  assert.ok(Math.abs(t.estimate!.qoq.revenueGrowth! - (1400 - 1200) / 1200) < 1e-9);
});

test('컨센서스 전망: 흑자전환 전망도 플래그로 잡는다', () => {
  // 2025Q2를 적자로 만들고 2026Q2(E)를 흑자로
  const quarters = fiveActualQuarters().map((x) =>
    x.fiscalYear === 2025 && x.fiscalQuarter === 2 ? q(2025, 2, 1050, -50) : x,
  );
  const t = decideEarningsTrend([...quarters, q(2026, 2, 1400, 150, true)])!;

  assert.equal(t.estimate?.yoy.opTurnaround, true);
  assert.equal(t.estimate?.yoy.opGrowth, null);
  assert.equal(t.estimate?.yoy.improving, true);
});

test('컨센서스 전망: 추정 분기가 없으면 null', () => {
  assert.equal(decideEarningsTrend(fiveActualQuarters())!.estimate, null);
});

// ── 금액 동반 노출 (증가율만으로는 규모를 알 수 없다) ──

test('금액: 기준 분기와 비교 대상 분기의 원값을 함께 낸다', () => {
  const t = decideEarningsTrend(fiveActualQuarters())!;

  assert.equal(t.baseRevenue, 1200 * EOK);
  assert.equal(t.baseOperatingIncome, 130 * EOK);
  assert.equal(t.yoy.prevRevenue, 1000 * EOK);   // 2025Q1
  assert.equal(t.yoy.prevOperatingIncome, 100 * EOK);
  assert.equal(t.qoq.prevRevenue, 1100 * EOK);   // 2025Q4
  assert.equal(t.qoq.prevOperatingIncome, 110 * EOK);
});

test('금액: 비교 대상이 없으면 비교 금액은 null이지만 기준 금액은 남는다', () => {
  const t = decideEarningsTrend(fiveActualQuarters().slice(1))!; // 전년 동분기 없음

  assert.equal(t.baseRevenue, 1200 * EOK);
  assert.equal(t.yoy.prevRevenue, null);
  assert.equal(t.qoq.prevRevenue, 1100 * EOK); // QoQ는 그대로
});

test('금액: 적자 분기의 음수 영업이익도 그대로 남는다 (흑자전환의 출발점)', () => {
  const t = decideEarningsTrend(fiveActualQuarters({ y25q1: [1000, -50] }))!;

  assert.equal(t.yoy.opTurnaround, true);
  assert.equal(t.yoy.prevOperatingIncome, -50 * EOK); // 증가율은 null이어도 원값은 보인다
  assert.equal(t.yoy.opGrowth, null);
});

test('금액: 컨센서스 분기의 금액도 낸다', () => {
  const t = decideEarningsTrend([...fiveActualQuarters(), q(2026, 2, 1400, 150, true)])!;

  assert.equal(t.estimate?.revenue, 1400 * EOK);
  assert.equal(t.estimate?.operatingIncome, 150 * EOK);
  assert.equal(t.estimate?.yoy.prevRevenue, 1050 * EOK); // 2025Q2
});
