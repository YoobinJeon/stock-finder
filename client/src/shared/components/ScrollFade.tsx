import { useEffect, useRef, useState } from 'react';

interface ScrollFadeProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * 가로 스크롤 영역에 좌/우 "더 있음" 페이드 힌트를 씌우는 래퍼.
 * 스크롤 위치·콘텐츠 크기 변화에 반응해 필요한 쪽 페이드만 표시한다.
 * 구조: relative 래퍼 > 스크롤 div(overflow-x-auto + 전달 className) > 좌/우 페이드 오버레이.
 */
export function ScrollFade({ children, className = '' }: ScrollFadeProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  const updateFade = () => {
    const el = scrollRef.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > 4);
    setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  // 스크롤·컨테이너 크기 변화 리스너 (마운트 시 1회 등록, cleanup 필수)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    updateFade();
    el.addEventListener('scroll', updateFade);
    const resizeObserver = new ResizeObserver(updateFade);
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener('scroll', updateFade);
      resizeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 콘텐츠(children)가 바뀌면(항목 추가/제거 등) 페이드 상태 재계산
  useEffect(() => {
    updateFade();
  }, [children]);

  return (
    <div className="relative">
      <div ref={scrollRef} className={`overflow-x-auto ${className}`}>
        {children}
      </div>
      {showLeft && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface to-transparent rounded-l-xl" />
      )}
      {showRight && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent rounded-r-xl" />
      )}
    </div>
  );
}
