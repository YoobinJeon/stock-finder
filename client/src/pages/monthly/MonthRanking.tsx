import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client';
import { API } from '../../shared/api/endpoints';
import { clickableRowProps, CLICKABLE_ROW_CLASS } from '../../shared/lib/clickableRow';
import {
  AXIS_LABEL, fmtEok, fmtPct, pctColorClass,
  type MonthlyGroupsResponse, type MonthlyStocksResponse, type StockRow,
} from './monthlyTypes';

/** 묶음은 스무 개면 한 화면에 들어오고, 종목은 그보다 길게 봐야 흐름이 잡힌다. */
const GROUP_TOP_N = 20;

interface MonthRankingProps {
  groups: MonthlyGroupsResponse;
  month: string;
  stockLimit: number;
  onSelectStock: (row: { ticker: string; name: string; market: string | null }) => void;
}

/** 한 달을 골라 그 달의 묶음(테마·산업)·종목 상승률 상위를 나란히 본다. */
export function MonthRanking({ groups, month, stockLimit, onSelectStock }: MonthRankingProps) {
  const axisLabel = AXIS_LABEL[groups.axis];
  const topGroups = useMemo(
    () => groups.rows
      .filter((g) => g.cells[month] != null)
      .sort((a, b) => b.cells[month].median - a.cells[month].median)
      .slice(0, GROUP_TOP_N),
    [groups, month],
  );

  const { data, isLoading, isError } = useQuery<MonthlyStocksResponse>({
    queryKey: ['market', 'monthly', 'stocks', month, stockLimit],
    queryFn: () => apiClient
      .get(API.market.monthlyStocks, { params: { month, limit: stockLimit } })
      .then((r) => r.data),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <section className="bg-surface rounded-xl border border-gray-200 overflow-hidden">
        <h2 className="px-4 py-3 text-sm font-medium text-gray-900 border-b border-gray-100">
          {axisLabel} 상위 {GROUP_TOP_N}
          <span className="ml-2 text-xs font-normal text-gray-400">멤버 수익률 중앙값 기준</span>
        </h2>
        <table className="w-full text-sm">
          <tbody>
            {topGroups.map((group, i) => {
              const cell = group.cells[month];
              return (
                <tr key={group.key} className="border-t border-gray-100">
                  <td className="pl-4 py-2 text-xs text-gray-300 w-8">{i + 1}</td>
                  <td className="py-2 text-gray-900">{group.name}</td>
                  <td className="py-2 pr-2 text-right text-xs text-gray-400 whitespace-nowrap">
                    {cell.count}종목 · 상승 {Math.round(cell.upRatio * 100)}%
                  </td>
                  <td className={`pr-4 py-2 text-right font-medium whitespace-nowrap ${pctColorClass(cell.median)}`}>
                    {fmtPct(cell.median)}
                  </td>
                </tr>
              );
            })}
            {topGroups.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-gray-400">
                  이 달은 표시할 {axisLabel}이(가) 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="bg-surface rounded-xl border border-gray-200 overflow-hidden">
        <h2 className="px-4 py-3 text-sm font-medium text-gray-900 border-b border-gray-100">
          종목 상위 {stockLimit}
          <span className="ml-2 text-xs font-normal text-gray-400">
            시총·품질 필터 없음{data ? ` · ${data.total.toLocaleString()}종목 중` : ''}
          </span>
        </h2>
        {isLoading && <p className="px-4 py-6 text-sm text-gray-400">불러오는 중…</p>}
        {isError && <p className="px-4 py-6 text-sm text-red-500">종목 랭킹을 불러오지 못했습니다.</p>}
        {data && (
          <table className="w-full text-sm">
            <tbody>
              {data.items.map((row, i) => (
                <StockRowView key={row.ticker} row={row} rank={i + 1} onSelect={onSelectStock} />
              ))}
              {data.items.length === 0 && (
                <tr><td className="px-4 py-6 text-sm text-gray-400">이 달은 표시할 종목이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function StockRowView({ row, rank, onSelect }: {
  row: StockRow;
  rank: number;
  onSelect: (r: { ticker: string; name: string; market: string | null }) => void;
}) {
  return (
    <tr
      {...clickableRowProps(() => onSelect(row), `${row.name} 상세 열기`)}
      className={`border-t border-gray-100 hover:bg-gray-50 ${CLICKABLE_ROW_CLASS}`}
    >
      <td className="pl-4 py-2 text-xs text-gray-300 w-8">{rank}</td>
      <td className="py-2 text-gray-900 whitespace-nowrap">{row.name}</td>
      <td className="py-2 pr-2 text-right text-xs text-gray-400 whitespace-nowrap">
        {fmtEok(row.marketCap)}
      </td>
      <td className="py-2 pr-2 text-xs text-gray-400 whitespace-nowrap max-w-[9rem] truncate">
        {row.sector ?? ''}
      </td>
      <td className={`pr-4 py-2 text-right font-medium whitespace-nowrap ${pctColorClass(row.changePct)}`}>
        {fmtPct(row.changePct)}
      </td>
    </tr>
  );
}
