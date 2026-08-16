import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { isKstMarketOpen } from '../shared/lib/isKstMarketOpen';

interface PhaseTransition {
  ticker: string;
  name: string;
  date: string;
  from: string;
  to: string;
}

interface PhaseTransitionsResponse {
  asOf: string | null;
  snapDays: number;
  transitions: PhaseTransition[];
}

const PHASE_DAYS = 14;
const MIN_SNAP_DAYS = 2;

/** 국면 코드 → 한글 라벨 */
const PHASE_LABELS: Record<string, string> = {
  entered: '신규진입',
  aligned: '정배열',
  neutral: '걸침',
  exited: '이탈',
};

function phaseLabel(state: string): string {
  return PHASE_LABELS[state] ?? state;
}

/** MM-DD로 축약 (YYYY-MM-DD 입력 가정) */
function shortDate(date: string): string {
  return date.slice(5);
}

/** to 국면이 정배열 계열(신규진입/정배열)이면 빨강, 이탈이면 파랑, 걸침이면 중립 */
function toStateCls(to: string): string {
  if (to === 'entered' || to === 'aligned') return 'text-red-600 font-semibold';
  if (to === 'exited') return 'text-blue-600 font-semibold';
  return 'text-gray-600 font-medium';
}

function TransitionRow({ item }: { item: PhaseTransition }) {
  return (
    <li className="flex items-center gap-2 py-1.5 text-sm">
      <span className="text-xs text-gray-400 shrink-0 w-10">{shortDate(item.date)}</span>
      <span className="font-medium text-gray-900 truncate">{item.name}</span>
      <span className="text-gray-400 shrink-0">{phaseLabel(item.from)} → </span>
      <span className={`shrink-0 ${toStateCls(item.to)}`}>{phaseLabel(item.to)}</span>
    </li>
  );
}

/**
 * 최근 국면 전환 타임라인 — 차트보드 31종의 국면(state) 일별 이력에서 전환 이벤트만 추려
 * "MM-DD 종목명 걸침 → 신규진입" 형태로 보여준다. 기본 펼침 접이식 섹션.
 */
export function EtfPhaseTransitionsFeed() {
  const [expanded, setExpanded] = useState(true);

  const { data, isLoading } = useQuery<PhaseTransitionsResponse>({
    queryKey: ['etf', 'phase-transitions', PHASE_DAYS],
    queryFn: () => apiClient.get(API.etf.phaseTransitions, { params: { days: PHASE_DAYS } }).then((r) => r.data),
    refetchInterval: () => (isKstMarketOpen() ? 2 * 60 * 1000 : false), // 장중에만 2분 폴링
    staleTime: 100 * 1000,
  });

  const snapDays = data?.snapDays ?? 0;
  const insufficient = snapDays < MIN_SNAP_DAYS;
  const transitions = data?.transitions ?? [];

  return (
    <div className="bg-surface rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50"
      >
        <span>🔄 최근 국면 전환</span>
        <span className="text-xs font-normal text-gray-400">
          {!isLoading && !insufficient && `${transitions.length}건`}
          <span className="ml-2">{expanded ? '▲' : '▼'}</span>
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t border-gray-100">
          {isLoading && <p className="text-sm text-gray-400 pt-2">불러오는 중…</p>}

          {!isLoading && insufficient && (
            <p className="text-sm text-gray-500 pt-2">
              국면 이력 축적 중 (현재 {snapDays}일) — 내일부터 전환 이벤트가 표시됩니다.
            </p>
          )}

          {!isLoading && !insufficient && transitions.length === 0 && (
            <p className="text-sm text-gray-400 pt-2">최근 {PHASE_DAYS}일 내 국면 전환이 없습니다.</p>
          )}

          {!isLoading && !insufficient && transitions.length > 0 && (
            <ul className="divide-y divide-gray-50">
              {transitions.map((item) => (
                <TransitionRow key={`${item.ticker}-${item.date}`} item={item} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
