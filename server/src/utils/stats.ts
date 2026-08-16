/**
 * 표본 요약 — 여러 화면이 같은 대표값 계산을 쓴다.
 *
 * 월간 상승률의 테마·산업 칸, 산업 실적 전망의 산업 비교 칸이 모두
 * **중앙값**을 대표값으로 쓴다. 이유도 같다 — 표본 수 편차가 크고 한 종목의 극단값이
 * 평균을 통째로 끌고 가기 때문이다.
 */

/** 오름차순 중앙값. 빈 배열은 null. 입력 배열은 건드리지 않는다. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
