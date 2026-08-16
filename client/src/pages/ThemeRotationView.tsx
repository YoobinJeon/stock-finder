import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { isKstMarketOpen } from '../shared/lib/isKstMarketOpen';
import { clickableRowProps, CLICKABLE_ROW_CLASS } from '../shared/lib/clickableRow';
import { SortableTh, useClientSort } from '../shared/components/SortableTh';
import type { SortOrder } from '../shared/lib/clientSort';

interface RotationItem {
  themeNo: number;
  name: string;
  recentAvg: number;
  prevAvg: number;
  momentum: number;
  upStreak: number;
  cumReturnPct: number;
  lastChgPct: number | null;
  lastUpCnt: number | null;
  lastTotalCnt: number | null;
}

interface RotationResponse {
  asOf: string | null;
  snapDays: number;
  heating: RotationItem[];
  cooling: RotationItem[];
  streaks: RotationItem[];
}

const MIN_SNAP_DAYS = 2;
const APPROX_CAPTION_MAX_DAYS = 3;

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function fmtPP(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%p`;
}

/**
 * 정렬 기준 — 렌더 밖 상수(`useClientSort`가 accessors 동일성으로 재정렬 시점을 판단한다).
 * '최근3일/이전5일'은 두 값을 함께 보여주므로 앞의 최근3일을 기준으로 삼는다.
 */
const ROTATION_SORT_ACCESSORS = {
  name: (r: RotationItem) => r.name,
  momentum: (r: RotationItem) => r.momentum,
  recentAvg: (r: RotationItem) => r.recentAvg,
  upStreak: (r: RotationItem) => r.upStreak,
  lastChgPct: (r: RotationItem) => r.lastChgPct,
};

function MomentumCell({ v }: { v: number }) {
  const cls = v === 0 ? 'text-gray-400' : v > 0 ? 'text-red-600' : 'text-blue-600';
  return <span className={cls}>{fmtPP(v)}</span>;
}

function RotationTable({
  title,
  items,
  onSelect,
  defaultSort,
}: {
  title: string;
  items: RotationItem[];
  onSelect: (no: number) => void;
  /** 서버가 보내준 순서와 같은 기준 — 첫 화면이 정렬 때문에 뒤바뀌지 않게 한다. */
  defaultSort: { key: string; order: SortOrder };
}) {
  const { sorted, sort, onSort } = useClientSort<RotationItem>(
    items,
    ROTATION_SORT_ACCESSORS,
    defaultSort.key,
    defaultSort.order,
  );

  return (
    <div className="bg-surface rounded-xl border border-gray-200 overflow-hidden">
      <h3 className="text-sm font-semibold text-gray-800 px-4 py-3 border-b border-gray-100">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs text-gray-500">
              <SortableTh label="테마" col="name" sort={sort} onSort={onSort} align="left" pad="px-4 py-2" />
              <SortableTh label="모멘텀" col="momentum" sort={sort} onSort={onSort} pad="px-3 py-2" />
              <SortableTh label="최근3일/이전5일" col="recentAvg" sort={sort} onSort={onSort} pad="px-3 py-2" title="클릭하여 정렬 (최근3일 기준)" />
              <SortableTh label="연속상승" col="upStreak" sort={sort} onSort={onSort} pad="px-3 py-2" />
              <SortableTh label="오늘 등락·상승/전체" col="lastChgPct" sort={sort} onSort={onSort} pad="px-3 py-2" title="클릭하여 정렬 (오늘 등락률 기준)" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((item, i) => (
              <tr
                key={item.themeNo}
                {...clickableRowProps(() => onSelect(item.themeNo), `${item.name} 테마 상세 열기`)}
                className={`border-t border-gray-100 hover:bg-gray-50 ${CLICKABLE_ROW_CLASS}`}
              >
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className="text-gray-400 mr-1.5">{i + 1}</span>
                  <span className="font-medium text-gray-900">{item.name}</span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap font-medium">
                  <MomentumCell v={item.momentum} />
                </td>
                <td className="px-3 py-2 text-right text-gray-500 whitespace-nowrap">
                  {fmtPct(item.recentAvg)} / {fmtPct(item.prevAvg)}
                </td>
                <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">
                  {item.upStreak > 0 ? `${item.upStreak}일` : '—'}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <span className={item.lastChgPct != null && item.lastChgPct >= 0 ? 'text-red-500' : 'text-blue-500'}>
                    {fmtPct(item.lastChgPct)}
                  </span>
                  <span className="ml-1.5 text-xs text-gray-400">
                    {item.lastUpCnt ?? '—'}/{item.lastTotalCnt ?? '—'}
                  </span>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-sm text-gray-400">데이터 없음</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ThemeRotationViewProps {
  onSelect: (no: number) => void;
}

export function ThemeRotationView({ onSelect }: ThemeRotationViewProps) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<RotationResponse>({
    queryKey: ['themes-rotation'],
    queryFn: () => apiClient.get(API.themes.rotation).then((r) => r.data),
    refetchInterval: () => (isKstMarketOpen() ? 60 * 1000 : false), // 장중에만 60초 폴링
    staleTime: 50 * 1000,
  });

  const snapshotNow = useMutation({
    mutationFn: () => apiClient.post(API.themes.snapshot),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['themes-rotation'] }),
  });

  const snapDays = data?.snapDays ?? 0;
  const insufficient = snapDays < MIN_SNAP_DAYS;
  const isApprox = !insufficient && snapDays <= APPROX_CAPTION_MAX_DAYS;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {data?.asOf && (
          <span className="text-xs text-gray-400">기준일 {data.asOf} · 스냅샷 {snapDays}일 보유</span>
        )}
        <button
          onClick={() => snapshotNow.mutate()}
          disabled={snapshotNow.isPending}
          className="ml-auto text-xs rounded-lg border border-gray-200 bg-surface px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {snapshotNow.isPending ? '저장 중…' : '지금 스냅샷 저장'}
        </button>
      </div>

      {isLoading && <p className="text-sm text-gray-400">불러오는 중…</p>}

      {!isLoading && insufficient && (
        <div className="bg-surface rounded-xl border border-gray-200 p-6 text-sm text-gray-500">
          일별 스냅샷 축적 중 (현재 {snapDays}일) — 최소 2일부터 로테이션(모멘텀) 근사치, 8일부터 정식
          최근3일/이전5일 모멘텀이 완성됩니다.
        </div>
      )}

      {!isLoading && !insufficient && (
        <>
          {isApprox && (
            <p className="text-xs text-gray-400 mb-3">
              스냅샷 {snapDays}일 축적 — 로테이션(모멘텀)은 8일 누적 전까지 근사치입니다.
            </p>
          )}
          {data && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* 기본 정렬은 각 표를 정의하는 기준 그대로 — 식는 테마만 모멘텀 오름차순(가장 많이 식은 순) */}
              <RotationTable title="🔥 달아오르는 테마" items={data.heating} onSelect={onSelect} defaultSort={{ key: 'momentum', order: 'desc' }} />
              <RotationTable title="❄️ 식는 테마" items={data.cooling} onSelect={onSelect} defaultSort={{ key: 'momentum', order: 'asc' }} />
              <RotationTable title="📈 연속 상승" items={data.streaks} onSelect={onSelect} defaultSort={{ key: 'upStreak', order: 'desc' }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
