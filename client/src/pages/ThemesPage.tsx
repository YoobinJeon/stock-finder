import { Fragment, useState } from 'react';
import { SkippableTable } from '../shared/components/SkippableTable';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { StockDetailPanel } from '../shared/components/StockDetailPanel';
import { LiveBadge } from '../shared/components/LiveBadge';
import { ThemeRotationView } from './ThemeRotationView';
import { isKstMarketOpen } from '../shared/lib/isKstMarketOpen';
import { StockChipList } from '../shared/components/StockChipList';
import { clickableRowProps, CLICKABLE_ROW_CLASS } from '../shared/lib/clickableRow';
import { SortableTh, useClientSort } from '../shared/components/SortableTh';

interface ThemeLeader {
  ticker: string;
  name: string;
  marketCap: number;
  totalScore: number;
  leaderScore: number;
  livePrice?: number | null;
  liveChgPct?: number | null;
}

interface ThemeRow {
  no: number;
  name: string;
  memberCount: number;
  scoredCount: number;
  avgScore: number | null;
  chgPct: number | null;
  up: number | null;
  down: number | null;
  leaders: ThemeLeader[];
}

interface ThemesResponse {
  intraday: boolean;
  asOf: string | null;
  updatedAt: string | null;
  refreshing: boolean;
  themes: ThemeRow[];
}

interface ThemeMember {
  ticker: string;
  name: string | null;
  market: string | null;
  sector: string | null;
  marketCap: number | null;
  totalScore: number | null;
  lastClose: number | null;
  dayChange: number | null;
  livePrice: number | null;
  liveChgPct: number | null;
}

interface ThemeDetail {
  no: number;
  name: string;
  intraday: boolean;
  members: ThemeMember[];
}

/**
 * 정렬 기준 — 렌더 밖 상수로 둔다. `useClientSort`가 accessors 동일성으로 재정렬 시점을
 * 판단하므로, 매 렌더 새 객체를 만들면 memo가 무의미해진다.
 * '상승/하락' 칸은 두 숫자를 함께 보여줘 기준을 하나 골라야 한다 — 먼저 읽히는 상승 종목 수를
 * 쓰고 헤더 tooltip에 명시했다.
 */
const THEME_SORT_ACCESSORS = {
  name: (t: ThemeRow) => t.name,
  chgPct: (t: ThemeRow) => t.chgPct,
  up: (t: ThemeRow) => t.up,
  avgScore: (t: ThemeRow) => t.avgScore,
  memberCount: (t: ThemeRow) => t.memberCount,
};

function fmtPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function PctText({ v }: { v: number | null }) {
  if (v == null) return <span className="text-gray-400">—</span>;
  const cls = v > 0 ? 'text-red-600' : v < 0 ? 'text-blue-600' : 'text-gray-400';
  return <span className={cls}>{fmtPct(v)}</span>;
}

/** 확장 행 — 테마 구성종목 목록. 칩 모양은 산업 구성종목과 공용(StockChipList). */
function ThemeMembers({ no, onSelect }: { no: number; onSelect: (m: ThemeMember) => void }) {
  const { data, isLoading } = useQuery<ThemeDetail>({
    queryKey: ['themes', no],
    queryFn: () => apiClient.get(API.themes.detail(no)).then((r) => r.data),
    refetchInterval: () => (isKstMarketOpen() ? 60 * 1000 : false), // 장중에만 60초 폴링
  });

  if (isLoading) return <p className="px-6 py-3 text-sm text-gray-400">구성종목 불러오는 중…</p>;
  const members = data?.members ?? [];

  return (
    <div className="px-6 py-3 bg-gray-50/60">
      <StockChipList items={members} onSelect={(m) => onSelect(m as ThemeMember)} />
    </div>
  );
}

export function ThemesPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<'list' | 'rotation'>('list');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [selected, setSelected] = useState<ThemeMember | null>(null);

  const gotoThemeInList = (no: number) => {
    setView('list');
    setExpanded(no);
  };

  const { data, isLoading } = useQuery<ThemesResponse>({
    queryKey: ['themes'],
    queryFn: () => apiClient.get(API.themes.list).then((r) => r.data),
    refetchInterval: () => (isKstMarketOpen() ? 60 * 1000 : false), // 장중에만 60초 폴링
    staleTime: 50 * 1000,
  });

  const refresh = useMutation({
    mutationFn: () => apiClient.post(API.themes.refresh),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['themes'] }),
  });

  const themes = data?.themes ?? [];
  const isRefreshing = refresh.isPending || (data?.refreshing ?? false);

  const { sorted, sort, onSort } = useClientSort<ThemeRow>(
    themes,
    THEME_SORT_ACCESSORS,
    'chgPct', // 서버가 오늘 등락률 내림차순으로 주는 기본 순서와 같다
  );

  return (
    <div className="p-6 max-w-6xl">
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

      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-xl font-bold text-gray-900">🧩 테마 레이더</h2>
        {data?.intraday && data.asOf && <LiveBadge asOf={data.asOf} />}
        <div className="ml-auto flex gap-1">
          {([['list', '테마 목록'], ['rotation', '로테이션']] as const).map(([v, label]) => (
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
        {view === 'list' && (
          <button
            onClick={() => refresh.mutate()}
            disabled={isRefreshing}
            className="text-xs rounded-lg border border-gray-200 bg-surface px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {isRefreshing ? '수집 중…' : '테마 목록 갱신'}
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-4">
        {view === 'list' && (
          <>
            네이버 테마별 오늘 등락률(60초 갱신) + 우리 종합점수 기반 대표 종목.
            {data?.updatedAt && <span className="text-gray-400"> · 테마 구성 기준 {data.updatedAt}</span>}
          </>
        )}
        {view === 'rotation' && '일별 스냅샷 기반 테마 로테이션 — 달아오르는/식는 테마, 연속 상승. 오늘부터 데이터가 쌓입니다.'}
      </p>

      {view === 'rotation' && <ThemeRotationView onSelect={gotoThemeInList} />}

      {view === 'list' && (
      <>
      {isLoading && <p className="text-sm text-gray-400">불러오는 중…</p>}
      {!isLoading && themes.length === 0 && (
        <div className="bg-surface rounded-xl border border-gray-200 p-6 text-sm text-gray-500">
          {isRefreshing
            ? '첫 테마 수집이 진행 중입니다. 잠시 후 자동으로 표시됩니다.'
            : '테마 스냅샷이 없습니다. "테마 목록 갱신"을 눌러 수집하세요.'}
        </div>
      )}

      {themes.length > 0 && (
        <div className="bg-surface rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <SkippableTable label="테마 표">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500">
                    <SortableTh label="테마" col="name" sort={sort} onSort={onSort} align="left" pad="px-4 py-3" />
                    <SortableTh label="오늘" col="chgPct" sort={sort} onSort={onSort} />
                    <SortableTh label="상승/하락" col="up" sort={sort} onSort={onSort} title="클릭하여 정렬 (상승 종목 수 기준)" />
                    <SortableTh label="평균점수" col="avgScore" sort={sort} onSort={onSort} />
                    <SortableTh label="종목수" col="memberCount" sort={sort} onSort={onSort} />
                    {/* 대표 종목은 여러 종목의 목록이라 정렬 기준이 없다 */}
                    <th className="px-4 py-3 font-medium">대표 종목</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((t) => (
                    <Fragment key={t.no}>
                      <tr
                        {...clickableRowProps(
                          () => setExpanded(expanded === t.no ? null : t.no),
                          `${t.name} 구성종목 ${expanded === t.no ? '접기' : '펼치기'}`,
                        )}
                        aria-expanded={expanded === t.no}
                        className={`border-t border-gray-100 hover:bg-gray-50 ${CLICKABLE_ROW_CLASS}`}
                      >
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                          <span className="text-gray-300 mr-1.5">{expanded === t.no ? '▾' : '▸'}</span>
                          {t.name}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold whitespace-nowrap">
                          <PctText v={t.chgPct} />
                        </td>
                        <td className="px-3 py-3 text-right text-gray-600 whitespace-nowrap">
                          {t.up != null && t.down != null ? (
                            <>
                              <span className="text-red-500">{t.up}▲</span>
                              <span className="mx-1 text-gray-300">/</span>
                              <span className="text-blue-500">{t.down}▼</span>
                            </>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-700">{t.avgScore ?? '—'}</td>
                        <td className="px-3 py-3 text-right text-gray-400">{t.memberCount}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {t.leaders.map((l) => (
                              <span
                                key={l.ticker}
                                title={`대표 종목 점수 ${l.leaderScore} · 종합 ${l.totalScore}점`}
                                className="text-xs bg-blue-50 border border-blue-100 text-blue-700 rounded px-2 py-0.5"
                              >
                                {l.name}{' '}
                                {l.liveChgPct != null ? (
                                  <span className={l.liveChgPct >= 0 ? 'text-red-500' : 'text-blue-500'}>
                                    {fmtPct(l.liveChgPct)}
                                  </span>
                                ) : (
                                  <span className="text-blue-400">{l.totalScore}</span>
                                )}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                      {expanded === t.no && (
                        <tr className="border-t border-gray-100">
                          <td colSpan={6} className="p-0">
                            <ThemeMembers no={t.no} onSelect={setSelected} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </SkippableTable>
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3">
        등락률·상승/하락 수는 네이버 테마 기준(마감 후엔 당일 최종치), 평균점수·대표 종목은 자체 수집
        범위 종목만 반영됩니다. 테마 구성은 천천히 변하므로 주 1회쯤 갱신하면 충분합니다.
      </p>
      </>
      )}
    </div>
  );
}
