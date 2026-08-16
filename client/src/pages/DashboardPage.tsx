import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { MarketIndicatorGrid } from '../shared/components/MarketIndicatorGrid';
import { MoversCard } from '../shared/components/MoversCard';
import { NewsCard } from '../shared/components/NewsCard';
import { EtfPhaseStrip } from '../shared/components/EtfPhaseStrip';
import { isKstMarketOpen } from '../shared/lib/isKstMarketOpen';
import { scoreColorClass } from '../shared/lib/scoreGrade';

// 두 패널 모두 차트 라이브러리(lightweight-charts, gzip 56kB)를 끌고 오는데, 대시보드는
// 진입 경로라 정적 import로 두면 그 무게가 첫 로드에 그대로 실린다. 실제로는 종목·심볼을
// 눌러야 열리는 모달이므로 열릴 때 받아온다.
const StockDetailPanel = lazy(() =>
  import('../shared/components/StockDetailPanel').then((m) => ({ default: m.StockDetailPanel })),
);
const SymbolChartPanel = lazy(() =>
  import('../shared/components/SymbolChartPanel').then((m) => ({ default: m.SymbolChartPanel })),
);

interface TopStock {
  ticker: string;
  name: string;
  market: string;
  sector?: string | null;
  total_score: number | null;
}

interface IndexQuote {
  key: string;
  name: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  up: boolean;
  asOf: number | null; // 실시간 시세 기준 시각 (ms)
}

// 데이터 신선도 배지 — 최신 거래일이 이 값(영업일) 이상 밀리면 경고(amber) 표시.
// 서버 countWeekdaysBetweenUTC는 주말만 제외한 근사치라 긴 연휴엔 오탐(잠깐 amber)이
// 날 수 있음을 감안한 임계값 — 오탐 비용이 낮아 허용한다.
const FRESHNESS_WARN_THRESHOLD_BUSINESS_DAYS = 2;

interface WatchItem {
  ticker: string;
  memo: string | null;
  name: string;
  market: string;
  sector: string | null;
  total_score: number | null;
  last_close: number | string | null;
  day_change: number | string | null;
  foreign_amt_5d: number | string | null;
  inst_amt_5d: number | string | null;
}

function fmtFlowEok(v: number | string | null): string | null {
  if (v == null) return null;
  const eok = Number(v) / 1e8;
  if (!Number.isFinite(eok) || eok === 0) return null;
  const sign = eok > 0 ? '+' : '';
  if (Math.abs(eok) >= 10000) return `${sign}${(eok / 10000).toFixed(1)}조`;
  return `${sign}${Math.abs(eok) >= 100 ? Math.round(eok).toLocaleString() : eok.toFixed(1)}억`;
}

/** 관심종목 위젯 — 종목 상세의 ♡로 추가/제거 */
function WatchlistCard({ onSelect }: { onSelect: (s: TopStock) => void }) {
  const qc = useQueryClient();
  const { data: rawItems = [] } = useQuery<WatchItem[]>({
    queryKey: ['watchlist'],
    queryFn: () => apiClient.get(API.watchlist.list).then((r) => r.data),
  });

  // 실시간 시세 (장중 반영, 30초 폴링)
  const tickers = rawItems.map((w) => w.ticker);
  const { data: quotes = {} } = useQuery<Record<string, { price: number; changePct: number }>>({
    queryKey: ['quotes', 'watchlist', tickers.join(',')],
    queryFn: () => apiClient.get(`${API.market.quotes}?tickers=${tickers.join(',')}`).then((r) => r.data),
    enabled: tickers.length > 0,
    refetchInterval: () => (isKstMarketOpen() ? 30 * 1000 : false), // 장중에만 30초 폴링
    staleTime: 25 * 1000,
  });
  const items: WatchItem[] = rawItems.map((w) => {
    const q = quotes[w.ticker];
    return q ? { ...w, last_close: q.price, day_change: q.changePct } : w;
  });

  const remove = useMutation({
    mutationFn: (ticker: string) => apiClient.delete(API.watchlist.item(ticker)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist'] }),
  });

  return (
    <div className="bg-surface rounded-xl border border-gray-200 mb-8">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">♥ 관심종목</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{items.length}개 · 종목 상세의 ♡로 추가</span>
          {items.length >= 2 && (
            <Link
              to={`/compare?t=${items.slice(0, 4).map((w) => w.ticker).join(',')}`}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 shrink-0"
            >
              ⚖️ 비교
            </Link>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-400">
          아직 관심종목이 없습니다. 종목을 클릭해 상세 화면에서 ♡를 눌러 추가하세요.
        </p>
      ) : (
        <div className="divide-y divide-gray-50">
          {items.map((w) => {
            const chg = w.day_change != null ? Number(w.day_change) : null;
            const flow = fmtFlowEok(w.foreign_amt_5d);
            const instFlow = fmtFlowEok(w.inst_amt_5d);
            return (
              <div
                key={w.ticker}
                className="px-5 py-3 flex items-center gap-4 hover:bg-blue-50 cursor-pointer"
                onClick={() => onSelect({ ticker: w.ticker, name: w.name, market: w.market, sector: w.sector, total_score: w.total_score })}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{w.name}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {w.ticker} · {w.market}{w.memo ? ` · ${w.memo}` : ''}
                  </p>
                </div>
                {(flow || instFlow) && (
                  <span className="text-xs text-gray-500 shrink-0 hidden sm:block" title="외인/기관 5일 순매수 금액">
                    {flow && <span className={Number(w.foreign_amt_5d) > 0 ? 'text-red-500' : 'text-blue-500'}>외 {flow}</span>}
                    {flow && instFlow && ' · '}
                    {instFlow && <span className={Number(w.inst_amt_5d) > 0 ? 'text-red-500' : 'text-blue-500'}>기 {instFlow}</span>}
                  </span>
                )}
                {w.last_close != null && (
                  <div className="text-right shrink-0 w-24">
                    <p className="text-sm font-medium text-gray-900">{Number(w.last_close).toLocaleString('ko-KR')}</p>
                    {chg != null && (
                      <p className={`text-xs ${chg >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                        {chg >= 0 ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}%
                      </p>
                    )}
                  </div>
                )}
                <ScoreBadge score={w.total_score} />
                <button
                  onClick={(e) => { e.stopPropagation(); remove.mutate(w.ticker); }}
                  title="관심종목에서 제거"
                  className="text-red-400 hover:text-gray-300 text-base leading-none shrink-0"
                >
                  ♥
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface EventDisclosure {
  rcept_no: string;
  rcept_dt: string;
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
  report_nm: string;
  event_type: 'exclusion' | 'penalty' | 'bonus';
  score_delta: number;
  detail: string | null;
  total_score: number | null;
  url: string;
}

/** 최근 7일 이벤트 공시 피드 (점수에 반영된 공시만) */
function DisclosureFeedCard({ onSelect }: { onSelect: (s: TopStock) => void }) {
  const { data: items = [] } = useQuery<EventDisclosure[]>({
    queryKey: ['signals', 'disclosures'],
    queryFn: () => apiClient.get(API.signals.disclosures).then((r) => r.data),
    staleTime: 10 * 60 * 1000,
  });
  if (items.length === 0) return null;

  return (
    <div className="bg-surface rounded-xl border border-gray-200 mb-8">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">📢 이벤트 공시</h3>
        <span className="text-xs text-gray-400">최근 7일 · 점수 반영분 (DART)</span>
      </div>
      <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
        {items.map((d) => (
          <div
            key={d.rcept_no}
            className="px-5 py-2.5 flex items-center gap-3 hover:bg-blue-50 cursor-pointer"
            onClick={() => onSelect({ ticker: d.ticker, name: d.name, market: d.market, sector: d.sector, total_score: d.total_score })}
          >
            <span className="text-xs text-gray-400 shrink-0 w-12">{d.rcept_dt.slice(5)}</span>
            <span className={`shrink-0 text-[10px] font-medium rounded px-1.5 py-0.5 ${
              d.event_type === 'exclusion' ? 'bg-red-50 text-red-600' :
              d.event_type === 'penalty' ? 'bg-amber-50 text-amber-700' :
              'bg-emerald-50 text-emerald-700'
            }`}>
              {d.event_type === 'exclusion' ? '🚫 제외' : `${d.score_delta > 0 ? '+' : ''}${d.score_delta}점`}
            </span>
            <span className="text-sm font-medium text-gray-900 shrink-0">{d.name}</span>
            <a
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="DART 공시 원문 보기"
              className="text-xs text-gray-500 truncate flex-1 hover:text-blue-600 hover:underline"
            >
              {d.detail ?? d.report_nm} ↗
            </a>
            <ScoreBadge score={d.total_score} />
          </div>
        ))}
      </div>
    </div>
  );
}

interface SurpriseItem {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
  fiscalYear: number;
  fiscalQuarter: number;
  detectedAt: string;
  kind: 'beat' | 'miss' | 'inline' | 'turn_positive' | 'turn_negative' | 'deficit';
  surprisePct: number | null;
  revenueSurprisePct: number | null;
  totalScore: number | null;
  changePct: number | null;
}

/** 서프라이즈 1건의 배지 문구 — pct가 없는 전환 사건은 라벨로 대체 */
function surpriseLabel(s: SurpriseItem): string {
  if (s.kind === 'turn_positive') return '흑자전환';
  if (s.kind === 'turn_negative') return '적자전환';
  if (s.surprisePct == null) return '—';
  return `${s.surprisePct > 0 ? '+' : ''}${s.surprisePct.toFixed(1)}%`;
}

function SurpriseRow({ s, onSelect }: { s: SurpriseItem; onSelect: (t: TopStock) => void }) {
  const isUp = s.kind === 'beat' || s.kind === 'turn_positive';
  return (
    <div
      className="px-5 py-2.5 flex items-center gap-3 hover:bg-blue-50 cursor-pointer"
      onClick={() =>
        onSelect({
          ticker: s.ticker,
          name: s.name,
          market: s.market,
          sector: s.sector,
          total_score: s.totalScore,
        })
      }
    >
      {/* 관측일(MM-DD) — 30일 창 안에서 갓 나온 발표와 이미 주가에 반영된 발표를 구분하는 단서 */}
      <span className="text-xs text-gray-400 shrink-0 w-10">{s.detectedAt.slice(5)}</span>
      <span className="text-xs text-gray-400 shrink-0 w-11">
        {s.fiscalYear % 100}.{s.fiscalQuarter}Q
      </span>
      <span
        className={`shrink-0 text-[10px] font-semibold rounded px-1.5 py-0.5 ${
          isUp ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
        }`}
      >
        {surpriseLabel(s)}
      </span>
      <span className="text-sm font-medium text-gray-900 truncate flex-1 min-w-0">{s.name}</span>
      {s.changePct != null && (
        <span className={`text-xs shrink-0 ${s.changePct >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
          {s.changePct >= 0 ? '+' : ''}{s.changePct.toFixed(2)}%
        </span>
      )}
      <ScoreBadge score={s.totalScore} />
    </div>
  );
}

/**
 * 최근 30일 어닝 서프라이즈. 컨센서스가 있는 종목만 대상이고 실적 시즌 사이에는
 * 정상적으로 비어 있으므로, 0건일 때 위젯을 숨기지 않고 대기 문구를 보여준다.
 * 단 API 실패는 "0건"과 다른 사실이므로 로딩·에러를 별도 분기로 표시한다.
 */
function EarningsSurpriseCard({ onSelect }: { onSelect: (s: TopStock) => void }) {
  const { data, isLoading, isError } = useQuery<{ beats: SurpriseItem[]; misses: SurpriseItem[] }>({
    queryKey: ['market', 'earningsSurprises'],
    queryFn: () =>
      apiClient.get(API.market.earningsSurprises, { params: { days: 30, limit: 10 } }).then((r) => r.data),
    staleTime: 10 * 60 * 1000,
  });

  const beats = data?.beats ?? [];
  const misses = data?.misses ?? [];
  // 빈 상태 문구는 "0건"이라는 사실 주장이므로, 실제로 응답이 왔고 0건일 때만 보여준다.
  const isEmpty = !isLoading && !isError && beats.length === 0 && misses.length === 0;

  return (
    <div className="bg-surface rounded-xl border border-gray-200 mb-8">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold text-gray-900">📊 어닝 서프라이즈</h3>
        <span className="text-xs text-gray-400">
          최근 30일 · 컨센서스 보유 종목 대상 · 발표 직전 컨센서스 대비 영업이익
        </span>
      </div>
      {isError ? (
        <div className="p-8 text-center text-red-500 text-sm">
          불러오지 못했습니다 — 서버 응답을 받지 못해 포착 결과를 확인할 수 없습니다.
        </div>
      ) : isLoading ? (
        <div className="p-8 text-center text-gray-400 text-sm">불러오는 중…</div>
      ) : isEmpty ? (
        <div className="p-8 text-center text-gray-400 text-sm">
          이번 분기 발표 대기 — 컨센서스가 있는 종목의 실적이 확정되면 여기에 표시됩니다.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">
          <div>
            <p className="px-5 pt-3 pb-1 text-xs font-medium text-emerald-600">상회</p>
            <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
              {beats.map((s) => (
                <SurpriseRow key={`${s.ticker}-${s.fiscalYear}-${s.fiscalQuarter}`} s={s} onSelect={onSelect} />
              ))}
              {beats.length === 0 && <div className="px-5 py-4 text-xs text-gray-400">해당 없음</div>}
            </div>
          </div>
          <div>
            <p className="px-5 pt-3 pb-1 text-xs font-medium text-red-500">하회</p>
            <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
              {misses.map((s) => (
                <SurpriseRow key={`${s.ticker}-${s.fiscalYear}-${s.fiscalQuarter}`} s={s} onSelect={onSelect} />
              ))}
              {misses.length === 0 && <div className="px-5 py-4 text-xs text-gray-400">해당 없음</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  const s = score ?? 0;
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${scoreColorClass(s)}`}>{s}점</span>;
}

interface DataFreshness {
  latestTradeDate: string | null;
  businessDaysBehind: number | null;
}

/**
 * 데이터 신선도·휴장 구분 배지 — fail-soft 수집 실패 시 옛 데이터가 조용히
 * 서빙되는 문제 보완. 평상시(≤1영업일 지연, 휴장 다음날 포함)엔 회색 텍스트,
 * 그 이상 밀리면 amber 경고로 /data 수집 확인을 유도한다.
 */
function FreshnessBadge({ freshness }: { freshness: DataFreshness | undefined }) {
  if (!freshness?.latestTradeDate) return null;
  const behind = freshness.businessDaysBehind ?? 0;

  if (behind >= FRESHNESS_WARN_THRESHOLD_BUSINESS_DAYS) {
    return (
      <Link
        to="/data"
        title="주말만 제외한 근사치입니다 — 긴 연휴로 인한 지연이면 정상, 아니면 수집 상태를 확인하세요"
        className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 hover:bg-amber-100 transition-colors"
      >
        ⚠️ 데이터 {behind}영업일 지연 — 휴장 아니면 /data에서 수집 확인
      </Link>
    );
  }

  return (
    <span className="text-xs text-gray-400">
      데이터: {freshness.latestTradeDate.slice(5)} 기준
    </span>
  );
}

export function DashboardPage() {
  const [selected, setSelected] = useState<TopStock | null>(null);
  const [symbolPanel, setSymbolPanel] = useState<string | null>(null);
  const [isRegimeHelpOpen, setIsRegimeHelpOpen] = useState(false);

  const { data: indices } = useQuery<Record<string, IndexQuote>>({
    queryKey: ['market', 'indices'],
    queryFn: () => apiClient.get(API.market.indices).then(r => r.data),
    refetchInterval: 60 * 1000, // 1분마다 자동 갱신
    staleTime: 50 * 1000,
  });

  const { data: topStocks = [], isLoading } = useQuery<TopStock[]>({
    queryKey: ['scoring', 'top'],
    queryFn: () => apiClient.get(API.scoring.top).then((r) => r.data),
  });

  const { data: summary } = useQuery<{ scores: number; freshness?: DataFreshness }>({
    queryKey: ['data', 'summary'],
    queryFn: () => apiClient.get(API.data.summary).then((r) => r.data),
  });

  const { data: regime = [] } = useQuery<Array<{
    date: string;
    kospi_chg: number | string | null;
    kospi_up: number | null;
    kospi_down: number | null;
    ks_foreign_bn: number | string | null;
    ks_inst_bn: number | string | null;
    rotation_signal: string | null;
    note: string | null;
  }>>({
    queryKey: ['market', 'regime'],
    queryFn: () => apiClient.get(API.market.regime).then((r) => r.data),
    refetchInterval: () => (isKstMarketOpen() ? 90 * 1000 : false), // 장중 서버가 90초 스로틀로 재계산 → 장중에만 폴링으로 반영
    staleTime: 80 * 1000,
  });
  const latestRegime = regime[0];
  const fmtBn = (v: number | string | null) => {
    if (v == null) return '—';
    const n = Number(v);
    return `${n >= 0 ? '+' : ''}${n.toLocaleString('ko-KR')}억`;
  };

  return (
    <div className="p-6">
      {/* 데이터 미수집 안내 배너 */}
      {summary != null && summary.scores === 0 && (
        <div className="mb-6 flex items-center justify-between gap-4 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
          <div>
            <p className="text-sm font-medium text-amber-800">아직 수집된 데이터가 없습니다</p>
            <p className="text-xs text-amber-600 mt-0.5">
              재무·시세 데이터를 수집해야 종목 점수가 계산됩니다. 첫 수집은 2~3분이면 끝나요.
            </p>
          </div>
          <Link
            to="/data"
            className="shrink-0 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors"
          >
            데이터 수집하기 →
          </Link>
        </div>
      )}
      {/* fallback이 null인 이유: 청크를 받는 짧은 사이에 자리표시를 띄우면 모달이 두 번
          깜빡이는 것처럼 보인다. 대신 아무것도 그리지 않고 준비되면 바로 연다. */}
      {selected && (
        <Suspense fallback={null}>
          <StockDetailPanel
            ticker={selected.ticker}
            name={selected.name}
            market={selected.market}
            sector={selected.sector}
            totalScore={selected.total_score}
            onClose={() => setSelected(null)}
          />
        </Suspense>
      )}
      {symbolPanel && (
        <Suspense fallback={null}>
          <SymbolChartPanel symbol={symbolPanel} onClose={() => setSymbolPanel(null)} />
        </Suspense>
      )}
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xl font-bold text-gray-900">대시보드</h2>
        {(() => {
          const asOf = indices?.kospi?.asOf ?? indices?.kosdaq?.asOf ?? null;
          if (!asOf) return null;
          const t = new Date(asOf);
          // 한국 장 개장(평일 09:00~15:30 KST) 기준 판정 — Yahoo 지수 시각이 20분가량 지연돼
          // 시각 차이로는 오판하므로 개장시간을 직접 계산
          const kst = new Date(Date.now() + 9 * 3600 * 1000);
          const dow = kst.getUTCDay();
          const mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
          const open = dow >= 1 && dow <= 5 && mins >= 9 * 60 && mins <= 15 * 60 + 30;
          return (
            <span className="text-xs text-gray-400">
              {open && <span className="text-red-500">● </span>}
              지수 {open ? '장중' : '장마감'} · {t.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준
            </span>
          );
        })()}
      </div>

      {/* 시장 지표 한눈 보기 — 지수·선물·금리·거시를 격자로. 타일 클릭 → 심볼 차트 (2026-08-04 재구성).
          이전에는 가로 스크롤 스트립 두 줄이라 항목이 늘수록 화면 밖으로 밀려 "한눈에"가 되지 않았다. */}
      <div className="mb-4">
        <MarketIndicatorGrid onSelectSymbol={setSymbolPanel} />
      </div>

      {/* 데이터 신선도 배지 — 시장 색깔 카드 바로 위, fail-soft 스테일 데이터 조용한 서빙 보완 */}
      {summary?.freshness?.latestTradeDate && (
        <div className="mb-2">
          <FreshnessBadge freshness={summary.freshness} />
        </div>
      )}

      {/* 시장 색깔 */}
      {latestRegime && (
        <div className="bg-surface rounded-xl p-4 border border-gray-200 mb-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="text-sm font-semibold text-gray-900">
              시장 색깔 {latestRegime.rotation_signal || '⬜'}
              <button
                type="button"
                aria-label="시장 색깔 설명"
                onClick={() => setIsRegimeHelpOpen((open) => !open)}
                className="ml-1 text-gray-400 hover:text-gray-600 align-middle"
              >
                ⓘ
              </button>
              {latestRegime.note?.includes('장중') && (
                <span className="ml-1.5 text-[10px] font-medium text-red-500 bg-red-50 rounded px-1.5 py-0.5 align-middle">
                  ● 장중
                </span>
              )}
              <span className="ml-1.5 text-xs font-normal text-gray-400">
                {latestRegime.date}
              </span>
            </span>
            <span className="text-xs text-gray-600">
              상승 {latestRegime.kospi_up ?? '—'} / 하락 {latestRegime.kospi_down ?? '—'}
            </span>
            <span className="text-xs text-gray-600">
              외인 {fmtBn(latestRegime.ks_foreign_bn)} · 기관 {fmtBn(latestRegime.ks_inst_bn)}
            </span>
            {regime.length > 1 && (
              <span className="text-xs text-gray-400 ml-auto" title="최근 순환매 판정 (오래된 → 최신)">
                {[...regime].reverse().map((r) => r.rotation_signal || '⬜').join(' ')}
              </span>
            )}
          </div>
          {latestRegime.note && (
            <p className="text-xs text-gray-400 mt-1.5">{latestRegime.note}</p>
          )}
          {isRegimeHelpOpen && (
            <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 mt-2 flex flex-col gap-1">
              <span>🟨 분산 — 상승 종목 55% 이상: 폭넓은 참여, 순환매 국면 (온기가 여러 업종으로 확산)</span>
              <span>🟦 쏠림 — 소수 주도·혼조: 참여 폭이 좁음 (주도주 위주 장세)</span>
              <span>🟥 하락 우위 — KOSPI 하락 + 상승 비율 45% 미만: 방어적 국면</span>
              <span>⬜ 데이터 부족</span>
              <span className="border-t border-gray-200 pt-1 mt-1">
                판정 근거: KOSPI 등락 + 상승/하락 종목 수. 장중엔 SF가 실시간 재계산(● 장중 배지), 마감 후 확정.
                오른쪽 색 나열은 최근 일자별 판정 이력(왼쪽=과거 → 오른쪽=최신).
              </span>
            </div>
          )}
        </div>
      )}

      {/* 오늘의 특징주 + 알고리즘 추천 종목 — 첫 화면 안에 나란히 (lg 미만은 1열 스택) */}
      <div className="grid lg:grid-cols-2 gap-4 mb-8 items-start">
        {/* 오늘의 특징주 (거래대금·급등·52주 신고가 — 60초 갱신) — min-w-0: 내용 폭이 그리드를 밀어내지 않도록 */}
        <div className="min-w-0">
          <MoversCard onSelect={setSelected} />
        </div>

        {/* 알고리즘 TOP 종목 */}
        <div className="min-w-0 bg-surface rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">알고리즘 추천 종목</h3>
            <span className="text-xs text-gray-400">복합 팩터 기반</span>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-gray-400 text-sm">로딩 중...</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {topStocks.slice(0, 10).map((stock, idx) => (
                <div key={stock.ticker} className="px-5 py-3 flex items-center gap-4 hover:bg-blue-50 cursor-pointer" onClick={() => setSelected(stock)}>
                  <span className="text-sm font-bold text-gray-400 w-5">{idx + 1}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{stock.name}</p>
                    <p className="text-xs text-gray-400">{stock.ticker} · {stock.market}</p>
                  </div>
                  <ScoreBadge score={stock.total_score} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 산업 국면 (ETF 차트보드 요약) */}
      <EtfPhaseStrip />

      {/* 관심종목 */}
      <WatchlistCard onSelect={setSelected} />

      {/* 시장 주요뉴스 (뉴스 피드 — 2분 갱신) */}
      <NewsCard />

      {/* 이벤트 공시 피드 */}
      <DisclosureFeedCard onSelect={setSelected} />
      <EarningsSurpriseCard onSelect={setSelected} />

      {/* 투자 경고 */}
      <p className="text-xs text-gray-400 mt-6 text-center">
        ⚠️ 이 플랫폼의 점수는 투자 권유가 아닌 참고 자료입니다. 최종 투자 결정은 본인의 책임입니다.
      </p>
    </div>
  );
}
