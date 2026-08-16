/**
 * 점수 등급·배지 색상 단일 소스.
 * 이전에는 파일마다 컷이 제각각이었다 — ScreenerPage(80/70/60/50/40 6단),
 * DashboardPage(75/55), StockDetailPanel/compareFormat(70/55/40), SignalsPage(70/55, 40 누락).
 * 다수파 계열(70/55/40 + 80↑ A+)로 통일한다 (Phase 0a, 2026-07-18).
 */

/** 등급 컷 임계값 — 프로젝트 컨벤션상 UPPER_SNAKE 아님(객체 속성은 camelCase) */
export const SCORE_CUTS = {
  aPlus: 80,
  a: 70,
  b: 55,
  c: 40,
} as const;

/** 점수 → 문자 등급 (A+ / A / B / C / D) */
export function gradeOf(score: number): string {
  if (score >= SCORE_CUTS.aPlus) return 'A+';
  if (score >= SCORE_CUTS.a) return 'A';
  if (score >= SCORE_CUTS.b) return 'B';
  if (score >= SCORE_CUTS.c) return 'C';
  return 'D';
}

/**
 * 점수 배지 색 (배경-100 + 글자-700 계열) — DashboardPage/StockDetailPanel/SignalsPage/
 * compareFormat이 공유하는 "필(pill)" 배지 스타일.
 */
export function scoreColorClass(score: number | null): string {
  if (score == null) return 'bg-gray-100 text-gray-500';
  if (score >= SCORE_CUTS.a) return 'bg-emerald-100 text-emerald-700';
  if (score >= SCORE_CUTS.b) return 'bg-blue-100 text-blue-700';
  if (score >= SCORE_CUTS.c) return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-500';
}

/**
 * ScreenerPage 전용 점수 배지 스타일 (옅은 배경-50 + 테두리) — 레이아웃은 기존과 동일하게
 * 유지하되 컷 값만 SCORE_CUTS로 통일.
 */
export function scoreBadgeStyle(score: number): { bg: string; text: string } {
  if (score >= SCORE_CUTS.a) return { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' };
  if (score >= SCORE_CUTS.b) return { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' };
  if (score >= SCORE_CUTS.c) return { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700' };
  return { bg: 'bg-red-50 border-red-200', text: 'text-red-600' };
}
