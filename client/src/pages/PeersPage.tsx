import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { StockDetailPanel } from '../shared/components/StockDetailPanel';
import { SymbolChartPanel } from '../shared/components/SymbolChartPanel';
import { ScrollFade } from '../shared/components/ScrollFade';

interface ForeignPeer {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
  currency: string;
}

interface DomesticPeer {
  ticker: string;
  name: string;
  price: number | null;
  changePct: number | null;
}

interface PeerGroup {
  name: string;
  foreign: ForeignPeer[];
  domestic: DomesticPeer[];
}

interface GlobalPeersResponse {
  asOf: number;
  groups: PeerGroup[];
}

interface SelectedStock {
  ticker: string;
  name: string;
  market: string;
  sector?: string | null;
  total_score: number | null;
}

/** 그룹명 → DOM id (칩 바 클릭 시 scrollIntoView 타깃). 한글·중점(·)을 대시로 치환. */
function groupDomId(name: string): string {
  return `peer-group-${name.replace(/[^\p{L}\p{N}]+/gu, '-')}`;
}

/** 등락률 배열의 단순 산술평균 — null(시세 없음)은 제외. 전부 null이면 null. */
function avgChangePct(items: Array<{ changePct: number | null }>): number | null {
  const valid = items.map((i) => i.changePct).filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

/** 등락률 내림차순 정렬 — null(시세 없음)은 맨 뒤로. 원본은 불변, 새 배열 반환. */
function sortByChangeDesc<T extends { changePct: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
}

function ChgBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-gray-300">—</span>;
  const cls = pct > 0 ? 'text-red-500' : pct < 0 ? 'text-blue-500' : 'text-gray-400';
  return (
    <span className={`text-xs font-medium ${cls} whitespace-nowrap`}>
      {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
    </span>
  );
}

/** 그룹 카드 헤더용 요약 배지 — "해외 평균 +1.2%" 형태, 색상은 ChgBadge와 동일 규칙. */
function AvgBadgeText({ label, pct }: { label: string; pct: number | null }) {
  if (pct == null) {
    return <span className="text-[11px] text-gray-300">{label} —</span>;
  }
  const cls = pct > 0 ? 'text-red-500' : pct < 0 ? 'text-blue-500' : 'text-gray-400';
  return (
    <span className={`text-[11px] font-medium ${cls} whitespace-nowrap`}>
      {label} {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

/** 소수점 자릿수 — 엔화·원화는 정수, 그 외 통화는 소수 둘째자리까지 (SymbolChartPanel과 동일 규칙) */
function fmtForeignPrice(price: number | null, currency: string): string {
  if (price == null) return '—';
  const digits = currency === 'JPY' ? 0 : 2;
  return price.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function PeerGroupCard({
  group,
  onSelect,
  onSelectSymbol,
}: {
  group: PeerGroup;
  onSelect: (s: SelectedStock) => void;
  onSelectSymbol: (symbol: string) => void;
}) {
  const foreignSorted = sortByChangeDesc(group.foreign);
  const domesticSorted = sortByChangeDesc(group.domestic);
  const foreignAvg = avgChangePct(group.foreign);
  const domesticAvg = avgChangePct(group.domestic);

  return (
    <div id={groupDomId(group.name)} className="bg-surface rounded-xl border border-gray-200 scroll-mt-16">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{group.name}</h3>
        <div className="flex items-center gap-2 shrink-0">
          <AvgBadgeText label="해외" pct={foreignAvg} />
          <span className="text-[11px] text-gray-200">·</span>
          <AvgBadgeText label="국내" pct={domesticAvg} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 items-start gap-x-4 gap-y-1 px-4 py-2.5">
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-gray-400 mb-1">해외</p>
          {foreignSorted.length === 0 && <p className="text-xs text-gray-300">해외 시세 없음</p>}
          {foreignSorted.map((f) => (
            <button
              key={f.symbol}
              onClick={() => onSelectSymbol(f.symbol)}
              className="w-full flex items-center justify-between gap-2 text-[13px] hover:bg-blue-50 rounded px-1 -mx-1"
            >
              <span className="text-gray-600 truncate">{f.name}</span>
              <span className="flex items-baseline gap-1.5 shrink-0">
                <span className="text-gray-900 tabular-nums">{fmtForeignPrice(f.price, f.currency)}</span>
                <ChgBadge pct={f.changePct} />
              </span>
            </button>
          ))}
        </div>
        <div className="space-y-1 sm:border-l sm:border-gray-100 sm:pl-4 mt-2 sm:mt-0 self-start">
          <p className="text-[11px] font-medium text-gray-400 mb-1">국내 피어</p>
          {domesticSorted.length === 0 && <p className="text-xs text-gray-300">국내 피어 없음</p>}
          {domesticSorted.map((d) => (
            <button
              key={d.ticker}
              onClick={() =>
                onSelect({ ticker: d.ticker, name: d.name, market: '', sector: null, total_score: null })
              }
              className="w-full flex items-center justify-between gap-2 text-[13px] hover:bg-blue-50 rounded px-1 -mx-1"
            >
              <span className="text-gray-900 font-medium truncate">{d.name}</span>
              <span className="flex items-baseline gap-1.5 shrink-0">
                <span className="text-gray-900 tabular-nums">
                  {d.price != null ? d.price.toLocaleString('ko-KR') : '—'}
                </span>
                <ChgBadge pct={d.changePct} />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 상단 sticky 그룹 바로가기 칩 바 — 클릭 시 해당 그룹 카드로 부드럽게 스크롤. */
function GroupChipBar({ groups }: { groups: PeerGroup[] }) {
  const scrollToGroup = (name: string) => {
    document.getElementById(groupDomId(name))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="sticky top-0 z-10 -mx-6 mb-4 bg-surface/95 backdrop-blur border-b border-gray-100 px-6 py-2">
      <ScrollFade className="flex gap-1.5 pb-0.5">
        {groups.map((g) => (
          <button
            key={g.name}
            onClick={() => scrollToGroup(g.name)}
            className="shrink-0 px-2.5 py-1 rounded-full text-xs font-medium text-gray-600 bg-gray-100 hover:bg-blue-50 hover:text-blue-600 whitespace-nowrap"
          >
            {g.name}
          </button>
        ))}
      </ScrollFade>
    </div>
  );
}

/**
 * 글로벌 피어 페이지  — 해외 기업과 국내 피어를 섹터
 * 그룹별로 비교하는 전용 화면. 5→15→18그룹으로 확장되며 그룹 탐색을 돕기 위해 상단 sticky
 * 칩 바(그룹 바로가기)를 추가하고, 그룹 카드 헤더에 해외/국내 평균 등락률 배지를 붙여
 * 한눈에 "뜨거운 그룹"을 파악할 수 있게 했다. 그룹 내 종목은 등락률 내림차순 정렬(강한 종목이
 * 위로). (실사용 피드백: "3개로 한정짓지 말고 진행했으면... 가독성 좋게 만들어주고")
 * 그룹 카드 그리드(md 2열), 해외 종목 클릭 → 심볼 차트 패널, 국내 피어 클릭 → 종목 상세.
 * 180초 폴링(서버 캐시와 동일 — 심볼 수 증가로 에서 120→180초 상향).
 */
export function PeersPage() {
  const [selected, setSelected] = useState<SelectedStock | null>(null);
  const [symbolPanel, setSymbolPanel] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<GlobalPeersResponse>({
    queryKey: ['market', 'globalPeers'],
    queryFn: () => apiClient.get(API.market.globalPeers).then((r) => r.data),
    refetchInterval: 180 * 1000,
    staleTime: 170 * 1000,
  });

  return (
    <div className="p-6">
      {selected && (
        <StockDetailPanel
          ticker={selected.ticker}
          name={selected.name}
          market={selected.market}
          sector={selected.sector}
          totalScore={selected.total_score}
          onClose={() => setSelected(null)}
        />
      )}
      {symbolPanel && (
        <SymbolChartPanel symbol={symbolPanel} onClose={() => setSymbolPanel(null)} />
      )}

      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-xl font-bold text-gray-900">🌐 글로벌 피어</h2>
        <span className="text-xs text-gray-400">
          {data ? `${data.groups.length}개 그룹` : ''} · 3분 갱신
        </span>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        해외 기업과 국내 피어를 섹터별로 비교합니다. 해외 종목 클릭 시 차트, 국내 피어 클릭 시 종목 상세가 열립니다.
      </p>

      {isError && (
        <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          글로벌 피어 데이터를 불러오지 못했습니다.
        </p>
      )}

      {(isLoading || !data) && !isError && (
        <p className="text-sm text-gray-400 py-6">불러오는 중…</p>
      )}

      {data && (
        <>
          <GroupChipBar groups={data.groups} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.groups.map((g) => (
              <PeerGroupCard key={g.name} group={g} onSelect={setSelected} onSelectSymbol={setSymbolPanel} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
