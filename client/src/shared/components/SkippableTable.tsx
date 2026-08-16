import { useId, type ReactNode } from 'react';

/**
 * 긴 표를 탭 한 번으로 지나가게 하는 건너뛰기 링크.
 *
 * 행을 클릭 가능하게 만들면(`clickableRow`) 행마다 탭 정지점이 생긴다 — 테마 266행·
 * ETF 200행짜리 표에서는 표 아래 콘텐츠에 닿기까지 탭을 그만큼 눌러야 한다.
 * 링크는 평소 보이지 않다가 포커스를 받으면 나타나고(`sr-only` → `focus:not-sr-only`),
 * 표 뒤에 놓인 목표로 포커스를 옮긴다(`tabIndex={-1}`이라 탭 순서는 늘지 않는다).
 */
export function SkippableTable({ label, children }: { label: string; children: ReactNode }) {
  // useId()는 `:r0:`처럼 콜론이 든 값을 준다 — HTML id로는 유효하지만 CSS 선택자로는 못 쓰고
  // 프래그먼트 링크 대상으로도 취약하다. 콜론을 걷어내 안전한 id로 만든다.
  const id = `skip-${useId().replace(/:/g, '')}`;
  return (
    <>
      <a
        href={`#${id}`}
        className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:rounded-lg focus:border focus:border-blue-300 focus:bg-surface focus:px-3 focus:py-1.5 focus:text-xs focus:text-blue-700"
      >
        {label} 건너뛰기
      </a>
      {children}
      <div id={id} tabIndex={-1} />
    </>
  );
}
