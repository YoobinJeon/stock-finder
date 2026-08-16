import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { fmtPct, fmtCapEok, fmtFlowEok } from './etfFormat';
import { isKstMarketOpen } from '../shared/lib/isKstMarketOpen';
import { clickableRowProps, CLICKABLE_ROW_CLASS } from '../shared/lib/clickableRow';

interface FlowItem {
  ticker: string;
  name: string;
  tab: number;
  marketCap: number | null;
  flowEst: number;
  periodReturnPct: number;
  rsPercentile: number;
}

interface FlowsResponse {
  days: number;
  asOf: string | null;
  snapDays: number;
  inflow: FlowItem[];
  outflow: FlowItem[];
  rs: FlowItem[];
}

interface EtfFlowsViewProps {
  tabs: Record<number, string>;
  onSelect: (ticker: string) => void;
}

const DAY_OPTIONS = [1, 5, 20] as const;
const MIN_SNAP_DAYS = 2;

function FlowPctCell({ v }: { v: number }) {
  const cls = v === 0 ? 'text-gray-400' : v > 0 ? 'text-red-600' : 'text-blue-600';
  return <span className={cls}>{fmtFlowEok(v)}</span>;
}

function FlowTable({
  title,
  items,
  tabs,
  onSelect,
  showRs,
}: {
  title: string;
  items: FlowItem[];
  tabs: Record<number, string>;
  onSelect: (ticker: string) => void;
  showRs?: boolean;
}) {
  return (
    <div className="bg-surface rounded-xl border border-gray-200 overflow-hidden">
      <h3 className="text-sm font-semibold text-gray-800 px-4 py-3 border-b border-gray-100">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs text-gray-500">
              <th className="px-4 py-2 font-medium">종목</th>
              <th className="px-3 py-2 font-medium">분류</th>
              <th className="px-3 py-2 font-medium text-right">자금유입</th>
              <th className="px-3 py-2 font-medium text-right">기간수익률</th>
              <th className="px-3 py-2 font-medium text-right">시총</th>
              {showRs && <th className="px-3 py-2 font-medium text-right">RS</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr
                key={item.ticker}
                {...clickableRowProps(() => onSelect(item.ticker), `${item.name} 상세 열기`)}
                className={`border-t border-gray-100 hover:bg-gray-50 ${CLICKABLE_ROW_CLASS}`}
              >
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className="text-gray-400 mr-1.5">{i + 1}</span>
                  <span className="font-medium text-gray-900">{item.name}</span>
                  <span className="ml-1.5 text-xs text-gray-400">{item.ticker}</span>
                </td>
                <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{tabs[item.tab] ?? '-'}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap font-medium">
                  <FlowPctCell v={item.flowEst} />
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <span className={item.periodReturnPct > 0 ? 'text-red-600' : item.periodReturnPct < 0 ? 'text-blue-600' : 'text-gray-400'}>
                    {fmtPct(item.periodReturnPct)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">
                  {item.marketCap != null ? fmtCapEok(item.marketCap) : '—'}
                </td>
                {showRs && (
                  <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">{item.rsPercentile}</td>
                )}
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={showRs ? 6 : 5} className="px-4 py-3 text-sm text-gray-400">데이터 없음</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EtfFlowsView({ tabs, onSelect }: EtfFlowsViewProps) {
  const [days, setDays] = useState<(typeof DAY_OPTIONS)[number]>(5);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<FlowsResponse>({
    queryKey: ['etf-flows', days],
    queryFn: () => apiClient.get(API.etf.flows, { params: { days } }).then((r) => r.data),
    refetchInterval: () => (isKstMarketOpen() ? 60 * 1000 : false), // 장중에만 60초 폴링
    staleTime: 50 * 1000,
  });

  const snapshotNow = useMutation({
    mutationFn: () => apiClient.post(API.etf.snapshot),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['etf-flows'] }),
  });

  const snapDays = data?.snapDays ?? 0;
  const insufficient = snapDays < MIN_SNAP_DAYS;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex gap-1">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`text-xs rounded-lg px-3 py-1.5 border ${
                days === d ? 'bg-[#111827] text-white border-[#111827]' : 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {d}일
            </button>
          ))}
        </div>
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
          일별 스냅샷 축적 중 (현재 {snapDays}일) — 최소 2일부터 유입 추정, 20일 랭킹은 약 한 달 후 완성됩니다.
        </div>
      )}

      {!isLoading && !insufficient && data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <FlowTable title="🔺 자금유입 TOP20" items={data.inflow} tabs={tabs} onSelect={onSelect} />
          <FlowTable title="🔻 자금유출 TOP20" items={data.outflow} tabs={tabs} onSelect={onSelect} />
          <FlowTable title="⚡ RS 상위 20" items={data.rs} tabs={tabs} onSelect={onSelect} showRs />
        </div>
      )}
    </div>
  );
}
