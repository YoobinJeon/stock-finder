/**
 * 분기 실적 개선 판정 (스크리너 실적 개선 필터).
 *
 * 순수 함수만 둔다 — DB 접근·적재는 `earningsTrendStore.ts`가 맡는다(`earningsSurprise.ts` +
 * `ingestFinancials.ts`와 같은 분리). 판정 규칙이 이 기능의 유일한 난이도이므로 규칙은 전부
 * 여기에 모아 단위 테스트로 고정한다.
 *
 * 규칙 (2026-07-29 사용자 확정):
 * - 기준 분기 = 보유한 **확정** 분기 중 가장 최신. YoY는 전년 동분기, QoQ는 직전 분기와 비교한다.
 * - "개선" = **매출 증가 AND 영업이익 증가**. 영업이익은 적자→흑자 전환도 개선으로 인정한다.
 * - 직전 값이 0 이하면 증가율 %는 수학적으로 의미가 없으므로 `null`로 둔다(부호가 뒤집혀
 *   적자 축소가 "+50% 성장"으로 보이는 것을 막는다). 이때는 흑자전환 플래그로만 통과시킨다.
 * - 적자→적자(축소 포함)는 개선이 아니다.
 */

import { growthRate, isTurnaround } from './growthRate';

export interface QuarterPoint {
  fiscalYear: number;
  fiscalQuarter: number;
  /** TRUE = 컨센서스(전망치) */
  isEstimate: boolean;
  revenue: number | null;
  operatingIncome: number | null;
}

/** 두 분기 비교 결과 (YoY·QoQ가 공유하는 모양) */
export interface PeriodComparison {
  /** 매출 증가율 — 소수(0.2 = +20%). 직전 매출이 0 이하거나 결측이면 null */
  revenueGrowth: number | null;
  /** 영업이익 증가율 — 소수. 직전 영업이익이 0 이하(적자·0)면 null(흑자전환 플래그로 판단) */
  opGrowth: number | null;
  /** 영업이익 적자·0 → 흑자 전환 */
  opTurnaround: boolean;
  /** 매출·영업이익 모두 개선 */
  improving: boolean;
  /**
   * 비교 대상 분기의 금액 — 증가율만으로는 규모를 알 수 없어(매출 100억→300억과 10조→30조가
   * 같은 +200%) 원값을 함께 남긴다. 비교 대상이 없으면 null.
   */
  prevRevenue: number | null;
  prevOperatingIncome: number | null;
}

/** 다음(최초) 컨센서스 분기 전망 — 확정 판정과 섞지 않기 위해 따로 담는다 */
export interface EstimateOutlook {
  fiscalYear: number;
  fiscalQuarter: number;
  revenue: number | null;
  operatingIncome: number | null;
  /** 전년 동분기 대비 */
  yoy: PeriodComparison;
  /** 직전 분기(대개 최신 확정 분기) 대비 */
  qoq: PeriodComparison;
}

export interface EarningsTrend {
  /** 판정 기준이 된 최신 확정 분기 */
  baseYear: number;
  baseQuarter: number;
  /** 기준 분기의 금액 — 증가율과 함께 봐야 규모를 판단할 수 있다 */
  baseRevenue: number | null;
  baseOperatingIncome: number | null;
  yoy: PeriodComparison;
  qoq: PeriodComparison;
  /**
   * 연속 개선 분기 수 — 최신 확정 분기부터 거꾸로 세어 개선이 끊기는 지점까지.
   * 각 분기는 **자기 자신의** 비교 대상(YoY면 그 분기의 전년 동분기)과 견준다.
   * 이력이 얕으면 비교 대상이 없어 자연히 짧게 끊긴다(0도 정상).
   */
  yoyStreak: number;
  qoqStreak: number;
  /** 다음 컨센서스 분기 전망 — 없으면 null */
  estimate: EstimateOutlook | null;
}

const NO_COMPARISON: PeriodComparison = {
  revenueGrowth: null,
  opGrowth: null,
  opTurnaround: false,
  improving: false,
  prevRevenue: null,
  prevOperatingIncome: null,
};

/** (연, 분기) → 정렬·조회용 단조 증가 키 */
function quarterKey(year: number, quarter: number): number {
  return year * 4 + (quarter - 1);
}

/** 직전 분기 (1분기면 전년 4분기) */
function previousQuarter(year: number, quarter: number): { year: number; quarter: number } {
  return quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
}

/** 두 분기 비교. 비교 대상이 없으면 "개선 아님"으로 확정한다(판정 불가 = 통과 아님). */
export function comparePeriods(
  cur: QuarterPoint | undefined,
  prev: QuarterPoint | undefined,
): PeriodComparison {
  if (!cur || !prev) return NO_COMPARISON;

  const revenueGrowth = growthRate(cur.revenue, prev.revenue);
  const opGrowth = growthRate(cur.operatingIncome, prev.operatingIncome);
  const opTurnaround = isTurnaround(cur.operatingIncome, prev.operatingIncome);

  const opImproved = opTurnaround || (opGrowth != null && opGrowth > 0);
  const improving = revenueGrowth != null && revenueGrowth > 0 && opImproved;

  return {
    revenueGrowth, opGrowth, opTurnaround, improving,
    prevRevenue: prev.revenue,
    prevOperatingIncome: prev.operatingIncome,
  };
}

/**
 * 분기 배열(확정·추정 혼재, 순서 무관) → 개선 판정.
 * 확정 분기가 하나도 없으면 판정할 수 없으므로 null을 돌려준다(호출측이 행을 지운다).
 */
export function decideEarningsTrend(quarters: QuarterPoint[]): EarningsTrend | null {
  // (연,분기)당 1행이 DB 유니크 제약으로 보장되므로 키 충돌은 없다.
  const byKey = new Map<number, QuarterPoint>();
  for (const q of quarters) {
    if (!Number.isFinite(q.fiscalYear) || !Number.isFinite(q.fiscalQuarter)) continue;
    byKey.set(quarterKey(q.fiscalYear, q.fiscalQuarter), q);
  }
  const at = (year: number, quarter: number) => byKey.get(quarterKey(year, quarter));

  const sorted = [...byKey.values()].sort(
    (a, b) => quarterKey(a.fiscalYear, a.fiscalQuarter) - quarterKey(b.fiscalYear, b.fiscalQuarter),
  );

  const actuals = sorted.filter((q) => !q.isEstimate);
  const base = actuals[actuals.length - 1];
  if (!base) return null;

  /**
   * 확정 기준 판정의 비교 대상은 **확정 분기만** 허용한다. 수집이 끊긴 사이 소스 창이 지나가
   * (E)로 굳은 행이 남을 수 있는데, 그 행을 비교 대상으로 삼으면 확정치를 애널리스트 추정치와
   * 견주게 된다 — 사용자가 "확정 기준"으로 정한 규칙이 조용히 깨지는 자리다.
   * (컨센서스 기준 판정은 반대로 추정 행이 필요하므로 `at`을 그대로 쓴다.)
   */
  const atActual = (year: number, quarter: number) => {
    const q = at(year, quarter);
    return q && !q.isEstimate ? q : undefined;
  };

  const basePrev = previousQuarter(base.fiscalYear, base.fiscalQuarter);
  const yoy = comparePeriods(base, atActual(base.fiscalYear - 1, base.fiscalQuarter));
  const qoq = comparePeriods(base, atActual(basePrev.year, basePrev.quarter));

  // 컨센서스 기준 — 기준 분기보다 뒤에 오는 최초 추정 분기. 기준 분기보다 앞선 추정 행
  // (실적 발표로 확정이 앞질러 간 낡은 전망)은 미래 신호가 아니므로 제외한다.
  const estBase = sorted.find(
    (q) =>
      q.isEstimate &&
      quarterKey(q.fiscalYear, q.fiscalQuarter) > quarterKey(base.fiscalYear, base.fiscalQuarter),
  );
  const estPrev = estBase && previousQuarter(estBase.fiscalYear, estBase.fiscalQuarter);

  return {
    baseYear: base.fiscalYear,
    baseQuarter: base.fiscalQuarter,
    baseRevenue: base.revenue,
    baseOperatingIncome: base.operatingIncome,
    yoy,
    qoq,
    yoyStreak: countStreak(actuals, (q) => atActual(q.fiscalYear - 1, q.fiscalQuarter)),
    qoqStreak: countStreak(actuals, (q) => {
      const prev = previousQuarter(q.fiscalYear, q.fiscalQuarter);
      return atActual(prev.year, prev.quarter);
    }),
    estimate: estBase
      ? {
          fiscalYear: estBase.fiscalYear,
          fiscalQuarter: estBase.fiscalQuarter,
          revenue: estBase.revenue,
          operatingIncome: estBase.operatingIncome,
          yoy: comparePeriods(estBase, at(estBase.fiscalYear - 1, estBase.fiscalQuarter)),
          qoq: estPrev ? comparePeriods(estBase, at(estPrev.year, estPrev.quarter)) : NO_COMPARISON,
        }
      : null,
  };
}

/**
 * 연속 개선 분기 수 — 확정 분기를 **최신부터 거꾸로** 훑어 개선이 아닌 분기를 만나면 멈춘다.
 *
 * 비교 대상이 없는 분기(이력 경계)도 "개선 아님"으로 멈춘다 — 판정 불가를 개선으로 세면
 * 이력이 얕은 종목이 부당하게 긴 연속을 얻는다. 즉 이 값은 **확인된 연속**만 센다.
 */
function countStreak(
  actualsAscending: readonly QuarterPoint[],
  anchorOf: (q: QuarterPoint) => QuarterPoint | undefined,
): number {
  let streak = 0;
  for (let i = actualsAscending.length - 1; i >= 0; i--) {
    const q = actualsAscending[i];
    if (!comparePeriods(q, anchorOf(q)).improving) break;
    streak += 1;
  }
  return streak;
}
