import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { PriceChartCore, type ChartRow } from '../shared/components/PriceChartCore';
import { EtfPhaseTransitionsFeed } from './EtfPhaseTransitionsFeed';
import { BoardConfigPanel } from './etf/BoardConfigPanel';
import { isKstMarketOpen } from '../shared/lib/isKstMarketOpen';

interface BoardCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type TrendState = 'entered' | 'aligned' | 'neutral' | 'exited';

interface BoardItem {
  ticker: string;
  group: string;
  name: string;
  price: number;
  changePct: number | null;
  flags: {
    ma20: number | null;
    ma60: number | null;
    above20: boolean | null;
    above60: boolean | null;
    aligned: boolean | null;
    newHigh: boolean | null;
    high52w: number | null;
  };
  state: TrendState;
  alignedStreak: number;
  recentExit: boolean;
  candles: BoardCandle[];
}

interface BoardResponse {
  asOf: string;
  intraday: boolean;
  items: BoardItem[];
}

type Filter = 'all' | 'entered' | 'aligned' | 'above60' | 'neutral' | 'exited' | 'newHigh';

const FILTER_LABELS: Record<Filter, string> = {
  all: '전체',
  entered: '🚀 신규진입',
  aligned: '📈 정배열',
  above60: '🟢 60일선 위',
  neutral: '⚖️ 걸침',
  exited: '📉 이탈',
  newHigh: '🏆 신고가',
};

/** 국면 배지 스타일 — 한국 관례대로 상승=빨강, 하락=파랑 */
const STATE_BADGE: Record<TrendState, { cls: string; label: (streak: number) => string }> = {
  entered: { cls: 'text-white bg-red-500', label: () => '🚀 신규진입' },
  aligned: { cls: 'text-white bg-amber-500', label: (streak) => `정배열 ${streak}일` },
  neutral: { cls: 'text-gray-600 bg-gray-200', label: () => '걸침' },
  exited: { cls: 'text-blue-700 bg-blue-100', label: () => '이탈' },
};

/** 카드 상태 → 강조 스타일 (신고가 > 신규진입 > 정배열 > 걸침/이탈 > 기본) */
function cardStyle(item: BoardItem): string {
  if (item.flags.newHigh) return 'border-red-400 ring-2 ring-red-200 bg-red-50/40';
  if (item.state === 'entered') return 'border-red-300 ring-1 ring-red-200 bg-red-50/30';
  if (item.state === 'aligned') return 'border-amber-300 ring-1 ring-amber-200 bg-amber-50/30';
  if (item.state === 'exited') return 'border-blue-200 bg-blue-50/20';
  return 'border-gray-200';
}

function matches(item: BoardItem, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'newHigh') return item.flags.newHigh === true;
  // 60일선 위는 국면(정배열/걸침/이탈)과 독립된 중기 추세 기준 — 정배열보다 넓게 잡힌다
  if (filter === 'above60') return item.flags.above60 === true;
  // 정배열은 신규진입(정배열 진입 5일 이내)을 포함하는 상위 개념이므로 함께 표시
  if (filter === 'aligned') return item.state === 'aligned' || item.state === 'entered';
  return item.state === filter;
}

/** 정렬 우선순위: 신고가 → 신규진입 → 정배열 → 걸침 → 이탈 (그룹 내) */
function rank(item: BoardItem): number {
  if (item.flags.newHigh) return 0;
  const order: Record<TrendState, number> = { entered: 1, aligned: 2, neutral: 3, exited: 4 };
  return order[item.state];
}

function StatusBadges({ item }: { item: BoardItem }) {
  // 최근 이탈(정배열/신규진입에서 5거래일 내 무너짐)은 일반 이탈보다 강조 — 주목 대상
  const badge = item.recentExit
    ? { cls: 'text-white bg-blue-500', label: () => '⚠️ 최근 이탈' }
    : STATE_BADGE[item.state];
  // 정배열/신규진입이 아닌데 60일선은 지킨 종목만 표시 — 국면 배지로는 안 드러나는 정보
  const showAbove60 = item.flags.above60 === true && item.state !== 'aligned' && item.state !== 'entered';
  return (
    <span className="flex gap-1 flex-wrap justify-end">
      {item.flags.newHigh && (
        <span className="text-[10px] font-bold text-white bg-red-500 rounded px-1.5 py-0.5">🚀 신고가</span>
      )}
      {showAbove60 && (
        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 rounded px-1.5 py-0.5">60↑</span>
      )}
      <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${badge.cls}`}>
        {badge.label(item.alignedStreak)}
      </span>
    </span>
  );
}

function BoardCard({ item, onSelect }: { item: BoardItem; onSelect: (ticker: string) => void }) {
  const rows: ChartRow[] = item.candles.map((c) => ({
    time: c.date, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
  }));

  return (
    <button
      onClick={() => onSelect(item.ticker)}
      className={`rounded-xl border p-3 text-left hover:shadow-md transition bg-surface ${cardStyle(item)}`}
    >
      <div className="flex items-start gap-1.5 mb-1">
        <span className="text-sm font-semibold text-gray-900 truncate">{item.name}</span>
        {item.changePct != null && (
          <span className={`text-xs font-medium mt-0.5 ${item.changePct >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
            {item.changePct >= 0 ? '+' : ''}{item.changePct.toFixed(2)}%
          </span>
        )}
        <span className="ml-auto"><StatusBadges item={item} /></span>
      </div>
      <PriceChartCore rows={rows} height={130} mini visibleBars={60} />
    </button>
  );
}

/** 상단 요약 — 조건 충족 ETF를 이름 칩으로 즉시 보여준다 */
function SummaryRow({ label, cls, items, onSelect }: {
  label: string;
  cls: string;
  items: BoardItem[];
  onSelect: (ticker: string) => void;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className={`shrink-0 text-xs font-bold rounded px-2 py-1 ${cls}`}>
        {label} {items.length}종
      </span>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {items.length === 0 && <span className="text-xs text-gray-400 pt-0.5">없음</span>}
        {items.map((i) => (
          <button
            key={i.ticker}
            onClick={() => onSelect(i.ticker)}
            className="text-xs bg-surface border border-gray-200 rounded px-2 py-0.5 text-gray-800 hover:border-blue-300"
          >
            {i.name}
            {i.state === 'entered' && <span className="ml-0.5">🚀</span>}
            {i.changePct != null && (
              <span className={`ml-1 ${i.changePct >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                {i.changePct >= 0 ? '+' : ''}{i.changePct.toFixed(1)}%
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 국면(수만)만 보여주는 요약 줄 — 걸침/이탈처럼 개별 나열이 무의미한 항목용 */
function SummaryCount({ label, cls, count }: { label: string; cls: string; count: number }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`shrink-0 text-xs font-bold rounded px-2 py-1 ${cls}`}>
        {label} {count}종
      </span>
    </div>
  );
}

/** 대표 ETF 차트보드 — 업종·테마별 미니 캔들차트(이평선 5종) + 국면(정배열/신규진입/걸침/이탈)·신고가 강조 */
export function EtfBoard({ onSelect }: { onSelect: (ticker: string) => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [configOpen, setConfigOpen] = useState(false);

  const { data, isLoading } = useQuery<BoardResponse>({
    queryKey: ['etf', 'board'],
    queryFn: () => apiClient.get(API.etf.board).then((r) => r.data),
    refetchInterval: () => (isKstMarketOpen() ? 60_000 : false), // 장중 오늘 봉 실시간 (서버 fetchTodayBar 주입)
    staleTime: 50 * 1000,
  });

  const items = data?.items ?? [];

  const summary = useMemo(() => ({
    entered: items.filter((i) => i.state === 'entered'),
    // 정배열 칩은 신규진입(정배열 진입 5일 이내)도 포함 — entered는 aligned의 부분집합
    aligned: items.filter((i) => i.state === 'aligned' || i.state === 'entered'),
    // 60일선 위는 국면과 독립 — 정배열 이전 단계나 눌림 구간까지 포함하는 중기 추세 생존 종목
    above60: items.filter((i) => i.flags.above60 === true),
    neutral: items.filter((i) => i.state === 'neutral'),
    exited: items.filter((i) => i.state === 'exited'),
    recentExit: items.filter((i) => i.recentExit),
    newHigh: items.filter((i) => i.flags.newHigh),
  }), [items]);

  const filterCount = (f: Exclude<Filter, 'all'>): number => summary[f].length;

  const visible = useMemo(
    () => items.filter((i) => matches(i, filter)).sort((a, b) => rank(a) - rank(b)),
    [items, filter],
  );
  const groups = [...new Set(visible.map((i) => i.group))];

  if (isLoading) return <p className="text-sm text-gray-400">차트보드 불러오는 중… (첫 로딩은 몇 초 걸립니다)</p>;

  return (
    <div className="space-y-5">
      {configOpen && <BoardConfigPanel onClose={() => setConfigOpen(false)} />}

      {/* 보드 헤더 — 커스텀 구성 진입점 */}
      <div className="flex justify-end">
        <button
          onClick={() => setConfigOpen(true)}
          className="text-xs rounded-lg px-3 py-1.5 border bg-surface text-gray-600 border-gray-200 hover:bg-gray-50"
        >
          ⚙️ 구성
        </button>
      </div>

      {/* 국면 요약 — 어떤 ETF가 어떤 국면인지 즉시 확인 */}
      <div className="bg-surface rounded-xl border border-gray-200 p-4 space-y-2.5">
        <SummaryRow label="🚀 신규진입" cls="text-white bg-red-500" items={summary.entered} onSelect={onSelect} />
        <SummaryRow label="📈 정배열" cls="text-white bg-amber-500" items={summary.aligned} onSelect={onSelect} />
        <SummaryRow label="🟢 60일선 위" cls="text-white bg-emerald-600" items={summary.above60} onSelect={onSelect} />
        <SummaryCount label="⚖️ 걸침" cls="text-gray-600 bg-gray-200" count={summary.neutral.length} />
        <SummaryCount label="📉 이탈" cls="text-blue-700 bg-blue-100" count={summary.exited.length} />
        <SummaryRow label="⚠️ 최근 이탈" cls="text-white bg-blue-500" items={summary.recentExit} onSelect={onSelect} />
        <SummaryRow label="🏆 신고가 돌파" cls="text-white bg-red-600" items={summary.newHigh} onSelect={onSelect} />
      </div>

      {/* 최근 국면 전환 타임라인 */}
      <EtfPhaseTransitionsFeed />

      {/* 필터 */}
      <div className="flex gap-1.5 flex-wrap">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs rounded-full px-3 py-1.5 border font-medium ${
              filter === f ? 'bg-[#111827] text-white border-[#111827]' : 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {FILTER_LABELS[f]}
            {f !== 'all' && (
              <span className="ml-1 text-[10px] opacity-70">{filterCount(f)}</span>
            )}
          </button>
        ))}
      </div>

      {visible.length === 0 && (
        <p className="text-sm text-gray-400 bg-surface rounded-xl border border-gray-200 p-6">
          조건을 충족하는 ETF가 없습니다.
        </p>
      )}

      {groups.map((group) => (
        <div key={group}>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            {group}
            <span className="ml-2 text-xs font-normal text-gray-400">
              {visible.filter((i) => i.group === group).length}종
            </span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visible
              .filter((i) => i.group === group)
              .map((item) => (
                <BoardCard key={item.ticker} item={item} onSelect={onSelect} />
              ))}
          </div>
        </div>
      ))}

      <p className="text-xs text-gray-400">
        국면: <span className="text-red-500 font-medium">🚀 신규진입</span> = 정배열 전환 5일 이내 ·{' '}
        <span className="text-amber-500 font-medium">정배열</span> = 5일 초과 지속 (요약·필터의 "정배열"은
        신규진입 포함) ·{' '}
        <span className="text-gray-500 font-medium">걸침</span> = 20일선 위·부근이나 정렬 미완 ·{' '}
        <span className="text-blue-500 font-medium">이탈</span> = 20일선 1.5% 초과 하회 (<span className="text-blue-600 font-medium">⚠️ 최근 이탈</span> =
        5거래일 전엔 정배열이었다가 급전환한 이탈, 특히 주목).{' '}
        <span className="text-emerald-600 font-medium">🟢 60일선 위</span> = 종가가 60일선 위 — 국면과 무관한
        중기 추세 기준이라 정배열보다 넓게 잡히고, 눌림·정배열 직전 구간도 포함한다 (카드의{' '}
        <span className="text-emerald-700 font-medium">60↑</span> 배지는 정배열이 아니면서 60일선은 지킨 종목).
        미니차트는 최근 60거래일 캔들 + 이평선 5·10·20·60·120 (60일선은 굵게 강조).
        신고가 = 종가가 직전 최대 252거래일 고가 이상 (신규상장 60봉 미만은
        판정 제외). 그룹 내 정렬: 신고가 → 신규진입 → 정배열 → 걸침 → 이탈 순.
      </p>
    </div>
  );
}
