/**
 * 증감률 표기 — 여러 표가 같은 규칙으로 %를 그린다.
 *
 * 월간 상승률의 테마·산업 칸과 산업 실적 전망의 산업 비교 칸이 같은 표기를
 * 쓴다. 규칙이 화면마다 갈리면 같은 +12.3%가 어느 화면에서는 붉고 어느 화면에서는 푸르게 된다.
 */

export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value == null) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

/**
 * 수익률·증가율 칸의 배경 색조 — 오르면 붉게, 내리면 푸르게, 세기는 크기에 비례.
 *
 * 색만으로 뜻을 전달하지 않는다(숫자와 부호를 항상 함께 적는다) — 색은 표를 훑을 때
 * 눈이 먼저 걸리게 하는 보조 수단이다.
 */
export function heatStyle(value: number | null | undefined): React.CSSProperties {
  if (value == null) return {};
  // ±20%에서 최대 세기에 닿게 한다 — 월간 등락도, 연간 성장률 중앙값도 대개 이 안에 들어온다.
  const intensity = Math.min(1, Math.abs(value) / 0.2);
  const alpha = 0.06 + intensity * 0.22;
  return value >= 0
    ? { backgroundColor: `rgba(220, 38, 38, ${alpha})` }
    : { backgroundColor: `rgba(37, 99, 235, ${alpha})` };
}

export function pctColorClass(value: number | null | undefined): string {
  if (value == null) return 'text-gray-300';
  if (value > 0) return 'text-red-600';
  if (value < 0) return 'text-blue-600';
  return 'text-gray-400';
}
