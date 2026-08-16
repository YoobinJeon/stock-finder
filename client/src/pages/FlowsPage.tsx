import { useState } from 'react';
import { SkippableTable } from '../shared/components/SkippableTable';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { StockDetailPanel } from '../shared/components/StockDetailPanel';
import { LiveBadge } from '../shared/components/LiveBadge';
import { isKstMarketOpen } from '../shared/lib/isKstMarketOpen';
import { clickableRowProps, CLICKABLE_ROW_CLASS } from '../shared/lib/clickableRow';

interface FlowRow {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
  totalScore: number | null;
  amt: number;    // 순매수 금액(원)
  ratio: number;  // 시총대비 %
  estAvgPrice: number | null;   // 누적 추정평균가(원) — 보유기간 순매수 수량가중, SUM(금액)/SUM(수량)
  todayAvgPrice: number | null; // 당일 추정평균가(원, 키움 매칭) — 세부 모드만 제공, 기본 모드는 null
  currentPrice: number | null;  // 현재가(최신 종가, 원)
  returnPct: number | null;     // 누적평단 대비 수익률(%)
}

interface FlowGroup {
  key: string;
  label: string;
  buy: FlowRow[];
  sell: FlowRow[];
}

interface FlowsResponse {
  days: number;
  from: string | null;
  to: string | null;
  groups: FlowGroup[];
  intraday: boolean;      // 장중 실시간 시세로 오버레이됐는지
  asOf: string | null;    // 오버레이 시각(HH:MM), 장중이 아니면 null
}

const PERIODS = [
  { days: 1, label: '1일' },
  { days: 5, label: '5일' },
  { days: 10, label: '10일' },
  { days: 20, label: '20일' },
];

function fmtEok(won: number): string {
  const eok = won / 1e8;
  if (Math.abs(eok) >= 10000) return `${(eok / 10000).toFixed(1)}조`;
  return `${Math.round(eok).toLocaleString()}억`;
}

function fmtPrice(v: number | null): string {
  return v != null ? v.toLocaleString() : '—';
}

function fmtReturnPct(v: number | null): string {
  return v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—';
}

function RankTable({ title, rows, mode, overlap, onSelect }: {
  title: string;
  rows: FlowRow[];
  mode: 'buy' | 'sell';
  overlap: Map<string, number>; // ticker → 같은 방향으로 잡힌 주체 수
  onSelect: (r: FlowRow) => void;
}) {
  const accent = mode === 'buy' ? 'text-red-600' : 'text-blue-600';
  const headBg = mode === 'buy' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700';
  const overlapBg = mode === 'buy' ? 'bg-rose-50 hover:bg-rose-100' : 'bg-sky-50 hover:bg-sky-100';
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <p className={`text-xs font-semibold px-3 py-2 ${headBg}`}>{title}</p>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-gray-400">해당 없음</p>
      ) : (
        <SkippableTable label="순위 표">
          <table className="w-full text-xs">
            <tbody>
              {rows.map((r, i) => {
                const dup = (overlap.get(r.ticker) ?? 0) >= 2;
                return (
                <tr
                  key={r.ticker}
                  title={dup ? `${overlap.get(r.ticker)}개 주체 동시 ${mode === 'buy' ? '매수' : '매도'}` : undefined}
                  className={`border-t border-gray-50 ${dup ? overlapBg : 'hover:bg-gray-50'} ${CLICKABLE_ROW_CLASS}`}
                  {...clickableRowProps(() => onSelect(r), `${r.name} 상세 열기`)}
                >
                  <td className="pl-3 py-1.5 text-gray-300 w-6 align-top">{i + 1}</td>
                  <td className="py-1.5 pr-1">
                    <div className="whitespace-nowrap">
                      <span className="text-gray-900 font-medium">{r.name}</span>
                      {r.totalScore != null && r.totalScore >= 70 && (
                        <span className="ml-1 text-[10px] text-emerald-600 font-semibold" title="종합점수 70+">
                          {r.totalScore}
                        </span>
                      )}
                    </div>
                    <div
                      className="text-[11px] text-gray-400 leading-tight"
                      title={
                        r.todayAvgPrice != null
                          ? '당일=그날 실제 체결 추정평균가(키움 동일 방식), 누적=보유기간 순매수 가중 평단 → 현재가 (누적평단 대비 수익률). 실제 매입단가와 다를 수 있음'
                          : '누적평단(보유 데이터 기간 내 순매수 가중) → 현재가 (수익률). 실제 매입단가와 다를 수 있음'
                      }
                    >
                      <div className="whitespace-nowrap">
                        {r.todayAvgPrice != null && <>당일 {fmtPrice(r.todayAvgPrice)} · </>}
                        누적 {fmtPrice(r.estAvgPrice)}
                      </div>
                      <div className="whitespace-nowrap">
                        → {fmtPrice(r.currentPrice)}
                        {r.returnPct != null && (
                          <span className={`ml-1 font-medium ${r.returnPct >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                            {fmtReturnPct(r.returnPct)}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-1.5 text-right align-top">
                    <div className={`font-medium whitespace-nowrap ${accent}`}>
                      {r.ratio > 0 ? '+' : ''}{r.ratio.toFixed(2)}%
                    </div>
                  </td>
                  <td className="py-1.5 pr-3 pl-2 text-right text-gray-500 whitespace-nowrap w-16 align-top">
                    {fmtEok(r.amt)}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </SkippableTable>
      )}
    </div>
  );
}

const MODES = [
  { id: 'basic', label: '외인·기관·개인' },
  { id: 'detail', label: '연기금·투신·사모' },
];

export function FlowsPage() {
  const [days, setDays] = useState(1);
  const [mode, setMode] = useState('basic');
  const [selected, setSelected] = useState<FlowRow | null>(null);

  const { data, isLoading, isError } = useQuery<FlowsResponse>({
    queryKey: ['market', 'flows-ranking', days, mode],
    queryFn: () => apiClient.get(`${API.market.flowsRanking}?days=${days}&mode=${mode}`).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    refetchInterval: () => (isKstMarketOpen() ? 60_000 : false), // 장중 오늘 수급 랭킹 실시간 시세 오버레이
  });

  const empty = !isLoading && !isError && data != null && data.groups.every((g) => g.buy.length === 0 && g.sell.length === 0);

  // 여러 주체가 같은 방향으로 잡은 종목 (이미지의 분홍/하늘 하이라이트와 동일 개념)
  const buyOverlap = new Map<string, number>();
  const sellOverlap = new Map<string, number>();
  for (const g of data?.groups ?? []) {
    for (const r of g.buy) buyOverlap.set(r.ticker, (buyOverlap.get(r.ticker) ?? 0) + 1);
    for (const r of g.sell) sellOverlap.set(r.ticker, (sellOverlap.get(r.ticker) ?? 0) + 1);
  }

  return (
    <div className="p-6 max-w-7xl">
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

      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-xl font-bold text-gray-900">💰 수급 순위</h2>
          {data?.intraday && <LiveBadge asOf={data.asOf} />}
        </div>
        <div className="flex gap-1 flex-wrap">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`px-3 py-1.5 text-sm rounded-lg border ${
                mode === m.id
                  ? 'border-purple-400 bg-purple-50 text-purple-700 font-medium'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {m.label}
            </button>
          ))}
          <span className="w-px bg-gray-200 mx-1" />
          {PERIODS.map((p) => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={`px-3 py-1.5 text-sm rounded-lg border ${
                days === p.days
                  ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        투자자 주체별 <b>시총대비 순매수/매도</b> 상위 종목
        {data?.from && data?.to && (
          <span className="text-gray-400"> · {data.days === 1 ? data.to : `${data.from} ~ ${data.to}`} 합산</span>
        )}
        . 순매수 1억 미만 제외, 초록 숫자는 종합점수 70+.
        {' '}<span className="bg-rose-50 border border-rose-100 rounded px-1">분홍</span> = 2개+ 주체 동시 매수,
        {' '}<span className="bg-sky-50 border border-sky-100 rounded px-1">하늘</span> = 동시 매도.
        {' '}<span className="text-gray-400">추정평단은 랭킹 기간과 무관하게 보유 데이터 전 기간(약 1개월)의 순매수일만 가중한 근사치로, 실제 매입단가와 다를 수 있습니다.
        당일 = 그날 실제 체결 추정평균가(키움 동일 방식), 누적 = 보유기간 순매수 가중 평단.</span>
      </p>

      {isLoading && <p className="text-sm text-gray-400">집계 중…</p>}
      {isError && <p className="text-sm text-red-500">수급 순위를 불러오지 못했습니다.</p>}
      {empty && (
        <p className="text-sm text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 mb-4">
          {mode === 'detail'
            ? '세부 주체(KRX) 데이터가 아직 없습니다. 데이터 수집을 한 번 실행하면 최근 영업일부터 쌓이기 시작합니다 (일일 자동 수집으로 점진 백필).'
            : '수급 데이터가 없습니다. 데이터 수집을 먼저 실행하세요.'}
        </p>
      )}

      <div className={`grid gap-4 ${data && data.groups.length >= 4 ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3'}`}>
        {data?.groups.map((g) => (
          <div key={g.key} className="flex flex-col gap-4">
            <h3 className="font-semibold text-gray-900 text-center bg-surface border border-gray-200 rounded-lg py-2">
              {g.label}
            </h3>
            <RankTable title={`${g.label} 시총대비 매수 TOP ${g.buy.length}`} rows={g.buy} mode="buy" overlap={buyOverlap} onSelect={setSelected} />
            <RankTable title={`${g.label} 시총대비 매도 TOP ${g.sell.length}`} rows={g.sell} mode="sell" overlap={sellOverlap} onSelect={setSelected} />
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-4">
        {mode === 'basic'
          ? '외인·기관·개인: 네이버 투자자별 매매동향 (금액은 수량×종가 근사, 종목당 최근 20영업일).'
          : '세부 주체: KRX 정보데이터시스템 [12010] 순매수대금 실측 (연기금·투신·사모·금융투자, 일일 수집으로 최근 20영업일까지 점진 축적).'}
      </p>
    </div>
  );
}
