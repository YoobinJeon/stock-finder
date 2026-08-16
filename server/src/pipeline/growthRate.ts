/**
 * 증가율 계산 공통 규칙.
 *
 * 같은 3줄이 `earningsTrend.ts`와 `sources/naverFinancials.ts`에 각각 사본으로 있었다.
 * 산업 실적 전망이 세 번째 사본을 만들 참이라 여기로 통일한다 — 규칙이 갈리면
 * 화면마다 "같은 +30%"가 다른 뜻이 된다.
 */

/**
 * 증가율(소수: 0.2 = +20%). **직전 값이 0 이하면 null**이다.
 *
 * 분모가 음수면 부호가 뒤집혀 적자 확대가 "성장"으로 보이고(−100억 → −200억이 −100%),
 * 0이면 무한대가 된다. 백분율이 성립하지 않는 구간은 숫자를 만들지 않고 비워 두고,
 * 적자→흑자는 `isTurnaround`가 따로 판정한다.
 */
export function growthRate(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null || prev <= 0) return null;
  return (cur - prev) / prev;
}

/** 적자 → 흑자 전환. `growthRate`가 null을 주는 구간에서 "개선"을 가려내는 유일한 수단이다. */
export function isTurnaround(cur: number | null | undefined, prev: number | null | undefined): boolean {
  return prev != null && prev <= 0 && cur != null && cur > 0;
}
