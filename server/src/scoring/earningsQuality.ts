/**
 * 이익의 질 분석 — 단년 스냅샷이 아니라 최근 3개년 시계열로 판단.
 *
 * 핵심 아이디어:
 * - "일회성"은 순이익이 영업이익 대비 '이번 연도만' 튀는 것.
 *   지주사·지분법 구조처럼 매년 순이익>영업이익이면 구조적 특성이므로 페널티 대상이 아님.
 * - 이익의 질은 성장 추세와 함께 봐야 함: 영업이익이 실제로 성장(또는 흑자전환)했다면
 *   순이익 급증의 일부는 본업 개선이고, 영업이익이 감소하는데 순이익만 늘었다면 질 낮은 성장.
 */

export interface FinYearRow {
  fiscal_year: number;
  revenue: number | string | null;
  operating_income: number | string | null;
  net_income: number | string | null;
}

export interface EarningsQuality {
  /** 최신 연도만 순이익이 영업이익 대비 급증 — 일회성(영업외) 이익 의심 */
  oneOff: boolean;
  /** 매년 순이익 > 영업이익×2 (영업이익 흑자 유지) — 지주사/지분법 등 구조적 특성 */
  structural: boolean;
  /** 영업이익 YoY 성장률 (직전 연도 영업이익이 양수일 때만) */
  opGrowth: number | null;
  /** 영업 적자 → 흑자 전환 */
  opTurnaround: boolean;
  /** 영업이익 흑자 → 적자 전환 */
  opCollapse: boolean;
  /** 최신 연도 영업이익률 (매출 양수일 때) */
  opMargin: number | null;
}

const n = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/** 순이익이 영업이익 대비 과다한가 (영업외 이익 의존) */
function niDominates(op: number | null, ni: number | null): boolean {
  return ni != null && ni > 0 && op != null && (op <= 0 || ni > op * 2);
}

/**
 * rows: 최신 연도부터 내림차순 정렬된 확정 실적 (최대 3개년)
 */
export function assessEarningsQuality(rows: FinYearRow[]): EarningsQuality {
  const cur = rows[0];
  const prev = rows.length >= 2 ? rows[1] : null;

  const curOp = n(cur?.operating_income);
  const curNi = n(cur?.net_income);
  const curRev = n(cur?.revenue);
  const prevOp = prev ? n(prev.operating_income) : null;

  const flaggedNow = niDominates(curOp, curNi);

  // 구조적 판별: 과거 연도 중 '영업이익이 흑자이면서도' 순이익이 2배를 넘은 해가 있으면
  // 지주사형 구조로 보고 일회성 페널티를 면제. (영업적자+순이익 흑자인 과거는
  // 그 자체가 비정상이므로 구조적 증거로 인정하지 않음)
  const structural =
    flaggedNow &&
    rows.slice(1).some((r) => {
      const op = n(r.operating_income);
      const ni = n(r.net_income);
      return op != null && op > 0 && ni != null && ni > op * 2;
    });

  const oneOff = flaggedNow && !structural;

  let opGrowth: number | null = null;
  let opTurnaround = false;
  let opCollapse = false;
  if (curOp != null && prevOp != null) {
    if (prevOp > 0 && curOp > 0) opGrowth = (curOp - prevOp) / prevOp;
    else if (prevOp <= 0 && curOp > 0) opTurnaround = true;
    else if (prevOp > 0 && curOp <= 0) opCollapse = true;
  }

  const opMargin = curRev != null && curRev > 0 && curOp != null ? curOp / curRev : null;

  return { oneOff, structural, opGrowth, opTurnaround, opCollapse, opMargin };
}
