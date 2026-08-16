import { useMemo, useState } from 'react';
import { SkippableTable } from '../shared/components/SkippableTable';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { StockDetailPanel } from '../shared/components/StockDetailPanel';
import { RsBar, rsCellTone, fmtRs } from '../shared/components/RsBar';
import { clickableRowProps, CLICKABLE_ROW_CLASS, SORT_BUTTON_CLASS } from '../shared/lib/clickableRow';

interface SectorRs {
  sector: string;
  medianRs: number;
  count: number;
  top: Array<{ ticker: string; name: string; rs: number }>;
}

interface StockRs {
  ticker: string;
  name: string;
  sector: string | null;
  marketCap: number | null;
  market: string;
  rs: { m1: number | null; m3: number | null; m6: number | null; m12: number | null; integrated: number | null };
  ret: { m1: number | null; m3: number | null; m6: number | null; m12: number | null };
}

interface RsResponse {
  asOf: string | null;
  count: number;
  excluded?: { frozen: number; seriesBreak: number };
  /** 데이터 이상으로 순위에서 제외된 종목 — 검색 시 "왜 안 나오는지" 안내용 */
  excludedStocks?: Array<{ ticker: string; name: string; reason: 'frozen' | 'series_break' }>;
  sectors: SectorRs[];
  stocks: StockRs[];
}

const EXCLUSION_LABEL: Record<'frozen' | 'series_break', string> = {
  frozen: '거래정지 의심(가격 동결)',
  series_break: '가격 불연속(감자·거래정지 재개 등)',
};

const PAGE_SIZE = 100;

// 시총 필터 (스탁이지 대조 후 추가 — 소형주 노이즈 걷어내고 기관급 주도주만 보기)
const CAP_FILTERS = [
  { label: '전체', min: 0 },
  { label: '2,000억+', min: 2_000_0000_0000 },
  { label: '5,000억+', min: 5_000_0000_0000 },
  { label: '1조+', min: 1_0000_0000_0000 },
] as const;

function fmtCap(v: number | null): string {
  if (v == null) return '–';
  if (v >= 1_0000_0000_0000) return `${(v / 1_0000_0000_0000).toFixed(1)}조`;
  return `${Math.round(v / 1_0000_0000).toLocaleString('ko-KR')}억`;
}
const STRONG_THRESHOLD = 80;
const WEAK_THRESHOLD = 50;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

type SortKey = 'integrated' | 'm1' | 'm3' | 'm6' | 'm12';

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'integrated', label: '통합 RS' },
  { key: 'm1', label: '1M' },
  { key: 'm3', label: '3M' },
  { key: 'm6', label: '6M' },
  { key: 'm12', label: '12M' },
];

/** null은 정렬 방향과 무관하게 항상 맨 아래로 보낸다 */
function compareRs(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (b - a) * dir;
}

export function RsPage() {
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);
  const [capMin, setCapMin] = useState<number>(0);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('integrated');
  const [sortDir, setSortDir] = useState<1 | -1>(1); // 1=내림차순(desc), -1=오름차순(asc) — compareRs 부호 규약과 맞춤
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<StockRs | null>(null);

  const { data, isLoading, isError } = useQuery<RsResponse>({
    queryKey: ['market', 'rs'],
    queryFn: () => apiClient.get(API.market.rs).then((r) => r.data),
    staleTime: 10 * 60 * 1000, // RS는 일봉 마감 기준 — 장중 폴링 불필요
  });

  const toggleSector = (sector: string) => {
    setSectorFilter((prev) => (prev === sector ? null : sector));
    setVisibleCount(PAGE_SIZE);
  };

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((prev) => (prev === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(1);
    }
    setVisibleCount(PAGE_SIZE);
  };

  const filteredSorted = useMemo(() => {
    const stocks = data?.stocks ?? [];
    const q = query.trim().toLowerCase();
    const filtered = stocks.filter((s) => {
      if (capMin > 0 && (s.marketCap == null || s.marketCap < capMin)) return false;
      if (sectorFilter != null && s.sector !== sectorFilter) return false;
      if (q === '') return true;
      return s.name.toLowerCase().includes(q) || s.ticker.includes(q);
    });
    return [...filtered].sort((a, b) => compareRs(a.rs[sortKey], b.rs[sortKey], sortDir));
  }, [data?.stocks, capMin, sectorFilter, query, sortKey, sortDir]);

  const visible = filteredSorted.slice(0, visibleCount);
  const empty = !isLoading && !isError && data != null && data.stocks.length === 0;

  // 검색어가 순위 제외 종목과 일치하면 "왜 안 나오는지" 안내 (예: 데이터 불연속 종목 검색 시)
  const matchedExcluded = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return [];
    return (data?.excludedStocks ?? []).filter(
      (s) => s.name.toLowerCase().includes(q) || s.ticker.includes(q),
    );
  }, [data?.excludedStocks, query]);

  // 요약 스트립 — 섹터 강세/중립/약세 개수 + 시장 통합 RS 중앙값 (클라이언트 계산)
  const summary = useMemo(() => {
    const sectors = data?.sectors ?? [];
    const stocks = data?.stocks ?? [];
    const strong = sectors.filter((s) => s.medianRs >= STRONG_THRESHOLD).length;
    const weak = sectors.filter((s) => s.medianRs < WEAK_THRESHOLD).length;
    const neutral = sectors.length - strong - weak;
    const integratedValues = stocks
      .map((s) => s.rs.integrated)
      .filter((v): v is number => v != null);
    return { strong, neutral, weak, marketMedian: median(integratedValues) };
  }, [data?.sectors, data?.stocks]);

  return (
    <div className="p-6 max-w-6xl">
      {selected && (
        <StockDetailPanel
          ticker={selected.ticker}
          name={selected.name}
          market={selected.market}
          sector={selected.sector}
          totalScore={null}
          onClose={() => setSelected(null)}
        />
      )}

      <div className="flex items-center gap-2 flex-wrap mb-1">
        <h2 className="text-xl font-bold text-gray-900">📶 RS 랭킹</h2>
        {data?.asOf && (
          <span className="text-xs text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
            기준일 {data.asOf}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-6">
        통합 RS = 기간별 RS <b>백분위</b>의 최근 가중평균 — 1M(40%)·3M(30%)·6M(20%)·12M(10%).
        1M이 낮으면 장기 구간이 아무리 높아도 통합이 함께 내려갑니다. 섹터를 클릭하면 아래 종목 테이블이 필터링됩니다.
      </p>

      {isLoading && <p className="text-sm text-gray-400">집계 중…</p>}
      {isError && <p className="text-sm text-red-500">RS 랭킹을 불러오지 못했습니다.</p>}
      {empty && (
        <p className="text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 mb-4">
          RS를 계산할 데이터가 없습니다. 데이터 수집을 먼저 실행하세요.
        </p>
      )}

      {/* 요약 스트립 */}
      {data && data.sectors.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
          <span className="px-2.5 py-1 rounded-full bg-red-50 border border-red-100 text-red-700 font-medium">
            강세 섹터 {summary.strong}개 (RS≥{STRONG_THRESHOLD})
          </span>
          <span className="px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 text-gray-600 font-medium">
            중립 {summary.neutral}개
          </span>
          <span className="px-2.5 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 font-medium">
            약세 {summary.weak}개 (RS&lt;{WEAK_THRESHOLD})
          </span>
          <span className="px-2.5 py-1 rounded-full bg-gray-100 border border-gray-200 text-gray-700">
            시장 통합 RS 중앙값 <b className="font-bold">{fmtRs(summary.marketMedian)}</b>
          </span>
        </div>
      )}

      {data && data.sectors.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">섹터 RS 보드</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {data.sectors.map((s, i) => {
              const active = sectorFilter === s.sector;
              const tone = rsCellTone(s.medianRs);
              return (
                <button
                  key={s.sector}
                  onClick={() => toggleSector(s.sector)}
                  className={`text-left border rounded-lg p-3 transition-colors ${tone.bg || 'bg-surface'} ${
                    active ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <span className="text-[11px] text-gray-400 font-medium mr-1">#{i + 1}</span>
                      <span className="font-medium text-gray-900 text-sm truncate">{s.sector}</span>
                    </div>
                    <span className={`shrink-0 text-2xl font-bold tabular-nums ${tone.text}`}>
                      {fmtRs(s.medianRs)}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 mb-1">{s.count}종목</p>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                    {s.top.map((t) => (
                      <span key={t.ticker} className="text-[11px] text-gray-500 truncate">
                        {t.name} <span className="text-gray-400 font-medium">{t.rs.toFixed(0)}</span>
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {data && data.stocks.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden bg-surface">
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-100 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-900">
              종목 테이블{sectorFilter && <span className="text-gray-400 font-normal"> · {sectorFilter} 필터 중</span>}
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-1">
                {CAP_FILTERS.map((f) => (
                  <button
                    key={f.label}
                    onClick={() => { setCapMin(f.min); setVisibleCount(PAGE_SIZE); }}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                      capMin === f.min
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-surface text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setVisibleCount(PAGE_SIZE); }}
                placeholder="종목명 또는 티커 검색"
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:border-blue-400"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <SkippableTable label="종목 표">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left font-medium px-3 py-1.5">종목명</th>
                    <th className="text-left font-medium px-3 py-1.5">섹터</th>
                    <th className="text-right font-medium px-3 py-1.5">시총</th>
                    {COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        className="text-right font-medium px-3 py-1.5"
                        aria-sort={sortKey === c.key ? (sortDir === 1 ? 'descending' : 'ascending') : 'none'}
                      >
                        <button
                          type="button"
                          onClick={() => handleSort(c.key)}
                          title="클릭하여 정렬"
                          className={`${SORT_BUTTON_CLASS} text-right hover:text-gray-600`}
                        >
                          {c.label}{sortKey === c.key && (sortDir === 1 ? ' ▼' : ' ▲')}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => (
                    <tr
                      key={s.ticker}
                      {...clickableRowProps(() => setSelected(s), `${s.name} 상세 열기`)}
                      className={`border-t border-gray-50 hover:bg-gray-50 ${CLICKABLE_ROW_CLASS}`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{s.name}</div>
                        <div className="text-[11px] text-gray-400">{s.ticker}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-500">{s.sector ?? '–'}</td>
                      <td className="px-3 py-2 text-right text-gray-500 tabular-nums">{fmtCap(s.marketCap)}</td>
                      <td className="px-3 py-2">
                        <RsBar rs={s.rs.integrated} />
                      </td>
                      {(['m1', 'm3', 'm6', 'm12'] as const).map((k) => {
                        const tone = rsCellTone(s.rs[k]);
                        return (
                          <td key={k} className={`px-3 py-2 text-right font-medium tabular-nums ${tone.bg} ${tone.text}`}>
                            {fmtRs(s.rs[k])}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </SkippableTable>
            {filteredSorted.length === 0 && matchedExcluded.length === 0 && (
              <p className="px-3 py-4 text-xs text-gray-400">조건에 맞는 종목이 없습니다.</p>
            )}
            {matchedExcluded.length > 0 && (
              <div className="px-3 py-3 text-xs text-amber-700 bg-amber-50 border-t border-amber-100">
                {matchedExcluded.map((s) => (
                  <p key={s.ticker}>
                    <b>{s.name}</b>({s.ticker})은 {EXCLUSION_LABEL[s.reason]}으로 순위에서 제외되어 있습니다.
                  </p>
                ))}
              </div>
            )}
          </div>
          {visibleCount < filteredSorted.length && (
            <div className="flex justify-center py-3 border-t border-gray-100">
              <button
                onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
                className="text-sm text-blue-600 hover:underline"
              >
                더 보기 ({visibleCount} / {filteredSorted.length})
              </button>
            </div>
          )}
        </div>
      )}

      {data?.excluded && (data.excluded.frozen > 0 || data.excluded.seriesBreak > 0) && (
        <p className="text-xs text-gray-400 mt-2">
          거래정지 의심 {data.excluded.frozen}종목·가격 불연속(감자·거래정지 재개 등) {data.excluded.seriesBreak}종목은 순위에서 제외됨
        </p>
      )}
    </div>
  );
}
