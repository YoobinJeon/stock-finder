/**
 * 분기 컨센서스가 확정 실적으로 뒤바뀌는 순간(E→A)을 포착해 "발표 직전 컨센서스 대비 실제"
 * 서프라이즈를 판정하는 순수함수. WiseReport frq=1은 확정 4분기 + 추정 3분기만 롤링으로
 * 주고 발표 시 (E)행이 (A)로 덮여버리므로, upsert 직전 스냅샷과 새 응답을 비교하는 이
 * 방식만이 과거 컨센서스를 남길 수 있는 유일한 경로다(설계: docs/superpowers/specs/
 * 2026-07-25-earnings-surprise-design.md).
 */

/** stock_financials의 분기 행 1건 (upsert 직전 스냅샷 / 새 소스 응답 공용) */
export interface QuarterRow {
  fiscalYear: number;
  fiscalQuarter: number;
  isEstimate: boolean;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  eps: number | null;
  /** 직전 스냅샷 행에만 의미 있음 — 컨센서스 신선도 지표 */
  updatedAt: string | null;
}

/** 금액 4종 묶음 — 추정·확정 양쪽에 같은 형태로 쓴다 */
export interface QuarterAmounts {
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  eps: number | null;
}

export type SurpriseKind =
  | 'beat'
  | 'miss'
  | 'inline'
  | 'turn_positive'
  | 'turn_negative'
  | 'deficit';

export interface SurpriseRecord {
  fiscalYear: number;
  fiscalQuarter: number;
  estimateUpdatedAt: string | null;
  est: QuarterAmounts;
  act: QuarterAmounts;
  /** 대표(영업이익) 서프라이즈율 % — 산출 불가 시 null */
  surprisePct: number | null;
  /** 참고용 매출 서프라이즈율 % — kind 판정에는 관여하지 않는다 */
  revenueSurprisePct: number | null;
  kind: SurpriseKind;
}

/** 분모가 이 값 이하면 비율이 폭발해 순위를 오염시키므로 pct를 내지 않는다 (1억원) */
export const MIN_ESTIMATE_BASE = 1e8;
/** 국내에서 통용되는 어닝 서프라이즈 기준선 (%) */
export const SURPRISE_THRESHOLD_PCT = 10;
/** DECIMAL(8,2) 범위 방어 — 극단값 클램프 (%) */
export const SURPRISE_PCT_CLAMP = 999;

const keyOf = (fiscalYear: number, fiscalQuarter: number): string =>
  `${fiscalYear}-${fiscalQuarter}`;

/**
 * 서프라이즈율(%). 추정치가 없거나 MIN_ESTIMATE_BASE 이하면 비율이 의미를 잃으므로 null.
 * 확정치의 부호는 따지지 않는다 — 흑자 추정이 적자로 뒤집힌 경우의 큰 음수도 유효한 정보다.
 */
function pctOf(est: number | null, act: number | null): number | null {
  if (est == null || act == null || est <= MIN_ESTIMATE_BASE) return null;
  const raw = ((act - est) / est) * 100;
  const clamped = Math.max(-SURPRISE_PCT_CLAMP, Math.min(SURPRISE_PCT_CLAMP, raw));
  return Math.round(clamped * 100) / 100;
}

/** 판정표(설계)를 위에서 아래로 첫 매치. 기록 대상이 아니면 null. */
function kindOf(est: number | null, act: number | null): SurpriseKind | null {
  if (est == null || act == null) return null;
  if (est <= 0) return act > 0 ? 'turn_positive' : 'deficit';
  if (est <= MIN_ESTIMATE_BASE) return act > 0 ? 'inline' : 'turn_negative';
  if (act <= 0) return 'turn_negative';

  const pct = pctOf(est, act) ?? 0;
  if (pct >= SURPRISE_THRESHOLD_PCT) return 'beat';
  if (pct <= -SURPRISE_THRESHOLD_PCT) return 'miss';
  return 'inline';
}

const amountsOf = (r: QuarterRow): QuarterAmounts => ({
  revenue: r.revenue,
  operatingIncome: r.operatingIncome,
  netIncome: r.netIncome,
  eps: r.eps,
});

/**
 * upsert 직전 스냅샷(prev)과 새 소스 응답(next)을 비교해 E→A로 전환된 분기만 골라낸다.
 * prev에 없던 분기·이미 확정이던 분기·여전히 추정인 분기는 모두 제외한다.
 */
export function decideSurprises(prev: QuarterRow[], next: QuarterRow[]): SurpriseRecord[] {
  const prevByKey = new Map(prev.map((r) => [keyOf(r.fiscalYear, r.fiscalQuarter), r]));
  const records: SurpriseRecord[] = [];

  for (const act of next) {
    if (act.isEstimate) continue;

    const est = prevByKey.get(keyOf(act.fiscalYear, act.fiscalQuarter));
    if (!est || !est.isEstimate) continue;

    const kind = kindOf(est.operatingIncome, act.operatingIncome);
    if (kind == null) continue;

    records.push({
      fiscalYear: act.fiscalYear,
      fiscalQuarter: act.fiscalQuarter,
      estimateUpdatedAt: est.updatedAt,
      est: amountsOf(est),
      act: amountsOf(act),
      surprisePct: pctOf(est.operatingIncome, act.operatingIncome),
      revenueSurprisePct: pctOf(est.revenue, act.revenue),
      kind,
    });
  }

  return records;
}
