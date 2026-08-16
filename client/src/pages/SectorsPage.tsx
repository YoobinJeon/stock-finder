import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { LiveBadge } from '../shared/components/LiveBadge';
import { isKstMarketOpen } from '../shared/lib/isKstMarketOpen';
import { clickableRowProps, CLICKABLE_ROW_CLASS } from '../shared/lib/clickableRow';
import { SectorMembers } from '../shared/components/SectorMembers';
import { SortableTh, useClientSort } from '../shared/components/SortableTh';
import { StockDetailPanel } from '../shared/components/StockDetailPanel';
import type { StockChip } from '../shared/components/StockChipList';

interface LeaderStock {
  ticker: string;
  name: string;
  marketCap: number;
  totalScore: number;
  leaderScore: number;
  livePrice?: number | null;   // 장중 실시간 시세
  liveChgPct?: number | null;
}

interface SectorRow {
  sector: string;
  stockCount: number;
  avgScore: number | null;
  breadthMa20: number | null;
  flowAmt20d: number;
  flowStrength: number;
  trendScore: number;              // EOD 구조 추세
  leaders: LeaderStock[];
  todayChgPct?: number | null;     // 장중: 섹터 오늘 등락률 (%)
  breadthToday?: number | null;    // 장중: 오늘 상승 종목 비율 (%)
  liveScore?: number;              // 장중: 재계산 순위 점수
}

interface SectorsResponse {
  intraday: boolean;
  asOf: string | null;             // "HH:MM"
  sectors: SectorRow[];
}

function fmtEok(won: number): string {
  const eok = won / 1e8;
  if (Math.abs(eok) >= 10000) return `${(eok / 10000).toFixed(1)}조`;
  return `${Math.round(eok).toLocaleString()}억`;
}

function fmtPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function TrendBar({ value }: { value: number }) {
  const color = value >= 70 ? 'bg-red-500' : value >= 55 ? 'bg-amber-400' : 'bg-gray-300';
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="text-sm font-semibold text-gray-900 w-8">{value}</span>
      {value >= 70 && <span>🔥</span>}
    </div>
  );
}

export function SectorsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusSector = searchParams.get('focus');
  const focusRowRef = useRef<HTMLTableRowElement | null>(null);
  const hasScrolledToFocusRef = useRef(false);
  const { data, isLoading, isError } = useQuery<SectorsResponse>({
    queryKey: ['market', 'sectors'],
    queryFn: () => apiClient.get(API.market.sectors).then((r) => r.data),
    refetchInterval: () => (isKstMarketOpen() ? 60 * 1000 : false), // 장중 서버가 60초 스로틀로 재계산 → 장중에만 폴링으로 반영
  });
  const intraday = data?.intraday ?? false;
  const sectors = data?.sectors ?? [];

  // 표시값 그대로 정렬한다 — 장중에는 '트렌드'가 장중 순위, 'MA20 상회'가 오늘 상승비로 바뀌므로
  // 정렬 기준도 같이 바뀌어야 눈에 보이는 숫자와 어긋나지 않는다.
  // useMemo 필수 — useClientSort가 accessors 동일성으로 재정렬 시점을 판단한다.
  // intraday가 뒤집히면 '트렌드'·'상회' 열이 다른 값을 가리키므로 순서도 다시 잡혀야 한다.
  const accessors = useMemo(() => ({
    sector: (s: SectorRow) => s.sector,
    today: (s: SectorRow) => s.todayChgPct,
    trend: (s: SectorRow) => (intraday ? s.liveScore ?? s.trendScore : s.trendScore),
    avgScore: (s: SectorRow) => s.avgScore,
    breadth: (s: SectorRow) => (intraday ? s.breadthToday : s.breadthMa20),
    flow: (s: SectorRow) => s.flowAmt20d,
    count: (s: SectorRow) => s.stockCount,
  }), [intraday]);

  const { sorted, sort, onSort } = useClientSort<SectorRow>(
    sectors,
    accessors,
    'trend', // 서버가 이미 트렌드(장중이면 장중 순위) 내림차순으로 주는 순서와 같다
  );
  // 산업을 누르면 구성종목을 펼친다 — 테마 레이더에서 테마를 누르는 것과 같은 동작.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<StockChip | null>(null);

  // 거래대금 페이지에서 산업명 클릭 → 딥링크(?focus=산업명) 진입 시 해당 행으로 스크롤 (1회만)
  useEffect(() => {
    if (!focusSector || hasScrolledToFocusRef.current || sectors.length === 0) return;
    if (focusRowRef.current) {
      focusRowRef.current.scrollIntoView({ block: 'center' });
      hasScrolledToFocusRef.current = true;
    }
  }, [focusSector, sectors]);

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-xl font-bold text-gray-900">🔭 산업 레이더</h2>
        {intraday && <LiveBadge asOf={data?.asOf} />}
      </div>
      <p className="text-sm text-gray-500 mb-6">
        {intraday
          ? '장중 순위 = 평균 종합점수 40% + 오늘 상승 종목 비율 30% + 오늘 섹터 등락률 순위 30%. 등락률·상승비율·대표 종목 시세는 실시간, 재무·수급은 전일 확정치입니다.'
          : '섹터별 트렌드 = 평균 종합점수 40% + 추세 폭(MA20 상회 비율) 30% + 수급 강도(시총 대비 외인·기관 20일 순매수 백분위) 30%. 대표 종목은 섹터 내 점수·시총·수급 상위 종목입니다.'}
      </p>

      {isLoading && <p className="text-sm text-gray-400">집계 중…</p>}
      {isError && <p className="text-sm text-red-500">데이터를 불러오지 못했습니다.</p>}

      <div className="bg-surface rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500">
                <SortableTh label="산업(섹터)" col="sector" sort={sort} onSort={onSort} align="left" pad="px-4 py-3" />
                {intraday && <SortableTh label="오늘" col="today" sort={sort} onSort={onSort} />}
                <SortableTh label={intraday ? '장중 순위' : '트렌드'} col="trend" sort={sort} onSort={onSort} align="left" />
                <SortableTh label="평균점수" col="avgScore" sort={sort} onSort={onSort} />
                <SortableTh label={intraday ? '오늘 상승비' : 'MA20 상회'} col="breadth" sort={sort} onSort={onSort} />
                <SortableTh label="수급 20일" col="flow" sort={sort} onSort={onSort} />
                <SortableTh label="종목수" col="count" sort={sort} onSort={onSort} />
                {/* 대표 종목은 여러 종목의 목록이라 정렬 기준이 없다 */}
                <th className="px-4 py-3 font-medium">대표 종목</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => {
                const isFocused = focusSector != null && s.sector === focusSector;
                const isOpen = expanded === s.sector;
                return (
                <Fragment key={s.sector}>
                <tr
                  ref={isFocused ? focusRowRef : undefined}
                  {...clickableRowProps(
                    () => setExpanded(isOpen ? null : s.sector),
                    `${s.sector} 구성종목 ${isOpen ? '접기' : '펼치기'}`,
                  )}
                  aria-expanded={isOpen}
                  className={`border-t border-gray-100 hover:bg-gray-50 ${CLICKABLE_ROW_CLASS} ${isFocused ? 'bg-blue-50' : ''}`}
                >
                  <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                    <span className="text-gray-300 mr-1.5">{isOpen ? '▾' : '▸'}</span>
                    {s.sector}
                  </td>
                  {intraday && (
                    <td className={`px-3 py-3 text-right font-semibold whitespace-nowrap ${
                      (s.todayChgPct ?? 0) > 0 ? 'text-red-600' : (s.todayChgPct ?? 0) < 0 ? 'text-blue-600' : 'text-gray-400'
                    }`}>
                      {s.todayChgPct != null ? fmtPct(s.todayChgPct) : '—'}
                    </td>
                  )}
                  <td className="px-3 py-3"><TrendBar value={(intraday ? s.liveScore : s.trendScore) ?? s.trendScore} /></td>
                  <td className="px-3 py-3 text-right text-gray-700">{s.avgScore ?? '—'}</td>
                  <td className="px-3 py-3 text-right text-gray-700">
                    {intraday
                      ? (s.breadthToday != null ? `${s.breadthToday}%` : '—')
                      : (s.breadthMa20 != null ? `${s.breadthMa20}%` : '—')}
                  </td>
                  <td className={`px-3 py-3 text-right whitespace-nowrap ${s.flowAmt20d > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                    {s.flowAmt20d !== 0 ? fmtEok(s.flowAmt20d) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right text-gray-400">{s.stockCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {s.leaders.map((l) => (
                        <button
                          key={l.ticker}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate('/screener', { state: { search: l.name } });
                          }}
                          title={`대표 종목 점수 ${l.leaderScore} · 종합 ${l.totalScore}점 · 시총 ${fmtEok(l.marketCap)}`}
                          className="text-xs bg-blue-50 border border-blue-100 text-blue-700 rounded px-2 py-0.5 hover:bg-blue-100"
                        >
                          {l.name}{' '}
                          {intraday && l.liveChgPct != null ? (
                            <span className={l.liveChgPct >= 0 ? 'text-red-500' : 'text-blue-500'}>
                              {fmtPct(l.liveChgPct)}
                            </span>
                          ) : (
                            <span className="text-blue-400">{l.totalScore}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-t border-gray-100">
                    <td colSpan={intraday ? 8 : 7} className="p-0">
                      <SectorMembers sector={s.sector} onSelect={setSelected} />
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && selected.name != null && (
        <StockDetailPanel
          ticker={selected.ticker}
          name={selected.name}
          market={selected.market ?? ''}
          sector={selected.sector}
          totalScore={selected.totalScore}
          onClose={() => setSelected(null)}
        />
      )}

      <p className="text-xs text-gray-400 mt-3">
        {intraday
          ? '장중 실시간: 섹터 등락률·상승 종목 비율(네이버 업종)과 대표 종목 시세는 실시간이며, 평균 종합점수·20일 수급은 전일 확정치입니다. 마감 후에는 구조 추세(EOD)로 전환됩니다.'
          : '경량판: 자체 수집 데이터(점수·시세·수급)만 사용합니다. 정책·특허·글로벌 성장률은 반영하지 않습니다. 수급은 수집 범위에 포함된 종목만 반영됩니다.'}
      </p>
    </div>
  );
}
