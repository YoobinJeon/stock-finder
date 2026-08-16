import { useMemo, useState } from 'react';
import { SORT_BUTTON_CLASS } from '../lib/clickableRow';
import { nextSort, sortRows, type SortState, type SortOrder, type SortValue } from '../lib/clientSort';

/**
 * 화면 정렬(클라이언트) 표 헤더.
 *
 * 스크리너의 `SortTh`(서버 정렬)와 모양·조작을 일부러 똑같이 맞췄다 — 같은 표 조작을 화면마다
 * 다르게 배우게 하지 않기 위함. 정렬 방향은 `<th aria-sort>`로 스크린리더에 알리고, 클릭 대상은
 * `<th>`가 아니라 셀 안의 진짜 `<button>`이라 키보드로도 조작된다(`clickableRow.ts` 주석 참고).
 */
export function SortableTh({
  label, col, sort, onSort, align = 'right', pad = 'px-3 py-3', title,
}: {
  label: string;
  col: string;
  sort: SortState;
  onSort: (col: string) => void;
  align?: 'left' | 'right';
  pad?: string;
  /** 정렬 기준이 표시값과 다를 때 설명 (예: 상승/하락 → 상승 종목 수 기준) */
  title?: string;
}) {
  const active = sort.key === col;
  const alignClass = align === 'left' ? 'text-left' : 'text-right';
  return (
    <th
      className={`${pad} ${alignClass} text-xs font-medium ${active ? 'text-blue-600' : 'text-gray-500'}`}
      aria-sort={active ? (sort.order === 'desc' ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        title={title ?? '클릭하여 정렬'}
        className={`${SORT_BUTTON_CLASS} ${alignClass} hover:text-blue-600`}
      >
        {label}{active && (sort.order === 'desc' ? ' ▼' : ' ▲')}
      </button>
    </th>
  );
}

/**
 * 표 정렬 상태 + 정렬된 행을 돌려준다.
 * `accessors`의 키가 곧 칸 이름(`SortableTh`의 `col`)이다 — 없는 키로 들어오면 원래 순서를 쓴다.
 *
 * ⚠️ **`accessors`는 호출측에서 `useMemo`로 감싸야 한다.** 이 훅은 accessors의 동일성으로
 * 재정렬 시점을 판단한다. 렌더마다 새 객체를 넘기면 매 렌더 재정렬해 memo가 무의미해지고,
 * 반대로 의존성에서 빼면 **같은 열이 다른 값을 가리키게 바뀌어도 순서가 갱신되지 않는다**
 * (산업 실적 전망에서 매출→영업이익 토글 시 금액만 바뀌고 순서가 매출 기준으로 남았다).
 */
export function useClientSort<T>(
  rows: readonly T[],
  accessors: Record<string, (row: T) => SortValue>,
  initialKey: string,
  initialOrder: SortOrder = 'desc',
): { sorted: T[]; sort: SortState; onSort: (col: string) => void } {
  const [sort, setSort] = useState<SortState>({ key: initialKey, order: initialOrder });

  // 정렬 기준이 사라질 수 있다 — 화면에서 그 항목을 끄면 accessors에서 키가 빠진다.
  // 그때 정렬을 통째로 포기하면(원래 순서로 복귀) 사용자가 이유를 알 수 없으므로,
  // 방향은 유지한 채 기본 기준으로 물러나고 **그 사실을 `sort`로 돌려준다** —
  // 헤더의 활성 표시가 사라진 기준을 계속 가리키지 않도록.
  const effective: SortState = accessors[sort.key] ? sort : { key: initialKey, order: sort.order };

  const sorted = useMemo(() => {
    const get = accessors[effective.key];
    return get ? sortRows(rows, get, effective.order) : [...rows];
  }, [rows, effective.key, effective.order, accessors]);

  return { sorted, sort: effective, onSort: (col: string) => setSort((s) => nextSort(s, col)) };
}
