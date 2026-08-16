import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { CompareTable, METRIC_SECTIONS } from './compare/CompareTable';
import { useHiddenMetrics } from './compare/useHiddenMetrics';
import type { CompareRow } from './compare/compareFormat';

interface StockListItem {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
}

const MAX_SELECTED = 4;
const MAX_SUGGESTIONS = 8;

/** URL(`?t=005930,000660`)의 tickers를 정규화된 배열로 파싱 — 최대 4개, 중복 제거. */
function parseTickersFromUrl(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const tickers: string[] = [];
  for (const t of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!seen.has(t)) { seen.add(t); tickers.push(t); }
    if (tickers.length >= MAX_SELECTED) break;
  }
  return tickers;
}

/** 종목 비교 — 2~3개 종목의 점수·재무·수급 지표를 나란히 비교. URL(`?t=`)이 선택 상태. */
export function ComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { hidden: hiddenMetrics, toggle: toggleMetric, reset: resetMetrics } = useHiddenMetrics();

  const selected = parseTickersFromUrl(searchParams.get('t'));

  const setSelected = (tickers: string[]) => {
    const next = new URLSearchParams(searchParams);
    if (tickers.length > 0) next.set('t', tickers.join(',')); else next.delete('t');
    setSearchParams(next, { replace: true });
  };

  const { data: stocks = [] } = useQuery<StockListItem[]>({
    queryKey: ['stocks', 'list'],
    queryFn: () => apiClient.get(API.stocks.list).then((r) => r.data),
    staleTime: 10 * 60 * 1000,
  });

  const stockByTicker = useMemo(
    () => new Map(stocks.map((s) => [s.ticker, s])),
    [stocks],
  );

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return stocks
      .filter((s) => !selected.includes(s.ticker))
      .filter((s) => s.name.toLowerCase().includes(q) || s.ticker.includes(q))
      .slice(0, MAX_SUGGESTIONS);
  }, [stocks, query, selected]);

  const addTicker = (ticker: string) => {
    if (selected.includes(ticker) || selected.length >= MAX_SELECTED) return;
    setSelected([...selected, ticker]);
    setQuery('');
  };

  const removeTicker = (ticker: string) => {
    setSelected(selected.filter((t) => t !== ticker));
  };

  const compareQuery = useQuery<CompareRow[]>({
    queryKey: ['stocks', 'compare', selected],
    queryFn: () => apiClient.get(`${API.stocks.compare}?tickers=${selected.join(',')}`).then((r) => r.data),
    enabled: selected.length >= 2,
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">종목 비교</h2>
        <button
          type="button"
          onClick={() => setIsSettingsOpen((v) => !v)}
          className="text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 bg-surface"
        >
          ⚙️ 지표 설정{isSettingsOpen ? ' ▲' : ' ▼'}
        </button>
      </div>

      {/* 지표 설정 패널 — 섹션별 체크박스로 표시할 지표 선택, localStorage(sf_compare_metrics)에 저장 */}
      {isSettingsOpen && (
        <div className="bg-surface rounded-xl border border-gray-200 p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-500">체크 해제한 지표는 비교 테이블에서 숨깁니다.</p>
            <button
              type="button"
              onClick={resetMetrics}
              disabled={hiddenMetrics.size === 0}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:text-gray-300"
            >
              전체 표시
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {METRIC_SECTIONS.map((section) => (
              <div key={section.key}>
                <p className="text-xs font-semibold text-gray-600 mb-1.5">{section.label}</p>
                <div className="flex flex-col gap-1">
                  {section.metrics.map((def) => (
                    <label key={def.label} className="flex items-center gap-1.5 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={!hiddenMetrics.has(def.label)}
                        onChange={() => toggleMetric(def.label)}
                        className="rounded border-gray-300"
                      />
                      {def.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 종목 선택 */}
      <div className="bg-surface rounded-xl border border-gray-200 p-4 mb-5">
        <label className="block text-xs text-gray-500 mb-1">
          비교할 종목 (최대 {MAX_SELECTED}개)
        </label>
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={selected.length >= MAX_SELECTED ? `최대 ${MAX_SELECTED}개까지 선택 가능합니다` : '종목명 또는 코드 검색'}
            disabled={selected.length >= MAX_SELECTED}
            className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          {suggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full max-w-sm bg-surface border border-gray-200 rounded-lg shadow-lg overflow-hidden">
              {suggestions.map((s) => (
                <li key={s.ticker}>
                  <button
                    type="button"
                    onClick={() => addTicker(s.ticker)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between gap-2"
                  >
                    <span className="text-gray-900">{s.name}</span>
                    <span className="text-xs text-gray-400">{s.ticker} · {s.market}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {selected.map((ticker) => {
              const stock = stockByTicker.get(ticker);
              return (
                <span
                  key={ticker}
                  className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-100 text-blue-700 rounded-full pl-3 pr-2 py-1 text-sm"
                >
                  {stock?.name ?? ticker}
                  <button
                    type="button"
                    onClick={() => removeTicker(ticker)}
                    aria-label={`${stock?.name ?? ticker} 제거`}
                    className="text-blue-400 hover:text-blue-700 leading-none"
                  >
                    ✕
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* 비교 결과 */}
      {selected.length < 2 ? (
        <p className="text-sm text-gray-400 bg-surface rounded-xl border border-gray-200 p-6">
          비교할 종목을 2~{MAX_SELECTED}개 선택하세요.
        </p>
      ) : compareQuery.isLoading ? (
        <p className="text-sm text-gray-400 bg-surface rounded-xl border border-gray-200 p-6">
          불러오는 중…
        </p>
      ) : compareQuery.isError ? (
        <p className="text-sm text-red-500 bg-surface rounded-xl border border-gray-200 p-6">
          비교 데이터를 불러오지 못했습니다.
        </p>
      ) : (compareQuery.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-gray-400 bg-surface rounded-xl border border-gray-200 p-6">
          선택한 종목의 데이터를 찾을 수 없습니다.
        </p>
      ) : (
        <CompareTable rows={compareQuery.data!} hiddenMetrics={hiddenMetrics} />
      )}
    </div>
  );
}
