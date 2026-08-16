import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { API } from '../api/endpoints';
import { scoreColorClass } from '../lib/scoreGrade';
import { RouteErrorBoundary } from './RouteErrorBoundary';

// 검색창은 Layout에 있어 모든 화면에 실린다. 여기서 상세 패널을 정적으로 끌어오면
// 그 뒤에 딸린 차트 라이브러리(gzip 56kB)가 전 화면의 초기 번들에 들어간다 —
// 실제로는 검색 결과를 눌러야 열리는 모달이므로 열릴 때 받아온다.
const StockDetailPanel = lazy(() =>
  import('./StockDetailPanel').then((m) => ({ default: m.StockDetailPanel })),
);

/**
 * 전역 종목 검색 — 종목명·티커로 찾아 바로 종목 상세를 연다.
 *
 * 결과 목록을 사이드바 안 드롭다운으로 띄웠더니 폭이 좁아 읽기 어려웠다(실사용 피드백).
 * 트리거 버튼만 사이드바에 두고 검색 자체는 **화면 중앙 팝업**에서 처리한다.
 * 전용 검색 API는 만들지 않고 스크리너의 `q` 필터(`name ILIKE` OR `ticker LIKE`)를 재사용한다.
 */

const DEBOUNCE_MS = 250;
const MAX_RESULTS = 20;
const MIN_QUERY_LEN = 1;

interface SearchHit {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
  total_score: number | null;
}

/** 중앙 팝업 본체 — 큰 입력창 + 여유 있는 결과 목록 */
function SearchModal({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (hit: SearchHit) => void;
}) {
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 입력이 멈춘 뒤에만 조회 — 타이핑 중 매 글자 요청 방지
  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 팝업이 열린 동안 뒤 페이지가 같이 스크롤되지 않게 잠근다(모바일에서 특히 거슬림)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const { data, isFetching } = useQuery<{ data: SearchHit[]; total: number }>({
    queryKey: ['stock-search', debounced],
    queryFn: () =>
      apiClient
        .post(API.screener.search, { q: debounced, sort: 'score', order: 'desc', page: 1, pageSize: MAX_RESULTS })
        .then((r) => r.data),
    enabled: debounced.length >= MIN_QUERY_LEN,
    staleTime: 60 * 1000,
  });

  const hits = data?.data ?? [];
  const hasQuery = debounced.length >= MIN_QUERY_LEN;

  return (
    // 모바일: 상단 여백을 최소화해 키보드가 올라와도 목록이 남는다. dvh는 주소창·키보드로
    // 줄어든 실제 표시 영역을 반영하는 단위(vh는 모바일에서 잘림이 생김).
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-2 sm:pt-[8vh] px-2 sm:px-4"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl sm:rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[80dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200">
          <span className="text-gray-400" aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && hits.length > 0) onPick(hits[0]); }}
            placeholder="종목명 또는 종목코드 입력"
            aria-label="종목 검색"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            // text-base(16px) 유지 필수 — iOS Safari는 16px 미만 입력창에 자동 확대가 걸린다
            className="flex-1 bg-transparent text-base text-gray-900 placeholder:text-gray-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="검색 닫기"
            className="text-gray-400 hover:text-gray-700 text-sm p-2 -mr-1 min-w-[40px] min-h-[40px]"
          >
            ✕
          </button>
        </div>

        {/* overscroll-contain: 목록 끝에서 스크롤이 뒤 페이지로 넘어가지 않게(모바일 관성 스크롤) */}
        <div className="overflow-y-auto overscroll-contain">
          {!hasQuery ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">
              종목명(예: 하이닉스) 또는 코드(예: 000660)를 입력하세요
            </p>
          ) : isFetching && hits.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">검색 중…</p>
          ) : hits.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">검색 결과가 없습니다.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {hits.map((h) => (
                <li key={h.ticker}>
                  <button
                    type="button"
                    onClick={() => onPick(h)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3.5 min-h-[56px] text-left hover:bg-blue-50 active:bg-blue-100"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900 truncate">{h.name}</span>
                      <span className="block text-xs text-gray-400 mt-0.5">
                        {h.ticker} · {h.market}
                        {h.sector ? ` · ${h.sector}` : ''}
                      </span>
                    </span>
                    {h.total_score != null && (
                      <span className="shrink-0 text-right">
                        <span className={`block text-base font-bold ${scoreColorClass(Number(h.total_score))}`}>
                          {Math.round(Number(h.total_score))}
                        </span>
                        <span className="block text-[10px] text-gray-400">종합점수</span>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {hasQuery && (data?.total ?? 0) > hits.length && (
          <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
            상위 {hits.length}건 표시 · 전체 {data?.total}건
          </p>
        )}
      </div>
    </div>
  );
}

/** compact: 모바일 헤더처럼 폭이 좁은 자리에서는 아이콘 버튼만 노출한다 */
export function StockSearchBox({
  onNavigate,
  compact = false,
}: {
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<SearchHit | null>(null);

  const pick = (hit: SearchHit) => {
    setSelected(hit);
    setModalOpen(false);
    onNavigate?.();
  };

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          aria-label="종목 검색"
          className="p-2 text-gray-600 hover:text-gray-900"
        >
          🔍
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="w-full flex items-center gap-2 text-sm rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-400 hover:border-blue-300 hover:text-gray-600"
        >
          <span aria-hidden="true">🔍</span>
          <span className="truncate">종목 검색</span>
        </button>
      )}

      {/*
        오버레이는 반드시 body로 포털한다. 이 컴포넌트는 사이드바(<aside>) 안에서 렌더되는데
        사이드바에 translate-x(transform)가 걸려 있어, 그 자리에서 렌더하면 position:fixed가
        뷰포트가 아니라 사이드바 박스를 기준으로 잡혀 팝업이 사이드바 안에 갇힌다
        (CSS: transform 조상이 fixed의 컨테이닝 블록이 됨). 모바일 헤더에는 transform이 없어
        같은 코드가 정상 동작했던 것 — 데스크톱에서만 "팝업이 안 뜨는" 것처럼 보인 원인.
      */}
      {modalOpen && createPortal(
        <SearchModal onClose={() => setModalOpen(false)} onPick={pick} />,
        document.body,
      )}

      {selected && createPortal(
        // 이 검색창은 Layout 안, 즉 App.tsx의 라우트 에러 바운더리 *바깥*에 있다.
        // 여기서 청크 로드가 실패하면 잡아줄 경계가 없어 앱 전체가 하얗게 죽으므로
        // 자체 경계를 둔다. fallback이 null인 이유: 청크를 받는 짧은 사이 자리표시를
        // 띄우면 모달이 두 번 깜빡이는 것처럼 보인다 — 준비되면 바로 연다.
        <RouteErrorBoundary>
          <Suspense fallback={null}>
            <StockDetailPanel
              ticker={selected.ticker}
              name={selected.name}
              market={selected.market}
              sector={selected.sector}
              totalScore={selected.total_score}
              onClose={() => setSelected(null)}
            />
          </Suspense>
        </RouteErrorBoundary>,
        document.body,
      )}
    </>
  );
}
