import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { StockDetailPanel } from '../shared/components/StockDetailPanel';
import { SectorMembers } from '../shared/components/SectorMembers';
import type { StockChip } from '../shared/components/StockChipList';
import { clickableRowProps, CLICKABLE_ROW_CLASS } from '../shared/lib/clickableRow';

/** 종목 상세 패널에 필요한 최소 정보 — 거래대금 표(StockRow)와 산업 구성종목(StockChip)이 함께 쓴다. */
interface PanelTarget {
  ticker: string; name: string; market: string; sector: string | null; totalScore: number | null;
}

interface MarketRow { market: string; series: number[]; changePct: number | null }
interface SectorRow { sector: string; series: number[]; changePct: number | null }
interface StockRow {
  ticker: string; name: string; market: string; sector: string | null; totalScore: number | null;
  series: number[]; changePct: number | null;
}
interface TurnoverResponse {
  weeks: string[];
  latestPartial: boolean;
  market: MarketRow[];
  sectors: SectorRow[];
  stocks: StockRow[];
}

/** 원(₩) 단위 거래대금 → 억/조 표기 (FlowsPage의 fmtEok와 동일 규칙) */
function fmtWon(won: number): string {
  const eok = won / 1e8;
  if (Math.abs(eok) >= 10000) return `${(eok / 10000).toFixed(1)}조`;
  return `${Math.round(eok).toLocaleString()}억`;
}

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function pctColor(v: number | null): string {
  if (v == null) return 'text-gray-400';
  return v >= 0 ? 'text-red-600' : 'text-blue-600';
}

/** 최신 "완성" 블록의 거래대금 — latestPartial이면 진행 중인 마지막 값은 제외한다 */
function latestCompleteAmt(series: number[], latestPartial: boolean): number | null {
  const idx = latestPartial ? series.length - 2 : series.length - 1;
  return idx >= 0 ? series[idx] : null;
}

/** 8주 미니 바 — div 높이로 표현하는 간단한 스파크바. 진행 중인 마지막 칸은 옅게 표시 */
function MiniBar({ series, latestPartial }: { series: number[]; latestPartial: boolean }) {
  const max = Math.max(...series, 1);
  return (
    <div className="flex items-end gap-0.5 h-6 w-20 shrink-0">
      {series.map((v, i) => {
        const isLatest = latestPartial && i === series.length - 1;
        const h = Math.max(2, Math.round((v / max) * 24));
        return (
          <div
            key={i}
            title={isLatest ? '진행 중인 주' : undefined}
            className={`flex-1 rounded-sm ${isLatest ? 'bg-gray-300' : 'bg-blue-400'}`}
            style={{ height: `${h}px` }}
          />
        );
      })}
    </div>
  );
}

function MarketCard({ row, weeks, latestPartial }: { row: MarketRow; weeks: string[]; latestPartial: boolean }) {
  const amt = latestCompleteAmt(row.series, latestPartial);
  const latestWeekLabel = latestPartial ? weeks[weeks.length - 2] : weeks[weeks.length - 1];
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-surface flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">{row.market}</h3>
        <span className={`text-sm font-semibold ${pctColor(row.changePct)}`}>{fmtPct(row.changePct)}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{amt != null ? fmtWon(amt) : '—'}</p>
      <p className="text-xs text-gray-400">{latestWeekLabel ?? '—'} 거래대금 · 전주 대비</p>
      <MiniBar series={row.series} latestPartial={latestPartial} />
    </div>
  );
}

type SortMode = 'change' | 'amount';

function SectorTable({
  sectors, weeks, latestPartial, sortMode, onSortModeChange, onSelectStock,
}: {
  sectors: SectorRow[]; weeks: string[]; latestPartial: boolean;
  onSelectStock: (s: PanelTarget) => void;
  sortMode: SortMode; onSortModeChange: (m: SortMode) => void;
}) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    if (sortMode === 'amount') {
      return [...sectors].sort((a, b) =>
        (latestCompleteAmt(b.series, latestPartial) ?? -Infinity) - (latestCompleteAmt(a.series, latestPartial) ?? -Infinity));
    }
    return [...sectors].sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
  }, [sectors, sortMode, latestPartial]);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-surface">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">② 산업별 주간 거래대금</h3>
        <div className="flex gap-1">
          {(['change', 'amount'] as const).map((m) => (
            <button
              key={m}
              onClick={() => onSortModeChange(m)}
              className={`px-2 py-1 text-xs rounded border ${
                sortMode === m ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {m === 'change' ? '증가율' : '금액'}
            </button>
          ))}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-400 border-b border-gray-100">
            <th className="text-left font-medium px-3 py-1.5">산업</th>
            <th className="text-right font-medium px-3 py-1.5">주간 거래대금</th>
            <th className="text-right font-medium px-3 py-1.5">전주 대비</th>
            <th className="text-right font-medium px-3 py-1.5">8주 추이</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s, i) => {
            const amt = latestCompleteAmt(s.series, latestPartial);
            const top3 = sortMode === 'change' && i < 3 && s.changePct != null && s.changePct > 0;
            const isOpen = expanded === s.sector;
            return (
              <Fragment key={s.sector}>
              <tr
                {...clickableRowProps(
                  () => setExpanded(isOpen ? null : s.sector),
                  `${s.sector} 구성종목 ${isOpen ? '접기' : '펼치기'}`,
                )}
                aria-expanded={isOpen}
                className={`border-t border-gray-50 ${CLICKABLE_ROW_CLASS} ${top3 ? 'bg-rose-50' : ''}`}
              >
                <td className="px-3 py-2 text-gray-900 font-medium whitespace-nowrap">
                  <span className="text-gray-300 mr-1.5">{isOpen ? '▾' : '▸'}</span>
                  {top3 && <span className="mr-1" title="증가율 상위 3">🔥</span>}
                  {s.sector}
                  {/* 행 클릭은 펼치기이므로, 산업 레이더 이동은 별도 아이콘으로 분리한다 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/sectors?focus=${encodeURIComponent(s.sector)}`);
                    }}
                    title={`${s.sector} 산업 레이더로 이동`}
                    aria-label={`${s.sector} 산업 레이더로 이동`}
                    className="ml-1.5 text-gray-300 hover:text-blue-600"
                  >
                    ↗
                  </button>
                </td>
                <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{amt != null ? fmtWon(amt) : '—'}</td>
                <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${pctColor(s.changePct)}`}>{fmtPct(s.changePct)}</td>
                <td className="px-3 py-2">
                  <MiniBar series={s.series} latestPartial={latestPartial} />
                </td>
              </tr>
              {isOpen && (
                <tr className="border-t border-gray-50">
                  <td colSpan={4} className="p-0">
                    <SectorMembers
                      sector={s.sector}
                      onSelect={(m) => { if (m.name != null) onSelectStock({ ...m, name: m.name, market: m.market ?? '' }); }}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {weeks.length === 0 && <p className="px-3 py-4 text-xs text-gray-400">데이터가 없습니다.</p>}
    </div>
  );
}

function StockTable({
  stocks, latestPartial, onSelect,
}: { stocks: StockRow[]; latestPartial: boolean; onSelect: (s: StockRow) => void }) {
  if (stocks.length === 0) {
    return (
      <div className="border border-gray-200 rounded-lg bg-surface p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">③ 관심종목 주간 거래대금</h3>
        <p className="text-sm text-gray-400">관심종목을 추가하면 여기서 추적됩니다.</p>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-surface">
      <h3 className="text-sm font-semibold text-gray-900 px-3 py-2 border-b border-gray-100">③ 관심종목 주간 거래대금</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-400 border-b border-gray-100">
            <th className="text-left font-medium px-3 py-1.5">종목</th>
            <th className="text-right font-medium px-3 py-1.5">주간 거래대금</th>
            <th className="text-right font-medium px-3 py-1.5">전주 대비</th>
            <th className="text-right font-medium px-3 py-1.5">8주 추이</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((s) => {
            const amt = latestCompleteAmt(s.series, latestPartial);
            return (
              <tr key={s.ticker} className="border-t border-gray-50">
                <td className="px-3 py-2">
                  <button
                    onClick={() => onSelect(s)}
                    className="text-gray-900 font-medium hover:text-blue-600 hover:underline"
                  >
                    {s.name}
                  </button>
                </td>
                <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{amt != null ? fmtWon(amt) : '—'}</td>
                <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${pctColor(s.changePct)}`}>{fmtPct(s.changePct)}</td>
                <td className="px-3 py-2">
                  <MiniBar series={s.series} latestPartial={latestPartial} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 💹 거래대금 모니터 — 수급이 가격을 만든다: 주 1회 ①시장 ②산업 ③내 종목 거래대금
 *  증가 여부를 한 페이지에서 체크. "주"는 달력 주가 아니라 최근 거래일부터 5거래일씩 묶은 블록. */
export function TurnoverPage() {
  const [selected, setSelected] = useState<PanelTarget | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('change');

  const { data, isLoading, isError } = useQuery<TurnoverResponse>({
    queryKey: ['market', 'turnover'],
    queryFn: () => apiClient.get(API.market.turnover).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const accumulating = data != null && data.weeks.length < 2;

  return (
    <div className="p-6 max-w-6xl">
      {selected && (
        <StockDetailPanel
          ticker={selected.ticker}
          name={selected.name}
          market={selected.market}
          sector={selected.sector}
          totalScore={selected.totalScore}
          onClose={() => setSelected(null)}
        />
      )}

      <h2 className="text-xl font-bold text-gray-900 mb-1">💹 거래대금</h2>
      <p className="text-sm text-gray-500 mb-6">
        주 1회 체크 — ① 시장 전체 → ② 관심 산업 → ③ 내 종목 거래대금 증가 여부 (수급이 가격을 만든다)
        {data?.latestPartial && (
          <span className="ml-2 text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5">
            최신 주 진행 중
          </span>
        )}
      </p>

      {isLoading && <p className="text-sm text-gray-400">집계 중…</p>}
      {isError && <p className="text-sm text-red-500">데이터를 불러오지 못했습니다.</p>}

      {accumulating && (
        <p className="text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 mb-4">
          데이터 축적 중입니다. 주간 비교에는 최소 2주치 거래일 데이터가 필요합니다.
        </p>
      )}

      {data && !accumulating && (
        <div className="flex flex-col gap-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">① 시장 전체 주간 거래대금</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {data.market.map((m) => (
                <MarketCard key={m.market} row={m} weeks={data.weeks} latestPartial={data.latestPartial} />
              ))}
            </div>
          </div>

          <SectorTable
            sectors={data.sectors}
            weeks={data.weeks}
            latestPartial={data.latestPartial}
            sortMode={sortMode}
            onSortModeChange={setSortMode}
            onSelectStock={setSelected}
          />

          <StockTable stocks={data.stocks} latestPartial={data.latestPartial} onSelect={setSelected} />
        </div>
      )}
    </div>
  );
}
