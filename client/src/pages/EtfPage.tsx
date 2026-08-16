import { useMemo, useState } from 'react';
import { SkippableTable } from '../shared/components/SkippableTable';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { EtfDetailPanel } from '../shared/components/EtfDetailPanel';
import { LiveBadge } from '../shared/components/LiveBadge';
import { EtfBoard } from './EtfBoard';
import { EtfFlowsView } from './EtfFlowsView';
import { fmtPct, fmtAmountMn, fmtCapEok } from './etfFormat';
import { isKstMarketOpen } from '../shared/lib/isKstMarketOpen';
import { clickableRowProps, CLICKABLE_ROW_CLASS, SORT_BUTTON_CLASS } from '../shared/lib/clickableRow';

interface EtfItem {
  ticker: string;
  name: string;
  tab: number;
  price: number;
  changePct: number;
  nav: number | null;
  deviationPct: number | null;
  threeMonthReturn: number | null;
  volume: number;
  amount: number;     // 백만원
  marketCap: number;  // 억원
}

interface EtfResponse {
  asOf: string;
  intraday: boolean;
  tabs: Record<number, string>;
  count: number;
  items: EtfItem[];
}

type SortKey = 'changePct' | 'amount' | 'marketCap' | 'deviationPct' | 'threeMonthReturn';

const SORT_LABELS: Record<SortKey, string> = {
  changePct: '등락률',
  amount: '거래대금',
  marketCap: '시총',
  deviationPct: 'NAV 괴리',
  threeMonthReturn: '3개월',
};

const LEV_INV_RE = /레버리지|인버스|2X|-2X|곱버스/i;

function PctCell({ v }: { v: number | null }) {
  const cls = v == null || v === 0 ? 'text-gray-400' : v > 0 ? 'text-red-600' : 'text-blue-600';
  return <span className={cls}>{fmtPct(v)}</span>;
}

function TopCard({ title, items, accent }: { title: string; items: EtfItem[]; accent: 'red' | 'blue' }) {
  return (
    <div className="bg-surface rounded-xl border border-gray-200 p-4">
      <h3 className={`text-sm font-semibold mb-2 ${accent === 'red' ? 'text-red-600' : 'text-blue-600'}`}>{title}</h3>
      <ul className="space-y-1.5">
        {items.map((e, i) => (
          <li key={e.ticker} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate text-gray-800">
              <span className="text-gray-400 mr-1.5">{i + 1}</span>{e.name}
            </span>
            <PctCell v={e.changePct} />
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-gray-400">데이터 없음</li>}
      </ul>
    </div>
  );
}

export function EtfPage() {
  const [view, setView] = useState<'list' | 'board' | 'flows'>('list');
  const [detail, setDetail] = useState<string | null>(null); // 상세 모달 대상 티커
  const [tab, setTab] = useState<number | null>(null);
  const [excludeLevInv, setExcludeLevInv] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const [desc, setDesc] = useState(true);

  const { data, isLoading, isError } = useQuery<EtfResponse>({
    queryKey: ['etf', tab],
    queryFn: () =>
      apiClient.get(API.etf.list, { params: tab != null ? { tab } : {} }).then((r) => r.data),
    refetchInterval: () => (isKstMarketOpen() ? 60 * 1000 : false), // 장중에만 60초 폴링
    staleTime: 50 * 1000,
  });

  const filtered = useMemo(() => {
    const base = data?.items ?? [];
    return excludeLevInv ? base.filter((e) => !LEV_INV_RE.test(e.name)) : base;
  }, [data, excludeLevInv]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return desc ? Number(bv) - Number(av) : Number(av) - Number(bv);
    });
    return arr;
  }, [filtered, sortKey, desc]);

  // 당일 상승/하락 TOP5 — 탭·레버리지 필터 반영, 거래대금 1억 미만 잡음 제외
  const active = useMemo(() => filtered.filter((e) => e.amount >= 100), [filtered]);
  const topUp = useMemo(
    () => [...active].sort((a, b) => b.changePct - a.changePct).slice(0, 5),
    [active],
  );
  const topDown = useMemo(
    () => [...active].sort((a, b) => a.changePct - b.changePct).slice(0, 5),
    [active],
  );

  const onSort = (key: SortKey) => {
    if (key === sortKey) setDesc((d) => !d);
    else { setSortKey(key); setDesc(true); }
  };

  const tabs = data?.tabs ?? {};

  return (
    <div className="p-6 max-w-6xl">
      {detail && <EtfDetailPanel ticker={detail} onClose={() => setDetail(null)} />}

      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <h2 className="text-xl font-bold text-gray-900">📦 ETF</h2>
        {data?.intraday && <LiveBadge asOf={data.asOf} />}
        <div className="ml-auto flex gap-1">
          {([['list', '시세 목록'], ['board', '차트보드'], ['flows', '자금유입']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`text-xs rounded-lg px-3 py-1.5 border ${
                view === v ? 'bg-[#111827] text-white border-[#111827]' : 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        {view === 'list' && '전체 상장 ETF 실시간 시세 (네이버, 60초 갱신). NAV 괴리율 = (현재가−NAV)/NAV. 종목을 누르면 차트·편입종목 상세.'}
        {view === 'board' && '업종·테마별 대표 ETF 미니차트 — 이평선 5종과 정배열/20일선 상태를 한눈에.'}
        {view === 'flows' && '일별 스냅샷 기반 자금유입 추정·RS(상대강도) 순위. 오늘부터 데이터가 쌓입니다.'}
      </p>

      {view === 'board' && <EtfBoard onSelect={setDetail} />}
      {view === 'flows' && <EtfFlowsView tabs={tabs} onSelect={setDetail} />}

      {view === 'list' && (
      <>{/* 시세 목록 뷰 */}

      {/* 카테고리 탭 */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => setTab(null)}
          className={`text-sm rounded-full px-3 py-1 border ${tab == null ? 'bg-[#111827] text-white border-[#111827]' : 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-50'}`}
        >
          전체
        </button>
        {Object.entries(tabs).map(([code, label]) => (
          <button
            key={code}
            onClick={() => setTab(Number(code))}
            className={`text-sm rounded-full px-3 py-1 border ${tab === Number(code) ? 'bg-[#111827] text-white border-[#111827]' : 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            {label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={excludeLevInv}
            onChange={(e) => setExcludeLevInv(e.target.checked)}
            className="rounded"
          />
          레버리지·인버스 제외
        </label>
      </div>

      {/* 당일 상승/하락 TOP5 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <TopCard title="🔺 오늘 상승 TOP5" items={topUp} accent="red" />
        <TopCard title="🔻 오늘 하락 TOP5" items={topDown} accent="blue" />
      </div>

      {isLoading && <p className="text-sm text-gray-400">불러오는 중…</p>}
      {isError && <p className="text-sm text-red-500">데이터를 불러오지 못했습니다.</p>}

      <div className="bg-surface rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <SkippableTable label="ETF 목록">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500">
                  <th className="px-4 py-3 font-medium">종목</th>
                  <th className="px-3 py-3 font-medium text-right">현재가</th>
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                    <th
                      key={key}
                      className="px-3 py-3 font-medium text-right"
                      aria-sort={sortKey === key ? (desc ? 'descending' : 'ascending') : 'none'}
                    >
                      <button
                        type="button"
                        onClick={() => onSort(key)}
                        title="클릭하여 정렬"
                        className={`${SORT_BUTTON_CLASS} text-right hover:text-gray-800`}
                      >
                        {SORT_LABELS[key]}{sortKey === key ? (desc ? ' ↓' : ' ↑') : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 200).map((e) => (
                  <tr
                    key={e.ticker}
                    {...clickableRowProps(() => setDetail(e.ticker), `${e.name} 상세 열기`)}
                    className={`border-t border-gray-100 hover:bg-gray-50 ${CLICKABLE_ROW_CLASS}`}
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="font-medium text-gray-900">{e.name}</span>
                      <span className="ml-1.5 text-xs text-gray-400">{e.ticker}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-900 whitespace-nowrap">
                      {e.price.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap font-medium"><PctCell v={e.changePct} /></td>
                    <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">{fmtAmountMn(e.amount)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">{fmtCapEok(e.marketCap)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap"><PctCell v={e.deviationPct} /></td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap"><PctCell v={e.threeMonthReturn} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SkippableTable>
        </div>
        {sorted.length > 200 && (
          <p className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
            상위 200개 표시 중 (전체 {sorted.length}개) — 카테고리 탭이나 정렬로 좁혀보세요.
          </p>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        레버리지·인버스 제외는 종목명 기준이라 완전하지 않을 수 있습니다. 거래대금 단위: 당일 누적.
      </p>
      </>
      )}
    </div>
  );
}
