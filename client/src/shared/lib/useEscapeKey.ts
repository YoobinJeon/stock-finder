import { useEffect } from 'react';

/**
 * Escape로 모달을 닫는다.
 *
 * 같은 `useEffect` 블록이 화면마다 복제돼 있었고(검색창·심볼차트·캘린더 팝업·사이드바),
 * 복제를 하나 빠뜨리면 그 모달만 조용히 Escape가 안 먹는다 — 실제로 종목 상세·ETF 상세·
 * 차트보드 구성 패널 셋이 그랬다. 새로 다는 곳은 이 훅을 쓴다.
 * (기존 4곳은 동작 중이라 건드리지 않았다 — 다음에 그 파일을 손댈 때 함께 옮기면 된다.)
 */
export function useEscapeKey(onEscape: () => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onEscape]);
}
