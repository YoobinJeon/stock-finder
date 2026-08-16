import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { StockDetailPanel } from '../shared/components/StockDetailPanel';
import { scoreColorClass } from '../shared/lib/scoreGrade';

interface Signal {
  ticker: string;
  type:
    | 'golden_cross' | 'high_52w' | 'foreign_streak' | 'dual_flow'
    | 'volume_surge_high' | 'inst_new_accum' | 'rs_top_entry';
  detail: Record<string, any> | string;
  name: string;
  market: string;
  sector: string | null;
  market_cap: number | string | null;
  total_score: number | null;
  last_close: number | string | null;
  day_change: number | string | null;
}

interface SignalsResponse {
  date: string | null;
  signals: Signal[];
}

/** 종목 상세 패널을 열기 위한 최소 정보 — Signal·스크리너 결과·시그널 이력 3곳에서 공용 */
interface SelectedStock {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
  total_score: number | null;
}

interface ScreenerPreset {
  id: string;
  name: string;
  description: string | null;
  criteria: Record<string, unknown>;
  is_builtin: boolean;
}

interface ScreenerMatchRow {
  ticker: string;
  name: string;
  market: string;
  sector: string;
  total_score: number | null;
}

interface ScreenerMatchResponse {
  data: ScreenerMatchRow[];
  total: number;
}

const PRESET_MATCH_PAGE_SIZE = 8;

interface SignalHistoryItem {
  ticker: string;
  name: string;
  market: string;
  signal_date: string;
  base_close: number | string | null;
  last_close: number | string | null;
  latest_date: string | null;
  days: number | null;
  ret: number | null;
  hit: boolean | null;
}

interface SignalHistoryResponse {
  type: string;
  count: number;
  items: SignalHistoryItem[];
}

/** 고정 보유기간(5거래일·20거래일) 기준 수익률 통계 — n=표본수(기간 도래분만) */
interface ReturnStats {
  n: number;
  avgRet: number;
  winRate: number;
}

interface SignalTypePerformance {
  type: string;
  count: number;
  ret5d: ReturnStats;
  ret20d: ReturnStats;
  pending5d: number;
  pending20d: number;
}

interface SignalsPerformanceResponse {
  sample: number;
  performance: SignalTypePerformance[];
}

const TYPE_META: Record<Signal['type'], { icon: string; title: string; desc: string }> = {
  golden_cross:      { icon: '🌟', title: '골든크로스 발생',     desc: 'MA20이 MA60을 상향 돌파 (기준일)' },
  high_52w:          { icon: '🚀', title: '52주 신고가 경신',    desc: '종가가 기존 52주 최고가 이상' },
  foreign_streak:    { icon: '🌍', title: '외국인 연속 순매수',   desc: '5거래일 이상 연속 순매수' },
  dual_flow:         { icon: '🤝', title: '쌍끌이 수급',         desc: '외국인·기관 동반 순매수 (5일·20일 모두)' },
  volume_surge_high: { icon: '💥', title: '대량거래 신고가 접근', desc: '거래대금 3배 이상 급증 + 52주 고점 대비 -3% 이내' },
  inst_new_accum:    { icon: '🏦', title: '기관 신규 매집',      desc: '기관 5일 순매수 전환 (20일 누적은 아직 순매도)' },
  rs_top_entry:      { icon: '📈', title: 'RS 상위 진입',        desc: '통합 RS 백분위가 상위 10%(≥90) 진입' },
};

const TYPE_ORDER: Signal['type'][] = [
  'golden_cross', 'high_52w', 'foreign_streak', 'dual_flow',
  'volume_surge_high', 'inst_new_accum', 'rs_top_entry',
];

/** 시그널 섹션 기본 표시 개수 — 초과분은 "전체 보기" 토글로 펼침 (페이지 스크롤 폭증 방지) */
const SIGNAL_PREVIEW_COUNT = 10;

function parseDetail(d: Signal['detail']): Record<string, any> {
  if (typeof d === 'string') {
    try { return JSON.parse(d); } catch { return {}; }
  }
  return d ?? {};
}

function fmtMan(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const man = Math.abs(n) / 1e4;
  return `${n >= 0 ? '+' : '-'}${man >= 100 ? man.toFixed(0) : man.toFixed(1)}만주`;
}

/** 순매수 금액(원) → "+132억" (구버전 시그널은 주식수로 폴백) */
function fmtAmt(amt: unknown, sharesFallback: unknown): string {
  const n = Number(amt);
  if (Number.isFinite(n) && amt != null) {
    const abs = Math.abs(n);
    const sign = n >= 0 ? '+' : '-';
    if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}조`;
    const eok = abs / 1e8;
    return `${sign}${eok >= 100 ? eok.toFixed(0) : eok.toFixed(1)}억`;
  }
  return fmtMan(sharesFallback);
}

function detailText(s: Signal): string {
  const d = parseDetail(s.detail);
  switch (s.type) {
    case 'golden_cross':
      return `MA20 ${Number(d.ma20).toLocaleString()} > MA60 ${Number(d.ma60).toLocaleString()}`;
    case 'high_52w':
      return `종가 ${Number(d.close).toLocaleString()}원 (기존 고점 ${Number(d.prev_high).toLocaleString()}원)`;
    case 'foreign_streak':
      return `${d.streak}일 연속 · 5일 합 ${fmtAmt(d.foreign_5d_amt, d.foreign_5d)}`;
    case 'dual_flow':
      return `외인 ${fmtAmt(d.foreign_5d_amt, d.foreign_5d)} · 기관 ${fmtAmt(d.inst_5d_amt, d.inst_5d)} (5일)`;
    case 'volume_surge_high':
      return `거래대금 ${Number(d.turnover_surge).toFixed(1)}배 · 고점 대비 ${Number(d.pct_from_52w_high).toFixed(1)}%`;
    case 'inst_new_accum':
      return `기관 5일 ${fmtAmt(d.inst_5d_amt, null)} (20일 누적 ${fmtAmt(d.inst_20d_amt, null)})`;
    case 'rs_top_entry':
      return `RS 백분위 ${Number(d.rs_percentile).toFixed(1)} (직전 ${Number(d.rs_percentile_prev).toFixed(1)})`;
    default:
      return '';
  }
}

/** 카톡/슬랙 공유용 텍스트 생성 */
function buildShareText(date: string, signals: Signal[]): string {
  const lines: string[] = [`📡 Stock Finder 시그널 (${date} 기준)`];
  for (const type of TYPE_ORDER) {
    const items = signals.filter((s) => s.type === type);
    if (items.length === 0) continue;
    const meta = TYPE_META[type];
    lines.push('', `${meta.icon} ${meta.title} (${items.length}종목)`);
    for (const s of items.slice(0, 10)) {
      const score = s.total_score != null ? ` ${s.total_score}점` : '';
      lines.push(`· ${s.name}${score} — ${detailText(s)}`);
    }
    if (items.length > 10) lines.push(`  … 외 ${items.length - 10}종목`);
  }
  lines.push('', '⚠️ 투자 권유가 아닌 참고 자료입니다.');
  return lines.join('\n');
}

interface ReturnStatBlockProps {
  label: string;
  stats: ReturnStats;
  pending: number;
}

/** 적중률 카드 내 5일/20일 서브 블록 — 표본 없으면 "—", pending은 회색 작은 글씨로 별도 표시 */
function ReturnStatBlock({ label, stats, pending }: ReturnStatBlockProps) {
  return (
    <div>
      <p className="text-[10px] text-gray-400">{label}</p>
      {stats.n === 0 ? (
        <p className="text-base font-bold text-gray-300">—</p>
      ) : (
        <p className={`text-base font-bold ${stats.avgRet >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
          {stats.avgRet >= 0 ? '+' : ''}{stats.avgRet.toFixed(2)}%
        </p>
      )}
      <p className="text-[10px] text-gray-400">
        {stats.n === 0 ? '표본 없음' : `승률 ${stats.winRate}% · ${stats.n}건`}
      </p>
      {pending > 0 && <p className="text-[10px] text-gray-300">집계 대기 {pending}건</p>}
    </div>
  );
}

export function SignalsPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<SelectedStock | null>(null);
  const [copied, setCopied] = useState(false);
  const [expandedType, setExpandedType] = useState<Signal['type'] | null>(null);
  // 하단 시그널 섹션별 "전체 보기" 펼침 상태 — 타입별 독립, 불변 업데이트(Set 재생성)
  const [expandedSignalTypes, setExpandedSignalTypes] = useState<Set<Signal['type']>>(new Set());

  const toggleSignalTypeExpanded = (type: Signal['type']) => {
    setExpandedSignalTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const { data, isLoading } = useQuery<SignalsResponse>({
    queryKey: ['signals'],
    queryFn: () => apiClient.get(API.signals.latest).then((r) => r.data),
  });

  const { data: perf } = useQuery<SignalsPerformanceResponse>({
    queryKey: ['signals', 'performance'],
    queryFn: () => apiClient.get(API.signals.performance).then((r) => r.data),
  });

  const { data: history, isLoading: historyLoading } = useQuery<SignalHistoryResponse>({
    queryKey: ['signals', 'history', expandedType],
    queryFn: () => apiClient.get(API.signals.history(expandedType as string)).then((r) => r.data),
    enabled: expandedType != null,
  });

  // 전략(스크리너 프리셋)별 현재 편입 종목 — 기존 스크리너 검색 API 재사용(프리셋 수만큼 병렬 조회)
  const { data: presets = [] } = useQuery<ScreenerPreset[]>({
    queryKey: ['screener', 'presets'],
    queryFn: () => apiClient.get(API.screener.presets).then((r) => r.data),
  });
  const presetMatchQueries = useQueries({
    queries: presets.map((p) => ({
      queryKey: ['screener', 'presetMatch', p.id],
      queryFn: () =>
        apiClient
          .post(API.screener.search, {
            ...p.criteria,
            sort: 'score',
            order: 'desc',
            page: 1,
            pageSize: PRESET_MATCH_PAGE_SIZE,
          })
          .then((r) => r.data as ScreenerMatchResponse),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const date = data?.date ?? null;
  const signals = data?.signals ?? [];

  const copyShareText = async () => {
    if (!date) return;
    await navigator.clipboard.writeText(buildShareText(date, signals));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 max-w-5xl">
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

      <div className="flex items-start justify-between gap-4 mb-1">
        <h2 className="text-xl font-bold text-gray-900">오늘의 시그널</h2>
        {date && signals.length > 0 && (
          <button
            onClick={copyShareText}
            className="shrink-0 text-sm px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            {copied ? '✅ 복사됨!' : '📋 공유용 텍스트 복사'}
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-6">
        {date ? `${date} 기준 · 데이터 수집 시 자동 감지` : '데이터 수집 후 자동으로 감지됩니다'}
        {' '}· 복사한 텍스트를 카톡/슬랙에 그대로 붙여넣어 공유하세요
      </p>

      {/* 전략(스크리너 프리셋)별 현재 편입 종목 — "여러 스크리너가 보였으면" 피드백 */}
      <div className="bg-surface rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2 mb-3">
          <h3 className="font-semibold text-gray-900 text-sm shrink-0">🎯 전략별 현재 편입 종목</h3>
          <span className="text-xs text-gray-400">
            등록된 스크리너 전략 조건에 지금 매칭되는 종목 (점수순 상위 {PRESET_MATCH_PAGE_SIZE}종목) · [전략 관리]에서 편집
          </span>
        </div>
        {presets.length === 0 ? (
          <p className="text-xs text-gray-400">등록된 전략이 없습니다. [전략 관리] 메뉴에서 스크리닝 전략을 만들어보세요.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {presets.map((p, idx) => {
              const q = presetMatchQueries[idx];
              const matches = q?.data?.data ?? [];
              const total = q?.data?.total ?? 0;
              return (
                <div key={p.id} className="border border-gray-100 rounded-lg px-3 py-2.5">
                  {/* 전략 헤더 클릭 → 스크리너에 해당 전략 조건 적용 (StrategiesPage "적용"과 동일 동선) */}
                  <button
                    type="button"
                    onClick={() => navigate('/screener', { state: { presetId: p.id } })}
                    title={`스크리너에서 "${p.name}" 조건으로 전체 보기`}
                    className="w-full flex items-center justify-between gap-2 text-left rounded hover:bg-blue-50/60 -mx-1 px-1 py-0.5 group"
                  >
                    <p className="text-xs font-medium text-gray-700 truncate group-hover:text-blue-700">
                      {p.name}
                      {p.is_builtin && (
                        <span className="ml-1.5 text-[10px] font-normal text-gray-400 border border-gray-200 rounded px-1 py-0.5">기본</span>
                      )}
                    </p>
                    <span className="shrink-0 text-[11px] font-bold text-blue-600 group-hover:underline">
                      {q?.isLoading ? '…' : `${total}종목 ›`}
                    </span>
                  </button>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {q?.isLoading ? (
                      <span className="text-[11px] text-gray-300">불러오는 중…</span>
                    ) : matches.length === 0 ? (
                      <span className="text-[11px] text-gray-300">현재 편입 없음</span>
                    ) : (
                      <>
                        {matches.map((m) => (
                          <button
                            key={m.ticker}
                            onClick={() =>
                              setSelected({
                                ticker: m.ticker,
                                name: m.name,
                                market: m.market,
                                sector: m.sector ?? null,
                                total_score: m.total_score,
                              })
                            }
                            className="text-[11px] bg-blue-50 text-blue-700 border border-blue-100 rounded px-1.5 py-0.5 hover:bg-blue-100"
                          >
                            {m.name}
                          </button>
                        ))}
                        {total > matches.length && (
                          <button
                            type="button"
                            onClick={() => navigate('/screener', { state: { presetId: p.id } })}
                            title={`스크리너에서 "${p.name}" 조건으로 전체 ${total}종목 보기`}
                            className="text-[11px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200"
                          >
                            +{total - matches.length}종목
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 시그널 적중률 (과거 시그널의 발생일 → 현재 수익률) — 카드 클릭 시 발생 내역 펼침 */}
      <div className="bg-surface rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2 mb-3">
          <h3 className="font-semibold text-gray-900 text-sm shrink-0">📈 시그널 적중률</h3>
          <span className="text-xs text-gray-400">
            시그널 발생일 종가 → 5거래일/20거래일 후 종가 수익률(고정 보유기간) · 매일 수집이
            쌓일수록 표본이 늘어납니다 · 카드를 클릭하면 발생 내역이 보입니다
          </span>
        </div>
        {perf == null || perf.sample === 0 ? (
          <p className="text-xs text-gray-400">
            아직 표본이 없습니다. 오늘 잡힌 시그널의 성과는 다음 거래일 수집부터 집계됩니다.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {perf.performance.map((p) => {
              const type = p.type as Signal['type'];
              const meta = TYPE_META[type];
              const active = expandedType === type;
              return (
                <button
                  key={p.type}
                  onClick={() => setExpandedType((t) => (t === type ? null : type))}
                  className={`text-left border rounded-lg px-3 py-2.5 transition-colors ${
                    active ? 'border-blue-300 bg-blue-50' : 'border-gray-100 hover:bg-gray-50'
                  }`}
                >
                  <p className="text-xs font-medium text-gray-700">{meta ? `${meta.icon} ${meta.title}` : p.type}</p>
                  <div className="grid grid-cols-2 gap-2 mt-1.5">
                    <ReturnStatBlock label="5일" stats={p.ret5d} pending={p.pending5d} />
                    <ReturnStatBlock label="20일" stats={p.ret20d} pending={p.pending20d} />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {expandedType && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-700">
                {TYPE_META[expandedType].icon} {TYPE_META[expandedType].title} 발생 내역
              </p>
              <button onClick={() => setExpandedType(null)} className="text-xs text-gray-400 hover:text-gray-600">
                닫기 ✕
              </button>
            </div>
            {historyLoading ? (
              <p className="text-xs text-gray-400 py-4 text-center">불러오는 중…</p>
            ) : !history || history.items.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">발생 이력이 없습니다.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                {history.items.map((h) => (
                  <div
                    key={`${h.ticker}-${h.signal_date}`}
                    className="flex items-center gap-3 py-2 px-1 hover:bg-blue-50 cursor-pointer rounded"
                    onClick={() =>
                      setSelected({ ticker: h.ticker, name: h.name, market: h.market, sector: null, total_score: null })
                    }
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900">
                        {h.name} <span className="text-gray-400">{h.ticker}</span>
                      </p>
                      <p className="text-[11px] text-gray-400">{h.signal_date} 발생</p>
                    </div>
                    {h.ret != null ? (
                      <span className={`shrink-0 text-xs font-semibold ${h.ret >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                        {h.ret >= 0 ? '+' : ''}{h.ret.toFixed(1)}% ({h.days}일)
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-gray-300">집계 대기</span>
                    )}
                    {h.hit != null && (
                      <span
                        className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          h.hit ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                        }`}
                      >
                        {h.hit ? '적중' : '실패'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 py-10 text-center">불러오는 중…</p>
      ) : signals.length === 0 ? (
        <div className="bg-surface rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">
          감지된 시그널이 없습니다. [데이터] 메뉴에서 수집을 실행하면 골든크로스·신고가·수급 시그널이 자동으로 잡힙니다.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {TYPE_ORDER.map((type) => {
            const items = signals.filter((s) => s.type === type);
            if (items.length === 0) return null;
            const meta = TYPE_META[type];
            const isExpanded = expandedSignalTypes.has(type);
            const hasMore = items.length > SIGNAL_PREVIEW_COUNT;
            const visibleItems = isExpanded ? items : items.slice(0, SIGNAL_PREVIEW_COUNT);
            return (
              <div key={type} className="bg-surface rounded-xl border border-gray-200">
                <div className="px-5 py-3 border-b border-gray-100 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-semibold text-gray-900 shrink-0">{meta.icon} {meta.title}</h3>
                    <span className="text-xs font-medium text-gray-500 sm:hidden">{items.length}종목</span>
                  </div>
                  <span className="text-xs text-gray-400">{meta.desc}</span>
                  <span className="hidden sm:inline sm:ml-auto text-xs font-medium text-gray-500">{items.length}종목</span>
                </div>
                <div className={isExpanded ? 'max-h-[32rem] overflow-y-auto divide-y divide-gray-50' : 'divide-y divide-gray-50'}>
                  {visibleItems.map((s) => {
                    const chg = s.day_change != null ? Number(s.day_change) : null;
                    return (
                      <div
                        key={`${s.ticker}-${s.type}`}
                        className="px-5 py-3 flex items-center gap-4 hover:bg-blue-50 cursor-pointer"
                        onClick={() => setSelected(s)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">
                            {s.name}
                            <span className="ml-2 text-xs text-gray-400">{s.ticker} · {s.market}</span>
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">{detailText(s)}</p>
                        </div>
                        {s.last_close != null && (
                          <div className="text-right shrink-0">
                            <p className="text-sm text-gray-800">{Number(s.last_close).toLocaleString()}원</p>
                            {chg != null && (
                              <p className={`text-xs ${chg >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                                {chg >= 0 ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}%
                              </p>
                            )}
                          </div>
                        )}
                        {s.total_score != null && (
                          <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${scoreColorClass(s.total_score)}`}>
                            {s.total_score}점
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {hasMore && (
                  <button
                    type="button"
                    onClick={() => toggleSignalTypeExpanded(type)}
                    className="w-full py-2.5 text-xs font-medium text-blue-600 hover:bg-blue-50 border-t border-gray-100"
                  >
                    {isExpanded ? '상위 10종목만 보기 ▴' : `전체 ${items.length}종목 보기 ▾`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
