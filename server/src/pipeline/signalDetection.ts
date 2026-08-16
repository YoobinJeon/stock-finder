/**
 * 신규 시그널 3종 감지 조건 — 순수 함수 (DB I/O 없음). ingest.ts의 computeIndicators()·
 * updateRsPercentiles()가 이미 계산된 지표를 넘겨 호출하고, 참이면 signals 테이블에 기록한다.
 * (시그널 엔진 — ARCHITECTURE.md 참고)
 */

/** 거래대금급증 최소 배수 — 오닐식 대량거래 브레이크아웃 판정 기준 */
export const VOLUME_SURGE_MIN_RATIO = 3;
/** 52주 고점 대비 허용 하락폭(%) — 이 값 이상(0에 가까울수록 고점 근접)이어야 함 */
export const VOLUME_SURGE_MAX_PCT_FROM_HIGH = -3;
/** RS 백분위 상위 10% 컷 — rs_top_entry 진입/이탈 판정 기준 */
export const RS_TOP_ENTRY_THRESHOLD = 90;

/**
 * volume_surge_high: 거래대금급증 ≥3배 && 종가가 52주 고점 대비 -3% 이내.
 * pctFromHigh는 0(신고가) 이하 값(예: -2.5 = 고점 대비 -2.5%)을 가정한다.
 */
export function isVolumeSurgeHigh(turnoverSurge: number | null, pctFromHigh: number | null): boolean {
  if (turnoverSurge == null || pctFromHigh == null) return false;
  return turnoverSurge >= VOLUME_SURGE_MIN_RATIO && pctFromHigh >= VOLUME_SURGE_MAX_PCT_FROM_HIGH;
}

/**
 * inst_new_accum: 기관 5일 순매수 금액 > 0 && 기관 20일 순매수 금액 ≤ 0.
 * 20일 누적이 아직 음(-)인데 최근 5일만 양(+)으로 돌아선 "신규 매집 전환" 시점을 포착한다.
 */
export function isInstNewAccum(instAmt5d: number | null, instAmt20d: number | null): boolean {
  if (instAmt5d == null || instAmt20d == null) return false;
  return instAmt5d > 0 && instAmt20d <= 0;
}

/**
 * rs_top_entry: 오늘 rs_percentile ≥90 && 직전 rs_percentile_prev <90 (RS 상위 10% 신규 진입).
 * rsPercentilePrev가 null(최초 계산 등 이전 값 없음)이면 "신규 진입" 여부를 판정할 수 없으므로 false.
 */
export function isRsTopEntry(rsPercentile: number | null, rsPercentilePrev: number | null): boolean {
  if (rsPercentile == null || rsPercentilePrev == null) return false;
  return rsPercentile >= RS_TOP_ENTRY_THRESHOLD && rsPercentilePrev < RS_TOP_ENTRY_THRESHOLD;
}
