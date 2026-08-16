import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { StockDetailPanel } from '../shared/components/StockDetailPanel';
import { Preset, PresetCriteria, criteriaSummary } from './StrategiesPage';
import { isKstMarketOpen } from '../shared/lib/isKstMarketOpen';
import { gradeOf, scoreBadgeStyle, scoreColorClass } from '../shared/lib/scoreGrade';
import { clickableRowProps, CLICKABLE_ROW_CLASS, SORT_BUTTON_CLASS } from '../shared/lib/clickableRow';
import { RsBar } from '../shared/components/RsBar';
import {
  fmtNetAmt, fmtKrw, fmtPer, opMargin, buildPageNumbers,
} from './screener/format';
import { EMPTY_FILTER, mergeCriteria, filterToCriteria, criteriaToFilter } from './screener/filter';
import {
  MARKETS, PAGE_SIZE, MAX_COMPARE, COMPARE_LIMIT_MSG_MS, CATEGORY_COLORS, CATEGORY_LABELS,
} from './screener/constants';
import {
  SortTh, ScoreBadge, DiscoveryBadge, CoverageBadge, BreakdownBars,
  ReferenceQuarterCell, LatestQuarterCell, EstimateQuarterCell,
} from './screener/ScreenerBadges';
import type { EngineResult, ScreenerResult, FilterState, EarningsTrendMode } from './screener/types';
import { csvCell, todayStamp } from '../shared/lib/csv';
import { downloadCsv } from '../shared/lib/downloadCsv';

/** 실적 개선 필터 라디오 선택지 — '' = 조건 없음 */
const EARNINGS_TREND_OPTIONS: Array<[EarningsTrendMode, string]> = [
  ['', '안 봄'],
  ['yoy', '전년동기 대비(YoY)'],
  ['qoq', '직전분기 대비(QoQ)'],
  ['both', '둘 다'],
];

export function ScreenerPage() {
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [selected, setSelected] = useState<ScreenerResult | null>(null);
  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([]);
  // 모바일 전용: 전략 칩·필터 패널을 접힌 아코디언으로 시작 (결과 테이블을 먼저 보여주기 위함)
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // 비교 바로가기 — 결과 행 체크박스로 선택한 종목(최대 4개)을 /compare로 전달
  const [compareTickers, setCompareTickers] = useState<string[]>([]);
  const [compareLimitMsg, setCompareLimitMsg] = useState(false);

  const toggleCompareTicker = (ticker: string) => {
    setCompareTickers((prev) => {
      if (prev.includes(ticker)) return prev.filter((t) => t !== ticker);
      if (prev.length >= MAX_COMPARE) {
        setCompareLimitMsg(true);
        window.setTimeout(() => setCompareLimitMsg(false), COMPARE_LIMIT_MSG_MS);
        return prev;
      }
      return [...prev, ticker];
    });
  };

  const goToCompare = () => {
    if (compareTickers.length < 2) return;
    navigate(`/compare?t=${compareTickers.join(',')}`);
  };

  const { data: sectors = [] } = useQuery<string[]>({
    queryKey: ['screener', 'sectors'],
    queryFn: () => apiClient.get(API.screener.sectors).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // RS(상대강도) 백분위 — /rs 페이지와 동일 데이터. 일봉 마감 기준이라 폴링 불필요
  const { data: rsData } = useQuery<{ stocks: Array<{ ticker: string; rs: { integrated: number | null } }> }>({
    queryKey: ['market', 'rs'],
    queryFn: () => apiClient.get(API.market.rs).then((r) => r.data),
    staleTime: 10 * 60 * 1000,
  });
  const rsMap = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const s of rsData?.stocks ?? []) map.set(s.ticker, s.rs.integrated);
    return map;
  }, [rsData]);

  const searchBody = (page: number, pageSize: number) => ({
    ...filterToCriteria(filter),
    sector: filter.sector || undefined,
    q: filter.q.trim() || undefined,
    sort: filter.sort,
    order: filter.order,
    page,
    pageSize,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['screener', filter],
    queryFn: () => apiClient.post(API.screener.search, searchBody(filter.page, PAGE_SIZE)).then((r) => r.data),
  });

  // 정렬 토글 (전략 선택 유지 — 조건이 아니라 보기 방식이므로)
  const onSort = (col: string) => {
    setFilter((f) => ({
      ...f,
      sort: col,
      order: f.sort === col && f.order === 'desc' ? 'asc' : 'desc',
      page: 1,
    }));
  };

  // CSV 내보내기 (현재 필터 전체 결과)
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const { data: full } = await apiClient.post(API.screener.search, searchBody(1, 3000));
      const rows: ScreenerResult[] = full.data ?? [];
      const esc = csvCell; // 공용 유틸 — 엑셀 수식 주입까지 함께 막는다(shared/lib/csv.ts)
      // 증가율(소수) → "20.5". 흑자전환은 백분율이 없으므로 글자로 적는다.
      const pct = (v: number | string | null) =>
        v != null && Number.isFinite(Number(v)) ? (Number(v) * 100).toFixed(1) : '';
      // 원 → 억 (CSV는 표기 접미어 없이 숫자만 — 스프레드시트에서 계산 가능하게)
      const eok = (v: number | string | null) =>
        v != null && Number.isFinite(Number(v)) ? Math.round(Number(v) / 1e8) : '';
      const pctOrTurn = (v: number | string | null, turnaround: boolean | null) =>
        turnaround === true ? '흑자전환' : pct(v);
      const opm = (r: ScreenerResult) => {
        const rev = Number(r.revenue); const op = Number(r.operating_income);
        return Number.isFinite(rev) && rev > 0 && Number.isFinite(op) ? ((op / rev) * 100).toFixed(1) : '';
      };
      const lines = [
        ['종목명', '코드', '시장', '섹터', '현재가', '등락률%', '시총(억)', '매출(억)', '영업이익(억)', '영업이익률%', 'tPER', 'fPER', '52주고점대비%', '실적기준분기', '전년동기매출(억)', '전년동기영익(억)', '예정전년동기매출(억)', '예정전년동기영익(억)', '직전분기매출(억)', '직전분기영익(억)', '분기매출(억)', '분기영익(억)', '매출YoY%', '영익YoY%', '매출QoQ%', '영익QoQ%', 'YoY연속분기', '다음분기(E)', '컨센매출(억)', '컨센영익(억)', '컨센매출YoY%', '컨센영익YoY%', '컨센매출QoQ%', '컨센영익QoQ%', '외인5일(억원)', '기관5일(억원)', '종합점수'].map(esc).join(','),
        ...rows.map((r) => [
          r.name, r.ticker, r.market, r.sector ?? '',
          r.last_close ?? '', r.day_change ?? '',
          r.market_cap != null ? Math.round(Number(r.market_cap) / 1e8) : '',
          r.revenue != null ? Math.round(Number(r.revenue) / 1e8) : '',
          r.operating_income != null ? Math.round(Number(r.operating_income) / 1e8) : '',
          opm(r), r.trailing_per ?? '', r.forward_per ?? '', r.pct_from_52w_high ?? '',
          r.trend_year != null ? `${r.trend_year}Q${r.trend_quarter}` : '',
          eok(r.yoy_prev_revenue), eok(r.yoy_prev_operating_income),
          eok(r.eq_yoy_prev_revenue), eok(r.eq_yoy_prev_operating_income),
          eok(r.qoq_prev_revenue), eok(r.qoq_prev_operating_income),
          eok(r.trend_revenue), eok(r.trend_operating_income),
          pct(r.revenue_yoy), pctOrTurn(r.op_yoy, r.op_yoy_turnaround),
          pct(r.revenue_qoq), pctOrTurn(r.op_qoq, r.op_qoq_turnaround),
          r.yoy_streak ?? '',
          r.eq_year != null ? `${r.eq_year}Q${r.eq_quarter}` : '',
          eok(r.eq_revenue), eok(r.eq_operating_income),
          pct(r.eq_revenue_yoy), pctOrTurn(r.eq_op_yoy, r.eq_op_yoy_turnaround),
          pct(r.eq_revenue_qoq), pctOrTurn(r.eq_op_qoq, r.eq_op_qoq_turnaround),
          r.foreign_amt_5d != null ? (Number(r.foreign_amt_5d) / 1e8).toFixed(1) : '',
          r.inst_amt_5d != null ? (Number(r.inst_amt_5d) / 1e8).toFixed(1) : '',
          r.total_score ?? '',
        ].map(esc).join(',')),
      ];
      downloadCsv(`screener_${todayStamp()}.csv`, lines);
    } finally {
      setExporting(false);
    }
  };

  const { data: presets = [] } = useQuery<Preset[]>({
    queryKey: ['screener', 'presets'],
    queryFn: () => apiClient.get(API.screener.presets).then((r) => r.data),
  });

  const rawResults: ScreenerResult[] = data?.data ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 현재 페이지 종목 실시간 시세 (장중 반영, 30초 폴링)
  const pageTickers = rawResults.map((r) => r.ticker);
  const { data: quotes = {} } = useQuery<Record<string, { price: number; changePct: number }>>({
    queryKey: ['quotes', 'screener', pageTickers.join(',')],
    queryFn: () => apiClient.get(`${API.market.quotes}?tickers=${pageTickers.join(',')}`).then((r) => r.data),
    enabled: pageTickers.length > 0,
    refetchInterval: () => (isKstMarketOpen() ? 30 * 1000 : false), // 장중에만 30초 폴링
    staleTime: 25 * 1000,
  });
  const results: ScreenerResult[] = rawResults.map((r) => {
    const q = quotes[r.ticker];
    return q ? { ...r, last_close: q.price, day_change: q.changePct } : r;
  });

  const goPage = (p: number) => setFilter((f) => ({ ...f, page: p }));

  /** 전략 칩 토글 — 선택된 전략들의 조건을 AND 병합해 필터 재구성 */
  const togglePreset = (preset: Preset) => {
    setSelectedPresetIds((prev) => {
      const next = prev.includes(preset.id)
        ? prev.filter((id) => id !== preset.id)
        : [...prev, preset.id];
      const selected = next
        .map((id) => presets.find((p) => p.id === id))
        .filter((p): p is Preset => p != null);
      setFilter(criteriaToFilter(mergeCriteria(selected)));
      return next;
    });
  };

  // 전략 관리 페이지에서 '적용'으로 넘어온 경우 (단일 선택으로 시작)
  useEffect(() => {
    const presetId = (location.state as { presetId?: string } | null)?.presetId;
    if (presetId && presets.length > 0) {
      const p = presets.find((x) => x.id === presetId);
      if (p) {
        setSelectedPresetIds([p.id]);
        setFilter(criteriaToFilter(p.criteria ?? {}));
      }
      window.history.replaceState({}, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, presets]);

  // 산업 레이더 등에서 종목명 검색으로 넘어온 경우
  useEffect(() => {
    const search = (location.state as { search?: string } | null)?.search;
    if (search) {
      setSelectedPresetIds([]);
      setFilter((f) => ({ ...f, q: search, page: 1 }));
      window.history.replaceState({}, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // 수동 필터 조작 시 전략 선택 해제 (조건 값은 유지 — 배지는 현재 필터 기준으로 표시)
  const setManual = (patch: Partial<FilterState>) => {
    setSelectedPresetIds([]);
    setFilter((f) => ({ ...f, ...patch }));
  };

  const activeConditions = criteriaSummary(filterToCriteria(filter));
  const selectedNames = selectedPresetIds
    .map((id) => presets.find((p) => p.id === id)?.name)
    .filter((n): n is string => n != null);

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
      <h2 className="text-xl font-bold text-gray-900 mb-6">종목 스크리너</h2>

      {/* 모바일 전용 필터 아코디언 토글 — md 이상에서는 항상 펼쳐져 있으므로 숨김 */}
      <button
        type="button"
        onClick={() => setMobileFilterOpen((v) => !v)}
        className="md:hidden w-full flex items-center justify-between bg-surface border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium mb-4"
      >
        <span>🔍 필터 · 조건 {activeConditions.length}개</span>
        <span>{mobileFilterOpen ? '▴' : '▾'}</span>
      </button>

      {/* 전략 칩 + 조건 배지 + 필터 패널 — 모바일에서는 토글 시에만, md 이상은 항상 표시 */}
      <div className={`${mobileFilterOpen ? 'block' : 'hidden'} md:block`}>

      {/* 전략 칩 */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => togglePreset(p)}
            title={`${p.description ?? ''}\n조건: ${criteriaSummary(p.criteria ?? {}).join(', ') || '없음'}\n(클릭으로 중복 선택/해제 — 조건은 AND 결합)`}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              selectedPresetIds.includes(p.id)
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'border-blue-200 text-blue-600 hover:bg-blue-50'
            }`}
          >
            {selectedPresetIds.includes(p.id) && '✓ '}
            {p.name}
          </button>
        ))}
        <Link
          to="/strategies"
          className="text-xs px-3 py-1.5 rounded-full border border-dashed border-gray-300 text-gray-400 hover:text-blue-600 hover:border-blue-300 transition-colors"
        >
          + 전략 추가/관리
        </Link>
      </div>

      {/* 적용 중인 조건 표시 (현재 필터 상태 기준) */}
      {activeConditions.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-gray-500">
            {selectedNames.length > 0
              ? `전략 ${selectedNames.map((n) => `'${n}'`).join(' + ')} 적용 중 (AND):`
              : '적용 중인 조건:'}
          </span>
          {activeConditions.map((s) => (
            <span key={s} className="bg-blue-50 border border-blue-100 text-blue-700 rounded px-1.5 py-0.5">{s}</span>
          ))}
        </div>
      )}

      {/* 필터 패널 */}
      <div className="bg-surface rounded-xl border border-gray-200 p-4 mb-5">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">종목 검색</label>
            <input
              value={filter.q}
              onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value, page: 1 }))}
              placeholder="종목명 또는 코드"
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">시장</label>
            <select
              value={filter.market || '전체'}
              onChange={(e) => setManual({ market: e.target.value === '전체' ? '' : e.target.value, page: 1 })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {MARKETS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              섹터{sectors.length > 0 && <span className="ml-1 text-gray-400">({sectors.length}개)</span>}
            </label>
            <select
              value={filter.sector}
              onChange={(e) => setManual({ sector: e.target.value === '전체' ? '' : e.target.value, page: 1 })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[160px]"
            >
              <option value="">전체</option>
              {sectors.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              최소 점수: <span className="font-medium text-gray-700">{filter.minScore > 0 ? `${filter.minScore}점+` : '전체'}</span>
            </label>
            <input
              type="range"
              min={0}
              max={90}
              step={5}
              value={filter.minScore}
              onChange={(e) => setManual({ minScore: Number(e.target.value), page: 1 })}
              className="w-32 accent-blue-600"
            />
          </div>
          <button
            onClick={() => { setFilter(EMPTY_FILTER); setSelectedPresetIds([]); }}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 border border-gray-200 rounded-lg"
          >
            초기화
          </button>
        </div>

        {/* 재무 조건 상세 필터 */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 pt-4 border-t border-gray-100">
          {([
            ['tPER 상한 (배)', 'maxPer'],
            ['최소 영업이익률 (%)', 'minOpMargin'],
            ['최소 매출성장률 (%)', 'minRevenueGrowth'],
            ['최소 배당수익률 (%)', 'minDivYield'],
            ['최소 시총 (억)', 'minMarketCapEok'],
          ] as Array<[string, 'maxPer' | 'minOpMargin' | 'minRevenueGrowth' | 'minDivYield' | 'minMarketCapEok']>).map(([label, key]) => (
            <div key={key}>
              <label className="block text-xs text-gray-500 mb-1">{label}</label>
              <input
                type="number"
                value={filter[key]}
                placeholder="—"
                onChange={(e) => setManual({ [key]: e.target.value, page: 1 } as Partial<FilterState>)}
                className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
        </div>

        {/* 분기 실적 개선 조건 */}
        <fieldset className="mt-4 pt-4 border-t border-gray-100">
          <legend className="text-xs text-gray-500 mb-2">
            실적 개선 <span className="text-gray-300">(최신 확정 분기 기준 · 매출과 영업이익이 함께 늘어난 종목)</span>
          </legend>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-wrap gap-3">
              {EARNINGS_TREND_OPTIONS.map(([value, label]) => (
                <label key={value} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="radio"
                    name="earningsTrend"
                    value={value}
                    checked={filter.earningsTrend === value}
                    onChange={() => setManual({ earningsTrend: value, page: 1 })}
                    className="accent-blue-600"
                  />
                  {label}
                </label>
              ))}
            </div>
            <div>
              <label htmlFor="minEarningsGrowth" className="block text-xs text-gray-500 mb-1">
                최소 증가율 (%)
              </label>
              <input
                id="minEarningsGrowth"
                type="number"
                value={filter.minEarningsGrowth}
                placeholder="0"
                disabled={!filter.earningsTrend}
                onChange={(e) => setManual({ minEarningsGrowth: e.target.value, page: 1 })}
                className="w-28 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-300"
              />
            </div>
            <div>
              <label htmlFor="minEarningsStreak" className="block text-xs text-gray-500 mb-1">
                YoY 연속 개선 (분기)
              </label>
              <input
                id="minEarningsStreak"
                type="number"
                min={1}
                value={filter.minEarningsStreak}
                placeholder="—"
                onChange={(e) => setManual({ minEarningsStreak: e.target.value, page: 1 })}
                className="w-28 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer pb-1.5">
              <input
                type="checkbox"
                checked={filter.estImproving}
                onChange={(e) => setManual({ estImproving: e.target.checked, page: 1 })}
                className="rounded border-gray-300 accent-blue-600"
              />
              다음 분기 컨센서스도 개선 <span className="text-gray-400">(위에서 고른 기준으로)</span>
            </label>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            비우면 0% 초과 · 적자에서 흑자로 돌아선 분기는 증가율과 무관하게 통과합니다.
            연속 개선은 <b>확인된 연속</b>만 셉니다 — 비교 대상 분기가 없으면 그 지점에서 끊깁니다.
          </p>
        </fieldset>
      </div>

      </div>

      {/* 데이터 근거 설명 */}
      <details className="mb-5 bg-blue-50/50 border border-blue-100 rounded-xl px-4 py-3 text-sm">
        <summary className="cursor-pointer text-blue-700 font-medium text-xs select-none">
          ℹ️ 데이터 근거 — 이 숫자들은 어디서 오나요?
        </summary>
        <div className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-gray-600 leading-relaxed">
          <p><b className="text-gray-800">종합 점수</b> — 5개 팩터 가중합 (가치 30% · 퀄리티 25% · 성장 20% · 모멘텀 15% · 신기술 10%). 종목 클릭 → 점수 분석에서 항목별 실수치 근거 확인</p>
          <p><b className="text-gray-800">시총</b> — 네이버 금융, 마지막 데이터 수집 시점 기준</p>
          <p><b className="text-gray-800">매출·영업이익·이익률</b> — 네이버 최신 <b>확정</b> 연간 실적 (연도는 매출 옆 '25 표기). 컨센서스(전망치)는 점수 계산에 사용하지 않음</p>
          <p><b className="text-gray-800">tPER</b> — 현재가 ÷ 최근 확정 EPS (트레일링)</p>
          <p><b className="text-gray-800">fPER</b> — 현재가 ÷ 내년 애널리스트 컨센서스 EPS (커버리지 없는 종목은 —)</p>
          <p><b className="text-gray-800">가이던스</b> — 내년 매출·영업이익 애널리스트 컨센서스 (네이버, 주로 중대형주만 제공)</p>
          <p><b className="text-gray-800">시세·차트</b> — Yahoo Finance 일봉 (1년)</p>
          <p><b className="text-gray-800">수급 (외인/기관 5일)</b> — 네이버 투자자별 매매동향, 최근 5영업일 순매수 금액 합계 (수량×당일 종가 근사, 빨강=순매수, 파랑=순매도)</p>
          <p><b className="text-gray-800">기술 지표 (전략 조건용)</b> — 저장된 일봉으로 계산: MA20/60/120, RSI(14), 52주 고점 대비 %, 거래량 배율(5일/20일 평균)</p>
          <p><b className="text-gray-800">갱신 시점</b> — [데이터] 메뉴에서 마지막 수집 시각 확인 및 재수집 가능. 수급·시세는 수집 시점 기준</p>
        </div>
      </details>

      {/* 범례 */}
      <div className="flex gap-3 mb-3 flex-wrap">
        {Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
          <div key={cat} className="flex items-center gap-1 text-xs text-gray-500">
            <span className={`w-2.5 h-2.5 rounded-sm inline-block ${CATEGORY_COLORS[cat]}`} />
            {label}
          </div>
        ))}
      </div>

      {/* 결과 테이블 */}
      <div className="bg-surface rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 text-sm text-gray-500 flex items-center justify-between">
          <span>{isLoading ? '검색 중...' : `총 ${total.toLocaleString()}개 종목 (${filter.page}/${totalPages} 페이지)`}</span>
          <div className="flex items-center gap-3">
            {compareLimitMsg && (
              <span className="text-xs text-amber-600">최대 {MAX_COMPARE}개까지 비교할 수 있어요</span>
            )}
            <button
              type="button"
              onClick={goToCompare}
              disabled={compareTickers.length < 2}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:text-gray-300 disabled:cursor-not-allowed shrink-0"
            >
              ⚖️ 선택 비교 ({compareTickers.length})
            </button>
            <button
              onClick={exportCsv}
              disabled={exporting || total === 0}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              {exporting ? '내보내는 중…' : '⬇ CSV 내보내기'}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-3 py-3 w-8" title="비교할 종목 선택 (최대 4개)" />
                <SortTh label="종목명" col="name" filter={filter} onSort={onSort} align="left" wide />
                <SortTh label="현재가" col="day_change" filter={filter} onSort={onSort} />
                <th
                  className="text-right px-3 py-3 text-xs font-medium text-gray-500"
                  title="통합 RS — 기간별 RS 백분위의 최근 가중평균(1M 40%·3M 30%·6M 20%·12M 10%), /rs 페이지와 동일 기준"
                >
                  RS
                </th>
                <SortTh label="시총" col="market_cap" filter={filter} onSort={onSort} />
                <SortTh label="매출" col="revenue" filter={filter} onSort={onSort} />
                <SortTh label="영업이익" col="operating_income" filter={filter} onSort={onSort} />
                <SortTh label="이익률" col="op_margin" filter={filter} onSort={onSort} />
                <SortTh label="전년동기" col="yoy_prev_revenue" filter={filter} onSort={onSort} sub="확정 기준" />
                <SortTh label="전년동기" col="eq_yoy_prev_revenue" filter={filter} onSort={onSort} sub="예정 기준" />
                <SortTh label="최신 확정" col="trend_revenue" filter={filter} onSort={onSort} sub="매출/영익 · 증가율" />
                <SortTh label="다음 분기(E)" col="eq_revenue" filter={filter} onSort={onSort} sub="컨센서스 · 증가율" />
                <SortTh label="tPER" col="trailing_per" filter={filter} onSort={onSort} />
                <SortTh label="fPER" col="forward_per" filter={filter} onSort={onSort} />
                <SortTh label="고점대비" col="pct_52w" filter={filter} onSort={onSort} />
                <th className="text-left px-3 py-3 text-xs font-medium text-gray-500">가이던스(내년 E)</th>
                <SortTh label="수급 5일" col="foreign_5d" filter={filter} onSort={onSort} sub="외인/기관" />
                <SortTh label="발굴" col="discovery_score" filter={filter} onSort={onSort} sub="모멘텀·수급" />
                <SortTh label="종합 점수" col="score" filter={filter} onSort={onSort} last />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {results.map((row) => (
                <tr
                  key={row.ticker}
                  className={`hover:bg-blue-50 ${CLICKABLE_ROW_CLASS}`}
                  {...clickableRowProps(() => setSelected(row), `${row.name} 상세 열기`)}
                >
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={compareTickers.includes(row.ticker)}
                      onChange={() => toggleCompareTicker(row.ticker)}
                      aria-label={`${row.name} 비교 선택`}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="px-5 py-3">
                    <p className="font-medium text-gray-900">{row.name}</p>
                    <p className="text-xs text-gray-400">
                      {row.ticker} · {row.market}{row.sector ? ` · ${row.sector}` : ''}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right">
                    {row.last_close != null ? (
                      <>
                        <span className="text-gray-800">{Number(row.last_close).toLocaleString()}</span>
                        {row.day_change != null && (
                          <span className={`block text-xs ${Number(row.day_change) >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                            {Number(row.day_change) >= 0 ? '+' : ''}{Number(row.day_change).toFixed(2)}%
                          </span>
                        )}
                      </>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <RsBar rs={rsMap.get(row.ticker) ?? null} compact />
                  </td>
                  <td className="px-3 py-3 text-right text-gray-700">{fmtKrw(row.market_cap)}</td>
                  <td className="px-3 py-3 text-right text-gray-700">
                    {fmtKrw(row.revenue)}
                    {row.fin_year && row.revenue != null && (
                      <span className="text-xs text-gray-400 ml-0.5">'{String(row.fin_year).slice(2)}</span>
                    )}
                  </td>
                  <td className={`px-3 py-3 text-right ${row.operating_income != null && Number(row.operating_income) < 0 ? 'text-blue-600' : 'text-gray-700'}`}>
                    {fmtKrw(row.operating_income)}
                  </td>
                  <td className="px-3 py-3 text-right text-gray-700">{opMargin(row.revenue, row.operating_income)}</td>
                  <td className="px-3 py-3 text-right"><ReferenceQuarterCell row={row} anchor="confirmed" /></td>
                  <td className="px-3 py-3 text-right"><ReferenceQuarterCell row={row} anchor="estimate" /></td>
                  <td className="px-3 py-3 text-right"><LatestQuarterCell row={row} /></td>
                  <td className="px-3 py-3 text-right"><EstimateQuarterCell row={row} /></td>
                  <td className="px-3 py-3 text-right text-gray-700">{fmtPer(row.trailing_per)}</td>
                  <td className="px-3 py-3 text-right text-gray-700">{fmtPer(row.forward_per)}</td>
                  <td className="px-3 py-3 text-right text-gray-500">
                    {row.pct_from_52w_high != null ? `${Number(row.pct_from_52w_high).toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    {row.est_revenue != null || row.est_operating_income != null ? (
                      <>
                        매출 {fmtKrw(row.est_revenue)} · 영업익 {fmtKrw(row.est_operating_income)}
                        {row.est_year && <span className="text-gray-300"> ('{String(row.est_year).slice(2)}E)</span>}
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right text-xs leading-relaxed">
                    {[fmtNetAmt(row.foreign_amt_5d), fmtNetAmt(row.inst_amt_5d)].map((f, i) => (
                      <span key={i} className={`block ${f.up == null ? 'text-gray-300' : f.up ? 'text-red-500' : 'text-blue-500'}`}>
                        {f.text}
                      </span>
                    ))}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <DiscoveryBadge score={row.discovery_score} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <ScoreBadge score={row.total_score} />
                    <CoverageBadge breakdown={row.breakdown} />
                    <BreakdownBars breakdown={row.breakdown} />
                  </td>
                </tr>
              ))}
              {!isLoading && results.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-5 py-8 text-center text-gray-400">
                    조건에 맞는 종목이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={() => goPage(filter.page - 1)}
              disabled={filter.page <= 1}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 disabled:cursor-not-allowed"
            >
              ← 이전
            </button>
            <div className="flex gap-1">
              {buildPageNumbers(filter.page, totalPages).map((p, i) =>
                p === '...' ? (
                  <span key={`ellipsis-${i}`} className="px-2 py-1.5 text-sm text-gray-400">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => goPage(Number(p))}
                    className={`w-8 h-8 text-sm rounded-lg ${
                      filter.page === p
                        ? 'bg-blue-600 text-white font-medium'
                        : 'border border-gray-200 hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            </div>
            <button
              onClick={() => goPage(filter.page + 1)}
              disabled={filter.page >= totalPages}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 disabled:cursor-not-allowed"
            >
              다음 →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
