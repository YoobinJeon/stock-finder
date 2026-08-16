import type { KeyboardEvent } from 'react';

/**
 * 클릭으로 상세를 여는 `<tr>`에 키보드 조작을 부여하는 공통 props.
 *
 * **왜 `role="button"`을 쓰지 않는가**: 표 안의 행은 암묵 role이 `row`이고, 이를 `button`으로
 * 덮어쓰면 스크린리더가 표 구조(행·열 위치, 헤더 셀 연결)를 통째로 잃는다. `CalendarPage`의
 * 날짜 칸은 `<div>`라 `role="button"`이 맞았지만 `<tr>`에는 같은 처방을 쓸 수 없다.
 * 그래서 행 의미론은 그대로 두고 **포커스 가능하게만** 만든 뒤(tabIndex) Enter·Space를
 * 클릭과 동일하게 처리하고, 무엇이 열리는지는 `aria-label`로 보완한다.
 *
 * **완전한 해법**은 셀 안에 실제 `<button>`을 두는 것이지만, 현재 행들은 셀 전체가 클릭 영역이라
 * 그 전환은 레이아웃 변경을 동반한다(잔여 과제로 기록).
 */
export function clickableRowProps(onActivate: () => void, label: string) {
  return {
    tabIndex: 0,
    'aria-label': label,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      // 행 안의 체크박스·버튼에서 올라온 키 입력까지 삼키면 그 컨트롤이 망가진다
      // (예: 스크리너 비교 체크박스의 Space). 행 자체에 포커스가 있을 때만 처리한다.
      if (e.target !== e.currentTarget) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); // Space의 페이지 스크롤 방지
      onActivate();
    },
  };
}

/**
 * 클릭 가능한 행의 커서 + 포커스 표시.
 * 표에는 Tailwind preflight가 `border-collapse: collapse`를 걸어두는데, 그 아래에서
 * box-shadow(Tailwind `ring-*`)는 브라우저마다 어긋나므로 outline을 쓰고 링이 표 밖으로
 * 잘리지 않게 offset을 안쪽(-2px)으로 준다. 다만 `<tr>` outline도 엔진별 편차가 있어
 * **배경색 변화를 함께** 준다 — 행 배경은 collapse 아래에서도 확실히 그려지므로,
 * outline이 안 보이는 환경에서도 포커스 위치를 잃지 않는다.
 */
export const CLICKABLE_ROW_CLASS =
  'cursor-pointer focus:outline-none focus-visible:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-[-2px]';

/**
 * 정렬용 헤더 버튼의 공통 클래스.
 * `<th>`에 직접 `onClick`을 걸면 포커스도 Enter도 받지 못한다 — 행과 달리 헤더는 셀 안에
 * 진짜 `<button>`을 두는 정석 처방이 레이아웃 변화 없이 가능하므로 그렇게 고친다.
 * 정렬 방향은 `<th aria-sort>`로 스크린리더에 알린다.
 */
export const SORT_BUTTON_CLASS =
  'w-full select-none focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2';
