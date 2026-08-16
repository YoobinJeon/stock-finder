import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { API } from '../api/endpoints';

type TrendState = 'entered' | 'aligned' | 'neutral' | 'exited';

interface PhaseBoardItem {
  ticker: string;
  name: string;
  state: TrendState;
  recentExit: boolean;
}

interface PhaseBoardResponse {
  items: PhaseBoardItem[];
}

const STALE_TIME_MS = 2 * 60 * 1000;

/** 조건 충족 종목명 칩 목록 — 레이블 칩 + 이름 칩들 */
function PhaseChipRow({ label, cls, items }: { label: string; cls: string; items: PhaseBoardItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex items-start gap-2 text-sm mb-1.5">
      <span className={`shrink-0 text-xs font-bold rounded px-2 py-1 ${cls}`}>{label}</span>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {items.map((i) => (
          <span
            key={i.ticker}
            className="text-xs bg-surface border border-gray-200 rounded px-2 py-0.5 text-gray-800"
          >
            {i.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * 대시보드용 ETF 국면 요약 한 줄 카드 — /etf 차트보드의 국면(정배열/신규진입/걸침/이탈)을
 * 대시보드에서 즉시 확인. 로딩·에러 시 카드 자체를 숨긴다(fail-soft).
 */
export function EtfPhaseStrip() {
  const { data, isLoading, isError } = useQuery<PhaseBoardResponse>({
    queryKey: ['etf', 'board', 'phase-strip'],
    queryFn: () => apiClient.get(API.etf.board).then((r) => r.data),
    staleTime: STALE_TIME_MS,
  });

  if (isLoading || isError || !data) return null;

  const items = data.items;
  const entered = items.filter((i) => i.state === 'entered');
  const recentExit = items.filter((i) => i.recentExit);
  const neutral = items.filter((i) => i.state === 'neutral');
  // 정배열 요약은 신규진입(정배열 진입 5일 이내)도 포함 — entered는 aligned의 부분집합
  const alignedCount = items.filter((i) => i.state === 'aligned' || i.state === 'entered').length;
  const neutralCount = neutral.length;
  const exitedCount = items.filter((i) => i.state === 'exited').length;

  return (
    <div className="bg-surface rounded-xl p-4 border border-gray-200 mb-8">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-sm font-semibold text-gray-900">🧭 산업 국면 (ETF)</h3>
        <Link to="/etf" className="text-xs text-blue-600 hover:underline">
          차트보드 →
        </Link>
      </div>
      <PhaseChipRow label="🚀 신규진입" cls="text-white bg-red-500" items={entered} />
      <PhaseChipRow label="⚠️ 최근 이탈" cls="text-white bg-blue-500" items={recentExit} />
      <PhaseChipRow label="⚖️ 걸침" cls="text-amber-700 bg-amber-50 border border-amber-100" items={neutral} />
      <p className="text-xs text-gray-500">
        정배열 {alignedCount} · 걸침 {neutralCount} · 이탈 {exitedCount}
      </p>
    </div>
  );
}
