import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client';
import { API } from '../../shared/api/endpoints';
import { SortableTh, useClientSort } from '../../shared/components/SortableTh';
import type { SortValue } from '../../shared/lib/clientSort';
import {
  AXIS_LABEL, fmtEok, fmtPct, heatStyle, monthLabel, pctColorClass,
  type Axis, type GroupDetailResponse, type GroupRow, type MonthlyGroupsResponse,
} from './monthlyTypes';

/** 기본으로 펼쳐 보이는 최근 개월 수 — 달이 쌓여도 첫 화면이 가로로 넘치지 않게. */
const DEFAULT_MONTHS = 12;

interface GroupMatrixProps {
  data: MonthlyGroupsResponse;
  onSelectStock: (row: { ticker: string; name: string; market: string | null }) => void;
}

/**
 * 묶음 × 월 매트릭스 — 행이 테마 또는 산업, 열이 달이다. 달이 지나면 열이 하나 늘어난다.
 *
 * 칸은 **멤버 수익률의 중앙값**이고, 마우스를 올리면 평균·상승 비율·분모가 함께 보인다.
 * 중앙값과 평균이 크게 벌어지면 한두 종목이 끌고 간 것이므로 그 차이 자체가 신호다.
 */
export function GroupMatrix({ data, onSelectStock }: GroupMatrixProps) {
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const axis = data.axis;

  const months = useMemo(
    () => (showAll ? data.months : data.months.slice(-DEFAULT_MONTHS)),
    [data.months, showAll],
  );

  const accessors = useMemo(() => {
    const map: Record<string, (row: GroupRow) => SortValue> = {
      name: (r) => r.name,
      memberCount: (r) => r.memberCount,
    };
    for (const month of months) map[month] = (r) => r.cells[month]?.median ?? null;
    return map;
  }, [months]);

  // 기본은 가장 최근 달 — "이번 달 뭐가 올랐나"가 이 화면의 첫 질문이다.
  const latest = months[months.length - 1] ?? 'name';
  const { sorted, sort, onSort } = useClientSort(data.rows, accessors, latest);

  return (
    <div className="space-y-3">
      {data.months.length > DEFAULT_MONTHS && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-xs rounded-lg border border-gray-200 bg-surface px-3 py-1.5 text-gray-600 hover:bg-gray-50"
        >
          {showAll ? `최근 ${DEFAULT_MONTHS}개월만 보기` : `전체 ${data.months.length}개월 보기`}
        </button>
      )}

      <div className="bg-surface rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 280 + months.length * 78 }}>
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500">
                <SortableTh label={AXIS_LABEL[axis]} col="name" sort={sort} onSort={onSort} align="left" pad="px-4 py-3" />
                <SortableTh label="종목수" col="memberCount" sort={sort} onSort={onSort} />
                {months.map((month) => (
                  <SortableTh
                    key={month}
                    label={month === data.partialMonth ? `${monthLabel(month)}*` : monthLabel(month)}
                    col={month}
                    sort={sort}
                    onSort={onSort}
                    title={month === data.partialMonth
                      ? `${month} (진행 중, ${data.asOf} 기준) — 클릭하여 중앙값 기준 정렬`
                      : `${month} 중앙값 기준으로 정렬`}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <GroupRowView
                  key={row.key}
                  axis={axis}
                  row={row}
                  months={months}
                  isExpanded={expanded === row.key}
                  onToggle={() => setExpanded((cur) => (cur === row.key ? null : row.key))}
                  onSelectStock={onSelectStock}
                />
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={months.length + 2} className="px-4 py-6 text-sm text-gray-400">
                    표시할 {AXIS_LABEL[axis]}이(가) 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function GroupRowView({ axis, row, months, isExpanded, onToggle, onSelectStock }: {
  axis: Axis;
  row: GroupRow;
  months: string[];
  isExpanded: boolean;
  onToggle: () => void;
  onSelectStock: (r: { ticker: string; name: string; market: string | null }) => void;
}) {
  return (
    <>
      <tr className="border-t border-gray-100 hover:bg-gray-50">
        <td className="px-4 py-2.5 whitespace-nowrap">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isExpanded}
            className="font-medium text-gray-900 hover:text-blue-600 focus:outline-none
              focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          >
            <span className="text-gray-400 mr-1">{isExpanded ? '▾' : '▸'}</span>
            {row.name}
          </button>
        </td>
        <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{row.memberCount}</td>
        {months.map((month) => {
          const cell = row.cells[month];
          return (
            <td
              key={month}
              className="px-3 py-2.5 text-right whitespace-nowrap"
              style={heatStyle(cell?.median)}
              title={cell
                ? `중앙값 ${fmtPct(cell.median)} · 평균 ${fmtPct(cell.mean)}\n`
                  + `상승 ${Math.round(cell.upRatio * 100)}% (${cell.count}종목 기준)`
                : '그 달 값을 가진 멤버가 2종목 미만입니다'}
            >
              <span className={pctColorClass(cell?.median)}>{fmtPct(cell?.median)}</span>
            </td>
          );
        })}
      </tr>
      {isExpanded && (
        <GroupMemberRows
          axis={axis}
          groupKey={row.key}
          months={months}
          onSelectStock={onSelectStock}
        />
      )}
    </>
  );
}

/**
 * 펼친 묶음의 멤버 종목.
 *
 * ⚠️ 중첩 `<table>`이 아니라 **같은 표의 행**으로 넣는다. 중첩하면 안쪽 표가 자기 열 너비를
 * 따로 정해 월 열이 부모와 어긋나고, 묶음 행과 멤버 행을 같은 달끼리 눈으로 잇는 이 화면의
 * 목적 자체가 깨진다(2026-08-11 브라우저 확인에서 발견).
 */
function GroupMemberRows({ axis, groupKey, months, onSelectStock }: {
  axis: Axis;
  groupKey: string;
  months: string[];
  onSelectStock: (r: { ticker: string; name: string; market: string | null }) => void;
}) {
  const { data, isLoading, isError } = useQuery<GroupDetailResponse>({
    queryKey: ['market', 'monthly', 'group', axis, groupKey],
    queryFn: () => apiClient.get(API.market.monthlyGroup(axis, groupKey)).then((r) => r.data),
  });

  const notice = (text: string, tone: string) => (
    <tr className="bg-gray-50/60">
      <td colSpan={months.length + 2} className={`px-8 py-2 text-xs ${tone}`}>{text}</td>
    </tr>
  );
  if (isLoading) return notice('불러오는 중…', 'text-gray-400');
  if (isError || !data) return notice('멤버 종목을 불러오지 못했습니다.', 'text-red-500');

  // 가장 최근 달 기준 내림차순 — 펼친 이유가 "여기서 뭐가 끌었나"이기 때문이다.
  const latest = months[months.length - 1];
  const items = [...data.items].sort(
    (a, b) => (b.cells[latest] ?? -Infinity) - (a.cells[latest] ?? -Infinity),
  );
  if (items.length === 0) return notice('표시할 멤버 종목이 없습니다.', 'text-gray-400');

  return (
    <>
      {items.map((item) => (
        <tr key={item.ticker} className="bg-gray-50/60 border-t border-gray-100">
          <td className="pl-10 pr-4 py-1.5 whitespace-nowrap">
            <button
              type="button"
              onClick={() => onSelectStock(item)}
              className="text-xs text-gray-700 hover:text-blue-600 focus:outline-none
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
            >
              {item.name}
            </button>
          </td>
          <td className="px-3 py-1.5 text-right text-xs text-gray-400 whitespace-nowrap">
            {fmtEok(item.marketCap)}
          </td>
          {months.map((month) => (
            <td
              key={month}
              className={`px-3 py-1.5 text-right text-xs whitespace-nowrap ${pctColorClass(item.cells[month])}`}
            >
              {fmtPct(item.cells[month])}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
