import type { EngineResult, ScreenerResult } from './types';
import { CATEGORY_COLORS, CATEGORY_LABELS } from './constants';
import { fmtGrowth, fmtKrw } from './format';
import { gradeOf, scoreBadgeStyle, scoreColorClass } from '../../shared/lib/scoreGrade';
import { SORT_BUTTON_CLASS } from '../../shared/lib/clickableRow';

/**
 * 스크리너 표의 표시 전용 조각 — 정렬 헤더, 점수·커버리지 배지, 엔진별 막대.
 * (2026-07-26 ScreenerPage.tsx 분할 — 800줄 규칙. 로직은 그대로 옮겼다.)
 */

export function SortTh({ label, col, filter, onSort, align = 'right', sub, wide, last }: {
  label: string;
  col: string;
  filter: { sort: string; order: 'asc' | 'desc' };
  onSort: (col: string) => void;
  align?: 'left' | 'right';
  sub?: string;
  wide?: boolean;
  last?: boolean;
}) {
  const active = filter.sort === col;
  return (
    <th
      className={`${align === 'left' ? 'text-left' : 'text-right'} ${wide || last ? 'px-5' : 'px-3'} py-3 text-xs font-medium ${
        active ? 'text-blue-600' : 'text-gray-500'
      }`}
      aria-sort={active ? (filter.order === 'desc' ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        title="클릭하여 정렬"
        className={`${SORT_BUTTON_CLASS} ${align === 'left' ? 'text-left' : 'text-right'} hover:text-blue-600`}
      >
        {label}{active && (filter.order === 'desc' ? ' ▼' : ' ▲')}
        {sub && <><br /><span className="font-normal text-gray-400">{sub}</span></>}
      </button>
    </th>
  );
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-gray-300">—</span>;
  const { bg, text } = scoreBadgeStyle(score);
  const grade = gradeOf(score);

  return (
    <div className="flex items-center gap-2 justify-end">
      <span className={`text-xs font-bold px-2 py-0.5 rounded border ${bg} ${text}`}>{grade}</span>
      <span className={`font-bold text-sm ${text}`}>{score}점</span>
    </div>
  );
}

/** 발굴 서브점수(모멘텀 70%·수급 30% 재정규화) 배지 — */
export function DiscoveryBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-gray-300">—</span>;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${scoreColorClass(score)}`}>
      {score}
    </span>
  );
}

/** 데이터 결측 엔진이 있을 때만("available < total") "데이터 n/5" 회색 배지 표시 */
export function CoverageBadge({ breakdown }: { breakdown: EngineResult[] | null }) {
  if (!breakdown) return null;
  const coverage = breakdown.find((e) => e.id === 'coverage_info')?.coverage;
  if (!coverage || coverage.available >= coverage.total) return null;
  return (
    <span
      className="ml-1 text-[10px] font-medium text-gray-400 bg-gray-100 rounded px-1 py-0.5"
      title="재무·시세 데이터가 확보된 점수 엔진 수 / 전체 엔진 수"
    >
      데이터 {coverage.available}/{coverage.total}
    </span>
  );
}

/**
 * 분기 시계열 셀 4종 (분기마다 독립 컬럼).
 *
 * 흩어져 있던 `분기 실적`·`실적 YoY`·`실적 QoQ`·`다음분기(E)`를 **비교 대상 분기까지 각자
 * 컬럼을 가진** 시계열로 바꿨다. 같은 상대 위치(전년 동분기 등)가 열로 맞춰져 종목 간 세로
 * 비교와 컬럼별 정렬이 된다.
 *
 * **헤더는 상대 이름, 분기 번호는 셀 안에 둔다** — 기준 분기가 종목마다 다르기 때문이다
 * (대부분 최신 분기지만 실적 미발표 종목은 한 분기 뒤처진다). 분기가 마감되면 기준 분기가
 * 자동으로 밀리므로 창 전체가 순연된다.
 */

/** 분기 라벨 — "'26 1Q" */
function quarterLabel(year: number | null, quarter: number | null): string {
  if (year == null || quarter == null) return '';
  return `'${String(year).slice(2)} ${quarter}Q`;
}

/** 직전 분기 (1분기면 전년 4분기) — 서버가 라벨을 따로 주지 않아 기준 분기에서 유도한다 */
function previousQuarterOf(year: number, quarter: number): [number, number] {
  return quarter === 1 ? [year - 1, 4] : [year, quarter - 1];
}

/** 금액 한 쌍 "311억 / 123억" — 영업이익 적자는 파랑 */
function AmountPair({ revenue, op }: {
  revenue: number | string | null;
  op: number | string | null;
}) {
  const negativeOp = op != null && Number(op) < 0;
  return (
    <>
      <span className="text-gray-700">{fmtKrw(revenue)}</span>
      <span className="text-gray-300"> / </span>
      <span className={negativeOp ? 'text-blue-600' : 'text-gray-700'}>{fmtKrw(op)}</span>
    </>
  );
}

/** 증가율 한 줄 "YoY +261.5% / 흑자전환" */
function GrowthLine({ basis, revenue, op, turnaround, improving, tone }: {
  basis: string;
  revenue: number | string | null;
  op: number | string | null;
  turnaround: boolean | null;
  improving: boolean | null;
  tone: 'confirmed' | 'estimate';
}) {
  const active = improving === true;
  const color = active
    ? (tone === 'confirmed' ? 'text-red-600 font-medium' : 'text-emerald-600 font-medium')
    : 'text-gray-400';
  return (
    <span className={`block text-[11px] ${color}`}>
      <span className="text-gray-400">{basis} </span>
      {fmtGrowth(revenue)} / {fmtGrowth(op, turnaround)}
    </span>
  );
}

/**
 * 전년 동분기 셀 — **확정·예정 각자의** 전년 동분기 금액. 두 초점 분기(최신 확정 / 다음 분기)가
 * 각각 자기 YoY 비교 대상을 옆에 두게 해, 표를 왼→오로 읽으면 전년 → 올해가 그대로 대응된다.
 * (QoQ 비교 대상인 직전 분기는 열을 하나 더 쓰지 않고 `최신 확정` 셀의 툴팁에 남긴다.)
 */
export function ReferenceQuarterCell({ row, anchor }: {
  row: ScreenerResult;
  anchor: 'confirmed' | 'estimate';
}) {
  const isConfirmed = anchor === 'confirmed';
  const revenue = isConfirmed ? row.yoy_prev_revenue : row.eq_yoy_prev_revenue;
  const op = isConfirmed ? row.yoy_prev_operating_income : row.eq_yoy_prev_operating_income;
  const focusYear = isConfirmed ? row.trend_year : row.eq_year;
  const focusQuarter = isConfirmed ? row.trend_quarter : row.eq_quarter;
  if (focusYear == null || focusQuarter == null || revenue == null) {
    return <span className="text-gray-300">—</span>;
  }

  return (
    <div className="text-xs leading-relaxed">
      <AmountPair revenue={revenue} op={op} />
      <span className="block text-[10px] text-gray-400">
        {quarterLabel(focusYear - 1, focusQuarter)}
      </span>
    </div>
  );
}

/** 최신 확정 분기 — 금액 + YoY·QoQ 증가율 */
export function LatestQuarterCell({ row }: { row: ScreenerResult }) {
  if (row.trend_year == null || row.trend_quarter == null) {
    return <span className="text-gray-300">—</span>;
  }

  // QoQ 비교 대상(직전 분기)은 전용 컬럼을 쓰지 않으므로 여기 툴팁에 남긴다.
  const [prevYear, prevQuarter] = previousQuarterOf(row.trend_year, row.trend_quarter);
  return (
    <div
      className="text-xs leading-relaxed"
      title={
        `직전 분기(${quarterLabel(prevYear, prevQuarter)}): ` +
        `매출 ${fmtKrw(row.qoq_prev_revenue)} · 영업이익 ${fmtKrw(row.qoq_prev_operating_income)}`
      }
    >
      <AmountPair revenue={row.trend_revenue} op={row.trend_operating_income} />
      <span className="block text-[10px] text-gray-400">
        {quarterLabel(row.trend_year, row.trend_quarter)} 확정
        {row.yoy_streak != null && row.yoy_streak >= 2 && (
          <span
            className="ml-1 font-semibold text-amber-600"
            title={`YoY ${row.yoy_streak}분기 연속 개선 (확인된 연속 — 비교 대상이 없는 분기에서 끊긴다)`}
          >
            {row.yoy_streak}Q연속
          </span>
        )}
      </span>
      <GrowthLine
        basis="YoY" revenue={row.revenue_yoy} op={row.op_yoy}
        turnaround={row.op_yoy_turnaround} improving={row.yoy_improving} tone="confirmed"
      />
      <GrowthLine
        basis="QoQ" revenue={row.revenue_qoq} op={row.op_qoq}
        turnaround={row.op_qoq_turnaround} improving={row.qoq_improving} tone="confirmed"
      />
    </div>
  );
}

/** 다음 분기 컨센서스 — 금액 + YoY·QoQ 전망. 확정이 아니므로 (E)를 명시하고 색을 달리한다. */
export function EstimateQuarterCell({ row }: { row: ScreenerResult }) {
  // 분기 행은 있어도 금액·증가율이 전부 비는 종목이 있다(컨센서스 미커버) — 한 줄로 접는다.
  const hasFigures =
    row.eq_revenue != null || row.eq_operating_income != null ||
    row.eq_revenue_yoy != null || row.eq_op_yoy != null ||
    row.eq_revenue_qoq != null || row.eq_op_qoq != null;
  if (row.eq_year == null || !hasFigures) return <span className="text-gray-300">—</span>;

  return (
    <div
      className="text-xs leading-relaxed"
      title={
        `전년 동분기(${quarterLabel(row.eq_year - 1, row.eq_quarter)}): ` +
        `매출 ${fmtKrw(row.eq_yoy_prev_revenue)} · 영업이익 ${fmtKrw(row.eq_yoy_prev_operating_income)}`
      }
    >
      <AmountPair revenue={row.eq_revenue} op={row.eq_operating_income} />
      <span className="block text-[10px] text-gray-400">
        {quarterLabel(row.eq_year, row.eq_quarter)} 컨센서스
      </span>
      <GrowthLine
        basis="YoY" revenue={row.eq_revenue_yoy} op={row.eq_op_yoy}
        turnaround={row.eq_op_yoy_turnaround} improving={row.est_yoy_improving} tone="estimate"
      />
      <GrowthLine
        basis="QoQ" revenue={row.eq_revenue_qoq} op={row.eq_op_qoq}
        turnaround={row.eq_op_qoq_turnaround} improving={row.est_qoq_improving} tone="estimate"
      />
    </div>
  );
}

export function BreakdownBars({ breakdown }: { breakdown: EngineResult[] | null }) {
  if (!breakdown) return null;
  const engines = breakdown.filter((e) => e.category !== 'adjustment');
  if (engines.length === 0) return null;
  return (
    <div className="flex gap-0.5 items-end h-4 mt-1">
      {engines.map((e) => (
        <div
          key={e.id}
          title={`${CATEGORY_LABELS[e.category] ?? e.name}: ${e.score}점`}
          className={`flex-1 rounded-sm opacity-80 ${CATEGORY_COLORS[e.category] ?? 'bg-gray-400'}`}
          style={{ height: `${(e.score / 100) * 16}px`, minHeight: 2 }}
        />
      ))}
    </div>
  );
}
