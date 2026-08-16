/**
 * 이미 받아온 배열을 화면에서 정렬하는 순수 유틸 (테마 레이더·산업 레이더 표).
 *
 * 스크리너는 서버 정렬이라 `sort`·`order`를 API로 넘기지만, 레이더 표들은 전체 목록을
 * 한 번에 받아 쓰므로 서버를 다시 부를 이유가 없다. 정렬 방향 토글 규칙은 스크리너와 맞춘다
 * 화면마다 다르면 같은 표를 두 방식으로 배워야 한다.
 */
export type SortOrder = 'asc' | 'desc';
export type SortValue = number | string | null | undefined;

export interface SortState {
  key: string;
  order: SortOrder;
}

/**
 * 값 비교자. **빈 값(null·undefined·'')은 방향과 무관하게 항상 뒤로** 보낸다 —
 * 오름차순에서 '—' 행이 표 맨 위를 채우면 정렬한 의미가 없어진다.
 */
export function compareSortValues(a: SortValue, b: SortValue, order: SortOrder): number {
  const aEmpty = a == null || a === '';
  const bEmpty = b == null || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  // 뺄셈 대신 대소 비교를 쓴다 — 수급 금액은 조 단위라 뺄셈이 불필요하게 큰 수를 만들고,
  // 동점일 때 `0 * -1 = -0`이라는 지저분한 값이 나온다.
  const dir = order === 'desc' ? -1 : 1;
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return 0;
    return a < b ? -dir : dir;
  }
  const cmp = String(a).localeCompare(String(b), 'ko');
  if (cmp === 0) return 0;
  return cmp < 0 ? -dir : dir;
}

/**
 * 행을 정렬해 **새 배열**로 돌려준다 (원본 불변).
 * 같은 값끼리는 원래 순서를 유지한다 — 서버가 정해준 기본 순서(예: 점수순)가 동점 구간에서
 * 뒤섞이면 폴링할 때마다 행이 튄다.
 */
export function sortRows<T>(
  rows: readonly T[],
  get: (row: T) => SortValue,
  order: SortOrder,
): T[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => compareSortValues(get(x.row), get(y.row), order) || x.i - y.i)
    .map((e) => e.row);
}

/** 같은 칸을 다시 누르면 방향만 뒤집고, 다른 칸이면 내림차순부터 (스크리너와 동일 규칙). */
export function nextSort(current: SortState, key: string): SortState {
  return { key, order: current.key === key && current.order === 'desc' ? 'asc' : 'desc' };
}
