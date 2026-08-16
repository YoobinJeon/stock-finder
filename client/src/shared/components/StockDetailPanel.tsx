import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useEscapeKey } from '../lib/useEscapeKey';
import { API } from '../api/endpoints';
import { SECTION_CLASS } from '../lib/panelSection';
import { CandleChart } from './CandleChart';
import { CreditBalanceSection } from './CreditBalanceSection';
import { ValuationBands } from './ValuationBands';
import {
  toNum,
  fmtKrw,
  fmtPer,
  fmtDecimal,
  fmtPercent,
  opMargin,
} from '../../pages/compare/compareFormat';
import { scoreColorClass } from '../lib/scoreGrade';
import { GuidanceTable, type GuidanceColumn } from './GuidanceTable';

interface Props {
  ticker: string;
  name: string;
  market: string;
  sector?: string | null;
  totalScore?: number | null;
  onClose: () => void;
}

interface EngineResult {
  id: string;
  name: string;
  category: string;
  weight: number;
  score: number;
  reasons?: string[];
  /** 'coverage_info' 행에만 존재 — 데이터 확보 엔진 수 / 전체 엔진 수 */
  coverage?: { available: number; total: number };
}

interface ScoreDetail {
  ticker: string;
  total_score: number | string | null;
  breakdown: EngineResult[] | string | null;
  scored_at: string;
}

/** 컨센서스 추정 1개년 — /stocks/:ticker 응답의 estimates[] 원소(fiscal_year ASC, 최대 3개년). */
interface EstimateYear {
  fiscal_year: number;
  revenue: number | string | null;
  operating_income: number | string | null;
  net_income: number | string | null;
  eps: number | string | null;
  per: number | string | null;
  roe: number | string | null;
  op_margin: number | string | null;
  net_margin: number | string | null;
  revenue_growth: number | string | null;
}

/**
 * 분기 컨센서스 1건 — /stocks/:ticker 응답의 quarterlyEstimates[] 원소(fiscal_year·fiscal_quarter
 * ASC, 최근 확정 4개 + 추정 전부(최대 4개)). is_estimate로 확정(A)/추정(E)을 구분한다.
 */
interface QuarterlyEstimate {
  fiscal_year: number;
  fiscal_quarter: number;
  is_estimate: boolean;
  revenue: number | string | null;
  operating_income: number | string | null;
  net_income: number | string | null;
  per: number | string | null;
  roe: number | string | null;
  op_margin: number | string | null;
  net_margin: number | string | null;
  revenue_growth: number | string | null;
}

/**
 * 어닝 서프라이즈 1건 — /stocks/:ticker 응답의 earningsSurprises[] 원소.
 * (fiscal_year, fiscal_quarter)로 분기표 열과 매칭한다.
 */
interface EarningsSurprise {
  fiscal_year: number;
  fiscal_quarter: number;
  surprise_pct: number | string | null;
  revenue_surprise_pct: number | string | null;
  kind: 'beat' | 'miss' | 'inline' | 'turn_positive' | 'turn_negative' | 'deficit';
  detected_at: string;
}

/** GET /stocks/:ticker 응답 — /compare와 동일한 LATERAL 조인 필드 + 기업개요(business_summary). */
interface StockDetailRow {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
  industry: string | null;
  market_cap: number | string | null;
  business_summary: string | null;
  fiscal_year: number | null;
  revenue: number | string | null;
  operating_income: number | string | null;
  net_income: number | string | null;
  per: number | string | null;
  pbr: number | string | null;
  roe: number | string | null;
  debt_ratio: number | string | null;
  div_yield: number | string | null;
  revenue_growth: number | string | null;
  eps_growth: number | string | null;
  ev_ebitda: number | string | null;
  est_fiscal_year: number | null;
  forward_per: number | string | null;
  est_revenue: number | string | null;
  est_operating_income: number | string | null;
  estimates: EstimateYear[] | null;
  quarterlyEstimates: QuarterlyEstimate[] | null;
  earningsSurprises: EarningsSurprise[] | null;
  // 기술 지표
  macd: number | string | null;
  macd_signal: number | string | null;
  macd_hist: number | string | null;
  bb_pctb: number | string | null;
  bb_bandwidth: number | string | null;
  atr_pct: number | string | null;
  obv_trend: number | null;
  turnover_surge: number | string | null;
  f_score: number | null;
  f_score_max: number | null;
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className="text-sm font-semibold text-gray-800">{value}</span>
    </div>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  value:           'bg-blue-400',
  quality:         'bg-emerald-400',
  growth:          'bg-orange-400',
  momentum:        'bg-purple-400',
  tech_innovation: 'bg-pink-400',
  flow:            'bg-cyan-400',
};

function parseBreakdown(raw: ScoreDetail['breakdown']): EngineResult[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return raw;
}

export function StockDetailPanel({ ticker, name, market, sector, totalScore, onClose }: Props) {
  useEscapeKey(onClose);
  const qc = useQueryClient();

  const { data: watchlist = [] } = useQuery<Array<{ ticker: string }>>({
    queryKey: ['watchlist'],
    queryFn: () => apiClient.get(API.watchlist.list).then((r) => r.data),
    staleTime: 60 * 1000,
  });
  const isWatched = watchlist.some((w) => w.ticker === ticker);

  const toggleWatch = useMutation({
    mutationFn: () =>
      isWatched
        ? apiClient.delete(API.watchlist.item(ticker))
        : apiClient.post(API.watchlist.list, { ticker }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist'] }),
  });

  const { data: scoreDetail } = useQuery<ScoreDetail>({
    queryKey: ['scoring', ticker],
    queryFn: () => apiClient.get(API.scoring.detail(ticker)).then((r) => r.data),
  });

  // 시총·재무·밸류에이션·가이던스·기업개요 — /stocks/:ticker 강화 (종목 상세 패널 확장)
  const { data: stockDetail } = useQuery<StockDetailRow>({
    queryKey: ['stock-detail', ticker],
    queryFn: () => apiClient.get(API.stocks.detail(ticker)).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: disclosures = [] } = useQuery<Array<{
    rcept_no: string; rcept_dt: string; report_nm: string;
    event_type: 'exclusion' | 'penalty' | 'bonus' | null;
    score_delta: number; detail: string | null; url: string;
  }>>({
    queryKey: ['disclosures', ticker],
    queryFn: () => apiClient.get(API.stocks.disclosures(ticker)).then((r) => r.data),
    staleTime: 10 * 60 * 1000,
  });

  const { data: news = [] } = useQuery<Array<{
    title: string; press: string; datetime: string; url: string;
  }>>({
    queryKey: ['stock-news', ticker],
    queryFn: () => apiClient.get(API.stocks.news(ticker)).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const breakdown = parseBreakdown(scoreDetail?.breakdown ?? null);
  const total = scoreDetail?.total_score != null
    ? Math.round(Number(scoreDetail.total_score))
    : totalScore != null ? Math.round(Number(totalScore)) : null;
  const coverage = breakdown.find((e) => e.id === 'coverage_info')?.coverage;
  const hasLowCoverage = coverage != null && coverage.available < coverage.total;

  // 기업 개요
  const sectorLabel = stockDetail?.sector ?? sector ?? null;
  const marketCap = toNum(stockDetail?.market_cap ?? null);
  const summaryBullets = (stockDetail?.business_summary ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  // 재무·밸류에이션
  const revenue = toNum(stockDetail?.revenue ?? null);
  const opIncome = toNum(stockDetail?.operating_income ?? null);
  const netIncome = toNum(stockDetail?.net_income ?? null);
  const revenueGrowth = toNum(stockDetail?.revenue_growth ?? null);
  const perVal = toNum(stockDetail?.per ?? null);
  const pbrVal = toNum(stockDetail?.pbr ?? null);
  const roeVal = toNum(stockDetail?.roe ?? null);
  const debtRatioVal = toNum(stockDetail?.debt_ratio ?? null);
  const divYieldVal = toNum(stockDetail?.div_yield ?? null);
  const evEbitdaVal = toNum(stockDetail?.ev_ebitda ?? null);

  // 가이던스 테이블 — 확정 최근연도 1열 + 컨센서스 추정연도(최대 3개년) 열
  // (연도별 값 없는 셀·행 처리는 GuidanceTable이 담당 — "없으면 기입하지 않음")
  const actualColumn: GuidanceColumn | null = stockDetail?.fiscal_year != null
    ? {
        label: `${stockDetail.fiscal_year}`,
        isEstimate: false,
        revenue,
        operatingIncome: opIncome,
        netIncome,
        per: perVal,
        roe: roeVal,
        opMargin: revenue != null && revenue > 0 && opIncome != null ? opIncome / revenue : null,
        netMargin: revenue != null && revenue > 0 && netIncome != null ? netIncome / revenue : null,
        revenueGrowth,
      }
    : null;
  const estimateColumns: GuidanceColumn[] = (stockDetail?.estimates ?? []).map((e) => ({
    label: `${e.fiscal_year}E`,
    isEstimate: true,
    revenue: toNum(e.revenue),
    operatingIncome: toNum(e.operating_income),
    netIncome: toNum(e.net_income),
    per: toNum(e.per),
    roe: toNum(e.roe),
    opMargin: toNum(e.op_margin),
    netMargin: toNum(e.net_margin),
    revenueGrowth: toNum(e.revenue_growth),
  }));
  const guidanceColumns: GuidanceColumn[] = [
    ...(actualColumn ? [actualColumn] : []),
    ...estimateColumns,
  ];

  // 분기별 가이던스 테이블 — 최근 확정 분기 + 추정 분기(서버가 이미 개수 제한·정렬해서 내려줌).
  // 증가율은 GuidanceTable이 "직전 열 대비"로 자동 계산하므로 분기 열에서는 세 지표
  // (매출·영업이익·순이익) 모두 QoQ로 통일한다 — 소스의 revenueGrowth(YOY)를 매출에만 넘기면
  // 매출은 YoY·나머지는 QoQ로 기준이 섞여 의미가 어긋나기 때문에 revenueGrowth는 null로 둔다.
  // 어닝 서프라이즈를 (연도, 분기) 키로 인덱싱해 분기 열 헤더 배지로 주입한다.
  // pct가 없는 전환 사건(흑자전환·적자지속)은 라벨만 보여준다.
  const surpriseByQuarter = new Map(
    (stockDetail?.earningsSurprises ?? []).map((s) => [`${s.fiscal_year}-${s.fiscal_quarter}`, s]),
  );

  function surpriseBadge(
    fiscalYear: number,
    fiscalQuarter: number,
  ): GuidanceColumn['badge'] {
    const s = surpriseByQuarter.get(`${fiscalYear}-${fiscalQuarter}`);
    if (!s) return undefined;

    if (s.kind === 'turn_positive') return { text: '흑자전환', tone: 'up' };
    if (s.kind === 'turn_negative') return { text: '적자전환', tone: 'down' };
    if (s.kind === 'deficit') return { text: '적자지속', tone: 'neutral' };

    const pct = toNum(s.surprise_pct);
    if (pct == null) return undefined;
    const text = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}% ${pct >= 0 ? '↑' : '↓'}`;
    return { text, tone: s.kind === 'beat' ? 'up' : s.kind === 'miss' ? 'down' : 'neutral' };
  }

  const quarterlyColumns: GuidanceColumn[] = (stockDetail?.quarterlyEstimates ?? []).map((q) => ({
    label: `${q.fiscal_year}.${q.fiscal_quarter}Q${q.is_estimate ? '(E)' : ''}`,
    isEstimate: q.is_estimate,
    revenue: toNum(q.revenue),
    operatingIncome: toNum(q.operating_income),
    netIncome: toNum(q.net_income),
    per: toNum(q.per),
    roe: toNum(q.roe),
    opMargin: toNum(q.op_margin),
    netMargin: toNum(q.net_margin),
    revenueGrowth: null, // QoQ로 통일 — 위 주석 참고
    badge: surpriseBadge(q.fiscal_year, q.fiscal_quarter),
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-surface rounded-t-2xl sm:rounded-2xl w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 bg-surface z-10 flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
          <div>
            <p className="text-lg font-bold text-gray-900">{name}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {ticker} · {market}{sector ? ` · ${sector}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => toggleWatch.mutate()}
              disabled={toggleWatch.isPending}
              title={isWatched ? '관심종목에서 제거' : '관심종목에 추가'}
              className={`text-xl leading-none transition-colors ${isWatched ? 'text-red-500 hover:text-red-400' : 'text-gray-300 hover:text-red-400'}`}
            >
              {isWatched ? '♥' : '♡'}
            </button>
            {total != null && (
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${scoreColorClass(total)}`}>
                종합 {total}점
              </span>
            )}
            {hasLowCoverage && (
              <span
                className="text-[10px] font-medium text-gray-400 bg-gray-100 rounded px-1.5 py-0.5"
                title="재무·시세 데이터가 확보된 점수 엔진 수 / 전체 엔진 수"
              >
                데이터 {coverage!.available}/{coverage!.total}
              </span>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
          </div>
        </div>

        {/* 기업 개요 */}
        <div className="px-6 pt-5">
          <h4 className="font-semibold text-gray-900 mb-2 text-sm">기업 개요</h4>
          <p className="text-xs text-gray-500 mb-2">
            시가총액 {fmtKrw(marketCap)}
            {sectorLabel && ` · ${sectorLabel}`}
            {stockDetail?.industry && ` · ${stockDetail.industry}`}
          </p>
          {summaryBullets.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {summaryBullets.map((b, i) => (
                <li key={i} className="text-xs text-gray-600 leading-relaxed flex gap-1.5">
                  <span className="text-gray-300">·</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">기업 개요 정보 없음</p>
          )}
        </div>

        {/* 캔들 차트 (TradingView lightweight-charts) */}
        <div className="px-4 pt-4">
          <CandleChart ticker={ticker} height={360} />
        </div>

        {/* 재무·밸류에이션 */}
        <div className={SECTION_CLASS}>
          <h4 className="font-semibold text-gray-900 mb-4 text-sm">
            재무·밸류에이션
            {stockDetail?.fiscal_year && (
              <span className="ml-1.5 text-xs font-normal text-gray-400">
                {stockDetail.fiscal_year}년 실적 기준
              </span>
            )}
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
            <StatCell label="매출" value={fmtKrw(revenue)} />
            <StatCell label="영업이익" value={fmtKrw(opIncome)} />
            <StatCell label="순이익" value={fmtKrw(netIncome)} />
            <StatCell label="영업이익률" value={opMargin(revenue, opIncome)} />
            <StatCell label="매출성장률" value={fmtPercent(revenueGrowth)} />
            <StatCell label="PER" value={fmtPer(perVal)} />
            <StatCell label="PBR" value={fmtDecimal(pbrVal)} />
            <StatCell label="ROE" value={fmtPercent(roeVal)} />
            <StatCell label="부채비율" value={fmtPercent(debtRatioVal)} />
            <StatCell label="배당수익률" value={fmtPercent(divYieldVal)} />
            <StatCell label="EV/EBITDA" value={fmtDecimal(evEbitdaVal, 1)} />
          </div>

          <GuidanceTable columns={guidanceColumns} />
          <GuidanceTable
            columns={quarterlyColumns}
            title="분기별 실적·추정"
            badge="분기 컨센서스(E)"
            growthLabelSuffix="(QoQ)"
          />
        </div>

        {/* 기술 지표 */}
        {(() => {
          const macdHist = toNum(stockDetail?.macd_hist ?? null);
          const bbPctb = toNum(stockDetail?.bb_pctb ?? null);
          const atrPct = toNum(stockDetail?.atr_pct ?? null);
          const surge = toNum(stockDetail?.turnover_surge ?? null);
          const obvTrend = stockDetail?.obv_trend ?? null;
          const fScore = stockDetail?.f_score ?? null;
          const fMax = stockDetail?.f_score_max ?? null;
          const hasTech = macdHist != null || bbPctb != null || atrPct != null || surge != null || fScore != null;
          if (!hasTech) return null;
          const macdState = macdHist == null ? '–' : macdHist > 0 ? '골든(양)' : macdHist < 0 ? '데드(음)' : '중립';
          const bbState = bbPctb == null ? '–'
            : bbPctb >= 1 ? `상단이탈 ${bbPctb.toFixed(2)}`
            : bbPctb <= 0 ? `하단이탈 ${bbPctb.toFixed(2)}`
            : `${(bbPctb * 100).toFixed(0)}%`;
          const obvState = obvTrend == null ? '–' : obvTrend > 0 ? '상승' : obvTrend < 0 ? '하락' : '보합';
          return (
            <div className={SECTION_CLASS}>
              <h4 className="font-semibold text-gray-900 mb-4 text-sm">기술 지표</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                <StatCell label="MACD" value={macdState} />
                <StatCell label="볼린저 %B" value={bbState} />
                <StatCell label="ATR(변동성)" value={atrPct == null ? '–' : `${atrPct.toFixed(1)}%`} />
                <StatCell label="OBV 추세" value={obvState} />
                <StatCell label="거래대금 급증" value={surge == null ? '–' : `${surge.toFixed(1)}배`} />
                <StatCell label="간이 F-score" value={fScore == null || fMax == null ? '–' : `${fScore} / ${fMax}`} />
              </div>
            </div>
          );
        })()}

        {/* 밸류에이션 밴드(PER/PBR/PBR-ROE) — 데이터 없으면 컴포넌트 내부에서 섹션 자체를 숨김 */}
        <ValuationBands ticker={ticker} />

        {/* 신용잔고 — 데이터 없으면 컴포넌트 내부에서 섹션 자체를 숨김 */}
        <CreditBalanceSection ticker={ticker} />

        {/* 점수 분석 */}
        <div className={`${SECTION_CLASS} pb-5`}>
          <h4 className="font-semibold text-gray-900 mb-4">점수 분석</h4>
          {breakdown.length === 0 ? (
            <p className="text-sm text-gray-400">
              점수 데이터가 없습니다. [데이터] 메뉴에서 수집을 먼저 실행하세요.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {breakdown.filter((e) => e.category !== 'adjustment').map((e) => (
                <div key={e.id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-800">
                      {e.name}
                      <span className="ml-1.5 text-xs text-gray-400">가중치 {Math.round(e.weight * 100)}%</span>
                    </span>
                    <span className="text-sm font-bold text-gray-900">{e.score}점</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-1.5">
                    <div
                      className={`h-full rounded-full ${CATEGORY_COLORS[e.category] ?? 'bg-gray-400'}`}
                      style={{ width: `${e.score}%` }}
                    />
                  </div>
                  {e.reasons && e.reasons.length > 0 && (
                    <ul className="text-xs text-gray-500 leading-relaxed">
                      {e.reasons.map((r, i) => (
                        <li key={i} className="flex gap-1.5">
                          <span className="text-gray-300">·</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {breakdown.filter((e) => e.category === 'adjustment').map((e) => (
                <div key={e.id} className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <p className="text-xs font-medium text-amber-800 mb-0.5">{e.name}</p>
                  {(e.reasons ?? []).map((r, i) => (
                    <p key={i} className="text-xs text-amber-700">{r}</p>
                  ))}
                </div>
              ))}
            </div>
          )}
          {disclosures.length > 0 && (
            <div className="mt-5 pt-4 border-t border-gray-100">
              <h4 className="font-semibold text-gray-900 text-sm mb-2">
                최근 공시
                <span className="ml-1.5 text-xs font-normal text-gray-400">DART · 점수 반영 이벤트는 배지 표시</span>
              </h4>
              <ul className="flex flex-col gap-1.5">
                {disclosures.map((d) => (
                  <li key={d.rcept_no} className="text-xs text-gray-600 flex flex-wrap items-baseline gap-x-2">
                    <span className="text-gray-400 shrink-0">{d.rcept_dt}</span>
                    {d.event_type && (
                      <span className={`shrink-0 font-medium rounded px-1.5 py-0.5 text-[10px] ${
                        d.event_type === 'exclusion' ? 'bg-red-50 text-red-600' :
                        d.event_type === 'penalty' ? 'bg-amber-50 text-amber-700' :
                        'bg-emerald-50 text-emerald-700'
                      }`}>
                        {d.event_type === 'exclusion' ? '🚫 제외' : `${d.score_delta > 0 ? '+' : ''}${d.score_delta}점`}
                        {d.detail ? ` ${d.detail}` : ''}
                      </span>
                    )}
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-700 hover:text-blue-600 hover:underline truncate max-w-full"
                    >
                      {d.report_nm}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {news.length > 0 && (
            <div className="mt-5 pt-4 border-t border-gray-100">
              <h4 className="font-semibold text-gray-900 text-sm mb-2">
                최근 뉴스
                <span className="ml-1.5 text-xs font-normal text-gray-400">네이버 증권</span>
              </h4>
              <ul className="flex flex-col gap-1.5">
                {news.slice(0, 8).map((n) => (
                  <li key={n.url} className="text-xs text-gray-600 flex flex-wrap items-baseline gap-x-2">
                    <span className="text-gray-400 shrink-0">{n.datetime.slice(5)}</span>
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-700 hover:text-blue-600 hover:underline truncate max-w-full"
                    >
                      {n.title}
                    </a>
                    <span className="text-gray-400 shrink-0">{n.press}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {scoreDetail?.scored_at && (
            <p className="text-xs text-gray-300 mt-4">
              점수 산정: {new Date(scoreDetail.scored_at).toLocaleString('ko-KR')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
