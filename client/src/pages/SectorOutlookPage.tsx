import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../shared/api/client';
import { API } from '../shared/api/endpoints';
import { StockDetailPanel } from '../shared/components/StockDetailPanel';
import { OutlookTable, type SortBasis } from './outlook/OutlookTable';
import { SectorCompareTable } from './outlook/SectorCompareTable';
import { downloadOutlookCsv } from './outlook/outlookCsv';
import {
  METRICS, periodKindOf,
  type GrowthBasis, type MetricKey, type OutlookItem, type OutlookResponse, type PeriodType,
} from './outlook/outlookTypes';
import type { SectorCompareResponse } from './outlook/sectorCompareTypes';

/** 처음 열었을 때 보여줄 산업 — 이 화면을 요청한 맥락(반도체 비교)에서 왔다. */
const DEFAULT_SECTOR = '반도체와반도체장비';

/** 화면의 두 갈래 — 산업 하나의 종목들 / 산업들끼리. */
type View = 'stocks' | 'sectors';

const PILL_ON = 'bg-[#111827] text-white border-[#111827]';
const PILL_OFF = 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-50';

/**
 * 산업 실적 전망 — 산업 하나를 골라 그 기업들의 확정 실적과 컨센서스를 비교한다.
 *
 * 축은 **연간 ⇄ 분기**로 갈아 끼운다(연간 = 확정 1 + 전망 3, 분기 = 확정 4 + 전망 3).
 * 선택한 산업·축은 URL에 남는다 — 화면 링크를 그대로 공유·재방문할 수 있게.
 *
 * ⚠️ 컨센서스는 **애널리스트 전망치**이지 확정 실적이 아니다. 커버리지도 산업의 절반 수준이라
 * 화면에 커버리지를 상시 노출해 "이 표가 산업 전체"라는 오독을 막는다.
 */
export function SectorOutlookPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sector = searchParams.get('sector') ?? DEFAULT_SECTOR;
  const periodType: PeriodType = searchParams.get('period') === 'quarter' ? 'quarter' : 'year';
  const view: View = searchParams.get('view') === 'sectors' ? 'sectors' : 'stocks';

  const setParams = (next: { sector?: string; period?: PeriodType; view?: View }) => {
    setSearchParams({
      sector: next.sector ?? sector,
      period: next.period ?? periodType,
      view: next.view ?? view,
    });
  };

  // 항목은 **여러 개 동시 선택**. 하나만 보고 싶으면 하나만 켜면 된다.
  const [metrics, setMetrics] = useState<MetricKey[]>(['revenue']);
  // 산업 비교는 매트릭스라 한 항목만 올릴 수 있다 — 칸 하나에 산업×기간이 이미 들어 있다.
  const [compareMetric, setCompareMetric] = useState<MetricKey>('revenue');

  /** 항목 켜고 끄기 — 마지막 하나는 끌 수 없다(빈 표가 되어버린다). */
  const toggleMetric = (key: MetricKey) => {
    setMetrics((prev) =>
      prev.includes(key)
        ? (prev.length === 1 ? prev : prev.filter((k) => k !== key))
        : [...prev, key],
    );
  };
  const [sortBasis, setSortBasis] = useState<SortBasis>('growth');
  // 분기 축에서만 뜻이 있다. 연간으로 돌아가면 표시는 감추고 값은 yoy로 강제한다.
  const [quarterGrowthBasis, setQuarterGrowthBasis] = useState<GrowthBasis>('yoy');
  const growthBasis: GrowthBasis = periodType === 'quarter' ? quarterGrowthBasis : 'yoy';

  const [showUncovered, setShowUncovered] = useState(false);
  const [selected, setSelected] = useState<OutlookItem | null>(null);
  // 표가 정렬한 결과 — CSV를 화면과 같은 순서로 내보내기 위해 받아 둔다.
  const [sortedRows, setSortedRows] = useState<OutlookItem[]>([]);

  // 금액/증가율 토글은 금액 항목이 하나라도 켜져 있을 때만 뜻이 있다 — 배수만 보고 있으면 감춘다.
  const activeMetrics = view === 'sectors' ? [compareMetric] : metrics;
  const hasAmountMetric = METRICS.some(
    (m) => activeMetrics.includes(m.key) && m.format === 'amount',
  );

  const { data: sectors } = useQuery<string[]>({
    queryKey: ['screener', 'sectors'],
    queryFn: () => apiClient.get(API.screener.sectors).then((r) => r.data),
    staleTime: 60 * 60 * 1000, // 업종 목록은 수집 때만 바뀐다
  });

  const { data, isLoading, isError } = useQuery<OutlookResponse>({
    queryKey: ['market', 'outlook', sector, periodType],
    queryFn: () => apiClient
      .get(API.market.outlook, { params: { sector, period: periodType } })
      .then((r) => r.data),
    enabled: view === 'stocks',
  });

  // 증가율 기준(YoY/QoQ)이 서버에서 정해지므로 질의 키에 넣는다 — 화면에서 고르면 다시 받는다.
  const compare = useQuery<SectorCompareResponse>({
    queryKey: ['market', 'outlook', 'sectors', periodType, growthBasis],
    queryFn: () => apiClient
      .get(API.market.outlookSectors, { params: { period: periodType, basis: growthBasis } })
      .then((r) => r.data),
    enabled: view === 'sectors',
  });

  const periods = data?.periods ?? [];
  const visible = useMemo(
    () => (data?.items ?? []).filter((i) => showUncovered || i.hasEstimate),
    [data, showUncovered],
  );

  /**
   * 기본 정렬 눈금.
   *
   * 연간은 **내년** — "내년 성장률이 높은 순"이 이 화면의 첫 질문이다. 확정 최신연도 + 1이 아니라
   * 오늘 기준 다음 해다: 확정 최신연도는 작년이고 축의 두 번째 칸이 올해라, +1로 잡으면 올해
   * 전망으로 정렬된다. 분기는 **첫 전망 분기** — 다음 분기가 같은 자리의 질문이다.
   */
  const defaultSortKey = useMemo(() => {
    if (periods.length === 0) return '';
    const last = periods[periods.length - 1].key;
    if (periodType === 'year') {
      const nextYear = String(new Date().getFullYear() + 1);
      return periods.some((p) => p.key === nextYear) ? nextYear : last;
    }
    const firstEstimate = periods.find((p) => periodKindOf(visible, p.key) === 'estimate');
    return firstEstimate?.key ?? last;
  }, [periods, periodType, visible]);

  const axisNote = periodType === 'quarter'
    ? '확정 4개 분기와 향후 3개 분기 전망을 나란히 봅니다.'
    : '확정 실적과 향후 3개년 전망을 나란히 봅니다.';

  const updatedAt = view === 'sectors' ? compare.data?.updatedAt : data?.updatedAt;

  return (
    // max-w-6xl은 산업 레이더·테마 레이더와 같은 폭. 분기 축은 열이 많아 이 폭 안에서
    // 가로 스크롤이 생기는데, 종목명과 숫자가 화면 양끝으로 벌어지는 것보다 낫다.
    <div className="p-6 space-y-4 max-w-6xl">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-gray-900">📈 산업 실적 전망</h1>
        <p className="text-sm text-gray-500">
          {view === 'sectors'
            ? <>산업들의 <b>애널리스트 컨센서스</b>를 나란히 놓고 비교합니다.</>
            : <>산업별 기업들의 확정 실적과 <b>애널리스트 컨센서스</b>를 비교합니다.</>}
          {' '}{axisNote} 전망치는 확정 실적이 아닙니다.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-1.5">
          {([['stocks', '종목 비교'], ['sectors', '산업 비교']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setParams({ view: v })}
              aria-pressed={view === v}
              title={v === 'stocks'
                ? '산업 하나를 골라 그 기업들을 나란히 봅니다'
                : '산업들을 나란히 봅니다 — 칸은 그 산업 종목들의 중앙값입니다'}
              className={`text-xs rounded-full px-3 py-1.5 border font-medium ${
                view === v ? PILL_ON : PILL_OFF
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'stocks' && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">산업</span>
            <select
              value={sector}
              onChange={(e) => setParams({ sector: e.target.value })}
              className="text-sm rounded-lg border border-gray-200 bg-surface px-2 py-1.5 text-gray-900"
            >
              {(sectors ?? [sector]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400">축</span>
          {([['year', '연간'], ['quarter', '분기']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setParams({ period: v })}
              aria-pressed={periodType === v}
              className={`text-xs rounded-full px-3 py-1.5 border font-medium ${
                periodType === v ? PILL_ON : PILL_OFF
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'stocks' && data && (
          <span className="text-sm text-gray-500">
            {data.totalCount}종목 중 <b className="text-gray-900">{data.coveredCount}종목</b> 전망 보유
          </span>
        )}
        {view === 'sectors' && compare.data && (
          <span className="text-sm text-gray-500">
            <b className="text-gray-900">{compare.data.rows.length}개 산업</b> · 칸은 그 산업 종목들의
            중앙값
          </span>
        )}

        {updatedAt && (
          // 컨센서스가 언제 기준인지 상시 노출한다 — 전망치는 수시로 바뀌므로 날짜 없이 보면
          // 몇 달 전 숫자를 오늘 것으로 읽게 된다. 갱신은 평일 18:10 전체 수집이 맡는다.
          <span className="text-xs text-gray-400">
            재무 기준 {new Date(updatedAt).toLocaleDateString('ko-KR')}
          </span>
        )}

        {view === 'stocks' && (
          <>
            <label className="ml-auto flex items-center gap-1.5 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={showUncovered}
                onChange={(e) => setShowUncovered(e.target.checked)}
                className="rounded border-gray-300"
              />
              전망 없는 종목도 보기
            </label>

            <button
              onClick={() => downloadOutlookCsv(
                sector, periodType, periods,
                sortedRows.length ? sortedRows : visible, growthBasis,
              )}
              disabled={visible.length === 0}
              // 화면에 보이는 행 그대로 내보낸다 — 필터를 걸어놓고 받으면 그 결과가 나오는 게 자연스럽다.
              // 다만 항목 토글과 달리 CSV는 전 항목(매출·영익·순익·PER·POR)을 함께 담는다.
              title="화면에 보이는 종목을 전 항목(매출·영익·순익·PER·POR)과 함께 내려받습니다"
              className="text-xs rounded-lg border border-gray-200 bg-surface px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              CSV 내려받기
            </button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-400 mr-0.5">항목</span>
          {METRICS.map((m) => (
            <button
              key={m.key}
              // 산업 비교는 매트릭스라 한 항목만 — 종목 표는 여러 항목을 한 칸에 쌓을 수 있다.
              onClick={() => (view === 'sectors' ? setCompareMetric(m.key) : toggleMetric(m.key))}
              aria-pressed={activeMetrics.includes(m.key)}
              className={`text-xs rounded-full px-3 py-1.5 border font-medium ${
                activeMetrics.includes(m.key) ? PILL_ON : PILL_OFF
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {periodType === 'quarter' && hasAmountMetric && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">증가율</span>
            {([['yoy', '전년 동기'], ['qoq', '직전 분기']] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setQuarterGrowthBasis(v)}
                aria-pressed={quarterGrowthBasis === v}
                title={v === 'yoy'
                  ? '전년 같은 분기와 비교 — 계절성이 있는 사업은 이쪽이 실체에 가깝습니다'
                  : '바로 앞 분기와 비교 — 계절성이 섞여 들어갑니다'}
                className={`text-xs rounded-full px-3 py-1.5 border ${
                  quarterGrowthBasis === v
                    ? 'bg-surface text-gray-900 border-gray-400 font-medium'
                    : 'bg-surface text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className={`flex items-center gap-1.5 ${hasAmountMetric && view === 'stocks' ? '' : 'hidden'}`}>
          <span className="text-xs text-gray-400">정렬</span>
          {([['growth', '성장률'], ['amount', '금액']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setSortBasis(v)}
              className={`text-xs rounded-full px-3 py-1.5 border ${
                sortBasis === v
                  ? 'bg-surface text-gray-900 border-gray-400 font-medium'
                  : 'bg-surface text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {(view === 'sectors' ? compare.isLoading : isLoading) && (
        <p className="text-sm text-gray-400">불러오는 중…</p>
      )}
      {(view === 'sectors' ? compare.isError : isError) && (
        <p className="text-sm text-red-500">전망 데이터를 불러오지 못했습니다.</p>
      )}

      {view === 'sectors' && compare.data && (
        // key로 항목·축을 물려 정렬 상태를 초기화한다 — 배수는 오름차순(싼 순), 증가율은
        // 내림차순이 기본 질문이라 항목을 바꾸면 방향도 따라가야 한다. 축을 바꾸면 정렬 기준
        // 열 자체가 사라지므로(2028 → 26Q4) 함께 물린다.
        <SectorCompareTable
          key={`${compareMetric}-${periodType}`}
          data={compare.data}
          metric={compareMetric}
        />
      )}

      {view === 'stocks' && data && data.coveredCount === 0 && !showUncovered && (
        <div className="bg-surface rounded-xl border border-gray-200 p-6 text-sm text-gray-500">
          이 산업은 애널리스트 전망 커버리지가 없습니다. '전망 없는 종목도 보기'를 켜면 확정 실적만
          볼 수 있습니다.
        </div>
      )}

      {view === 'stocks' && data && periods.length > 0 && (data.coveredCount > 0 || showUncovered) && (
        <OutlookTable
          items={visible}
          periods={periods}
          metrics={metrics}
          sortBasis={sortBasis}
          growthBasis={growthBasis}
          defaultSortKey={defaultSortKey}
          onSelect={setSelected}
          onSortedChange={setSortedRows}
        />
      )}

      {view === 'sectors' && (
        <p className="text-xs text-gray-400 leading-relaxed">
          칸은 그 산업 종목들의 <b>중앙값</b>입니다(마우스를 올리면 분모가 보입니다). 매출·영익·순익은
          <b> 증가율의 중앙값</b>, PER·POR은 <b>배수의 중앙값</b>입니다. <b>합계를 쓰지 않는
          이유</b>는 애널리스트 커버리지가 산업의 절반 수준이라 합계가 "몇 개가 커버됐는가"에
          좌우되기 때문입니다 — 중앙값은 표본이 늘거나 줄어도 "이 산업 기업들의 전형적인 수치"라는
          뜻이 유지됩니다. 값을 가진 종목이 2개 미만인 칸은 비워 둡니다. <b>축은 전 시장 공통</b>이라
          산업별 화면(종목 비교)보다 열이 길 수 있고, 그 산업에 값이 없는 열은 비어 있습니다.
          배수 칸에는 색조를 넣지 않습니다 — 증가율은 클수록 좋지만 배수는 작을수록 싸서, 같은 색이
          반대 뜻이 되기 때문입니다. <b>우선주는 표본에서 뺍니다</b> — 별개 기업이 아니라 같은
          회사의 다른 클래스라, 넣으면 그 회사만 두 번 세어집니다(분모도 보통주 기준입니다).
        </p>
      )}

      {view === 'stocks' && (
      <p className="text-xs text-gray-400 leading-relaxed">
        열 머리의 <b>A</b>는 확정 실적, <b>E</b>는 전망입니다. 한 열에 둘이 섞이면 머리에는 표기하지
        않고 <b>칸마다</b> 표시합니다. 증가율이 '—'인 칸은 비교할 직전 기간 값이 없거나 0 이하라
        백분율이 성립하지 않는 경우이며, 적자에서 흑자로 도는 구간은 <b>흑전</b>으로 표시합니다.
        산업 합계는 싣지 않습니다 — 커버리지가 산업의 일부라 합계가 산업 전체를 대표하지 못합니다.
        {' '}<b>우선주 행의 PER·POR은 비어 있습니다</b> — 시총은 그 클래스만인데 이익은 회사
        전체라 배수가 성립하지 않습니다(실측 결과 보통주 대비 중앙 32배 낮게 나왔습니다).
        회사 단위 배수는 같은 회사의 보통주 행에서 보십시오.
        {periodType === 'quarter' && (
          <>
            {' '}분기 축의 <b>PER·POR은 TTM(직전 4개 분기 합) 기준</b>이라 연간 화면과 같은 눈금으로
            비교됩니다. 다만 <b>분기 순이익이 2025Q1부터만 수집되어</b> 그 이전을 포함하는 구간의
            PER은 비어 있습니다(영업이익은 더 과거까지 있어 POR은 채워집니다).
          </>
        )}
      </p>
      )}

      {selected && (
        <StockDetailPanel
          ticker={selected.ticker}
          name={selected.name}
          market={selected.market ?? ''}
          sector={sector}
          totalScore={selected.totalScore}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
