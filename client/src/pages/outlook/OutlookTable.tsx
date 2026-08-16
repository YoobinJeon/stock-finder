import { useEffect, useMemo } from 'react';
import { SortableTh, useClientSort } from '../../shared/components/SortableTh';
import { clickableRowProps, CLICKABLE_ROW_CLASS } from '../../shared/lib/clickableRow';
import type { SortState, SortValue } from '../../shared/lib/clientSort';
import {
  METRICS, deltaOf, periodHeaderLabel, periodKindOf,
  type GrowthBasis, type MetricKey, type MetricSpec,
  type OutlookItem, type OutlookPeriod, type PeriodKey, type PeriodKind,
} from './outlookTypes';

/** 정렬을 금액 기준으로 볼지 증가율 기준으로 볼지 — 금액 항목 칸에 둘 다 들어 있어 사용자가 고른다. */
export type SortBasis = 'growth' | 'amount';

/** 열 하나가 차지하는 대략적인 폭(px) — 표 최소폭을 열 수에서 계산한다. */
const COL_WIDTH = 108;
/** 종목명 + 시총 두 고정 열의 폭(px). */
const FIXED_WIDTH = 300;

/** 정렬 키 — (눈금, 항목) 쌍. 한 칸에 여러 값이 쌓이므로 눈금만으로는 기준이 정해지지 않는다. */
function sortKeyOf(periodKey: string, metric: MetricKey): string {
  return `p${periodKey}:${metric}`;
}

/** 배수는 소수 한 자리 + '배'. 100배를 넘으면 소수점이 의미 없어 정수로 줄인다. */
function fmtMultiple(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1)}배`;
}

function fmtAmount(won: number | null): string {
  if (won == null) return '—';
  const eok = won / 1e8;
  if (Math.abs(eok) >= 10000) return `${(eok / 10000).toFixed(1)}조`;
  return `${Math.round(eok).toLocaleString()}억`;
}

function GrowthText({ value, turnaround }: { value: number | null; turnaround: boolean }) {
  // 흑자전환은 증가율이 성립하지 않는 구간이라(분모가 음수) 숫자 대신 배지로 알린다.
  if (turnaround) return <span className="text-xs text-red-600 font-medium">흑전</span>;
  if (value == null) return <span className="text-xs text-gray-300">—</span>;
  const cls = value > 0 ? 'text-red-600' : value < 0 ? 'text-blue-600' : 'text-gray-400';
  return (
    <span className={`text-xs ${cls}`}>
      {value >= 0 ? '+' : ''}{(value * 100).toFixed(1)}%
    </span>
  );
}

interface OutlookTableProps {
  items: OutlookItem[];
  periods: PeriodKey[];
  /** 함께 볼 항목들. 비어 있을 수 없다 — 화면이 최소 1개를 보장한다. */
  metrics: MetricKey[];
  sortBasis: SortBasis;
  /** 증가율 기준 — 분기 축에서만 'qoq'가 될 수 있다. */
  growthBasis: GrowthBasis;
  /** 기본 정렬 눈금의 키. */
  defaultSortKey: string;
  onSelect: (item: OutlookItem) => void;
  /**
   * 정렬된 행을 위로 알린다 — CSV가 **화면과 같은 순서**로 나가야 하기 때문이다.
   * 정렬 상태는 이 컴포넌트 안(`useClientSort`)에 있어서 페이지가 알 길이 없다.
   */
  onSortedChange?: (rows: OutlookItem[]) => void;
}

export function OutlookTable({
  items, periods, metrics, sortBasis, growthBasis, defaultSortKey, onSelect, onSortedChange,
}: OutlookTableProps) {
  // METRICS 순서로 정규화 — 사용자가 누른 순서대로 쌓이면 행마다 줄 위치가 달라져 읽기 어렵다.
  const specs = useMemo<MetricSpec[]>(
    () => METRICS.filter((m) => metrics.includes(m.key)),
    [metrics],
  );

  /**
   * 정렬 키는 **(눈금, 항목) 쌍**이다 — 한 칸에 여러 값이 쌓이므로 "2027년 열"만으로는
   * 어느 값으로 정렬할지 정해지지 않는다. 헤더에서 항목 줄을 직접 눌러 고른다.
   */
  const accessors = useMemo(() => {
    const map: Record<string, (i: OutlookItem) => SortValue> = {
      name: (i) => i.name,
      marketCap: (i) => i.marketCap,
    };
    for (const period of periods) {
      for (const spec of specs) {
        map[sortKeyOf(period.key, spec.key)] = (i) => {
          const cell = i.periods[period.key];
          if (!cell) return null;
          // 배수 항목은 값이 하나뿐이라 금액/증가율 토글과 무관하다.
          if (spec.format === 'multiple') return spec.amountOf(cell);
          if (sortBasis === 'amount') return spec.amountOf(cell);
          return deltaOf(spec, cell, growthBasis)?.growth ?? null;
        };
      }
    }
    return map;
  }, [periods, specs, sortBasis, growthBasis]);

  // 열이 확정인지 전망인지 섞였는지 — 값에서 판정한다(위치로 단정하지 않는다).
  const kinds = useMemo(
    () => new Map(periods.map((p) => [p.key, periodKindOf(items, p.key)])),
    [periods, items],
  );

  // 보고 있던 항목을 끄면 훅이 이 키로 물러난다.
  const fallbackKey = sortKeyOf(defaultSortKey, (specs[0] ?? METRICS[0]).key);
  const { sorted, sort, onSort } = useClientSort(items, accessors, fallbackKey);

  useEffect(() => { onSortedChange?.(sorted); }, [sorted, onSortedChange]);

  const minWidth = FIXED_WIDTH + periods.length * COL_WIDTH;

  return (
    <div className="bg-surface rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth }}>
          <thead>
            <tr className="bg-gray-50 text-left text-xs text-gray-500">
              <SortableTh label="종목" col="name" sort={sort} onSort={onSort} align="left" pad="px-4 py-3" />
              <SortableTh label="시총" col="marketCap" sort={sort} onSort={onSort} />
              {periods.map((period) => (
                <PeriodHeader
                  key={period.key}
                  period={period}
                  kind={kinds.get(period.key) ?? null}
                  specs={specs}
                  sortBasis={sortBasis}
                  growthBasis={growthBasis}
                  sort={sort}
                  onSort={onSort}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => (
              <tr
                key={item.ticker}
                {...clickableRowProps(() => onSelect(item), `${item.name} 상세 열기`)}
                className={`border-t border-gray-100 hover:bg-gray-50 ${CLICKABLE_ROW_CLASS}`}
              >
                <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap align-top">
                  {item.name}
                </td>
                <td className="px-3 py-3 text-right text-gray-500 whitespace-nowrap align-top">
                  {fmtAmount(item.marketCap)}
                </td>
                {periods.map((period) => (
                  <PeriodCell
                    key={period.key}
                    cell={item.periods[period.key]}
                    specs={specs}
                    growthBasis={growthBasis}
                    // 섞인 열에서만 칸마다 확정/전망을 표시한다 — 균일한 열은 헤더로 충분하다.
                    showKind={kinds.get(period.key) === 'mixed'}
                  />
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={periods.length + 2} className="px-4 py-6 text-sm text-gray-400">
                  표시할 종목이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const BASIS_LABEL: Record<GrowthBasis, string> = { yoy: '전년 동기', qoq: '직전 분기' };

/**
 * 눈금 헤더 — 항목을 **칸과 같은 순서로 세로로 쌓고 각 줄을 정렬 버튼으로** 둔다.
 *
 * 열을 (눈금 × 항목)으로 쪼개지 않은 이유: 5항목 × 7분기 = 35열이면 가로 스크롤 없이 한 행을
 * 볼 수 없다. 대신 헤더 줄 순서를 칸의 줄 순서와 일치시켜, 정렬하고 싶은 숫자 바로 위의
 * 이름을 누르면 되게 했다 — "PER로 정렬"과 "매출 증가율로 정렬"이 한 열 안에서 갈린다.
 *
 * 항목이 하나뿐이면 줄을 나눌 필요가 없어 눈금 자체가 정렬 버튼이 된다.
 */
function PeriodHeader({
  period, kind, specs, sortBasis, growthBasis, sort, onSort,
}: {
  period: PeriodKey;
  kind: PeriodKind | null;
  specs: MetricSpec[];
  sortBasis: SortBasis;
  growthBasis: GrowthBasis;
  sort: SortState;
  onSort: (col: string) => void;
}) {
  const label = periodHeaderLabel(period, kind);
  const kindHint = kind === 'mixed' ? ' (확정·전망 혼재 — 칸의 A/E 표시 참고)' : '';

  const single = specs.length === 1;
  const hintOf = (spec: MetricSpec) =>
    spec.format === 'multiple'
      ? `${spec.label} 배수 기준으로 정렬`
      : sortBasis === 'amount'
        ? `${spec.label} 금액 기준으로 정렬`
        : `${spec.label} ${BASIS_LABEL[growthBasis]} 대비 증가율 기준으로 정렬`;

  if (single) {
    return (
      <SortableTh
        label={label}
        col={sortKeyOf(period.key, specs[0].key)}
        sort={sort}
        onSort={onSort}
        title={`클릭하여 정렬 (${hintOf(specs[0])})${kindHint}`}
      />
    );
  }

  const activeHere = specs.some((s) => sort.key === sortKeyOf(period.key, s.key));
  return (
    <th
      className="px-3 py-3 text-right text-xs font-medium align-bottom"
      aria-sort={activeHere ? (sort.order === 'desc' ? 'descending' : 'ascending') : 'none'}
    >
      <div className="text-gray-500 mb-1.5" title={kindHint || undefined}>{label}</div>
      <div className="space-y-1 font-normal">
        {specs.map((spec) => {
          const col = sortKeyOf(period.key, spec.key);
          const active = sort.key === col;
          return (
            <button
              key={spec.key}
              type="button"
              onClick={() => onSort(col)}
              title={hintOf(spec)}
              className={`block w-full text-right select-none focus:outline-none
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500
                focus-visible:outline-offset-2 hover:text-blue-600 ${
                  active ? 'text-blue-600 font-medium' : 'text-gray-400'
                }`}
            >
              {spec.short}{active && (sort.order === 'desc' ? ' ▼' : ' ▲')}
            </button>
          );
        })}
      </div>
    </th>
  );
}

/**
 * 한 눈금 칸 — 선택한 항목을 위에서 아래로 쌓는다.
 *
 * 항목이 하나면 이름표를 붙이지 않고(무엇인지 토글로 이미 안다), 둘 이상일 때만 짧은 이름표를
 * 왼쪽에 두어 어느 줄이 무엇인지 가린다.
 */
function PeriodCell({ cell, specs, growthBasis, showKind }: {
  cell: OutlookPeriod | undefined;
  specs: MetricSpec[];
  growthBasis: GrowthBasis;
  /** 열에 확정·전망이 섞여 있어 칸마다 어느 쪽인지 밝혀야 하는가. */
  showKind: boolean;
}) {
  if (!cell) return <td className="px-3 py-3 text-right text-gray-300 align-top">—</td>;
  const labeled = specs.length > 1;

  return (
    <td className="px-3 py-3 text-right whitespace-nowrap align-top">
      {showKind && (
        <div className="mb-0.5">
          <span
            className={`text-[10px] px-1 rounded ${
              cell.isEstimate ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'
            }`}
            title={cell.isEstimate ? '애널리스트 전망치' : '확정 실적'}
          >
            {cell.isEstimate ? 'E' : 'A'}
          </span>
        </div>
      )}
      <div className="space-y-1">
        {specs.map((spec) => {
          const delta = deltaOf(spec, cell, growthBasis);
          return (
            <div key={spec.key} className="flex items-baseline justify-end gap-1.5">
              {labeled && <span className="text-[10px] text-gray-400">{spec.short}</span>}
              {spec.format === 'multiple' ? (
                <span className="text-gray-900">{fmtMultiple(spec.amountOf(cell))}</span>
              ) : (
                <>
                  <span className="text-gray-900">{fmtAmount(spec.amountOf(cell))}</span>
                  <GrowthText
                    value={delta?.growth ?? null}
                    turnaround={delta?.turnaround ?? false}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </td>
  );
}
