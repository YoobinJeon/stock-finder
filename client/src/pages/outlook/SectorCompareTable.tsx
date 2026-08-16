import { useMemo } from 'react';
import { SortableTh, useClientSort } from '../../shared/components/SortableTh';
import type { SortValue } from '../../shared/lib/clientSort';
import { fmtPct, heatStyle, pctColorClass } from '../../shared/lib/pctFormat';
import { METRICS, periodLabel, type MetricKey } from './outlookTypes';
import {
  fmtMultiple, isMultipleMetric,
  type SectorCompareResponse, type SectorCompareRow,
} from './sectorCompareTypes';

interface SectorCompareTableProps {
  data: SectorCompareResponse;
  metric: MetricKey;
}

/**
 * 산업 × 기간 매트릭스 — 행이 산업, 열이 기간이다.
 *
 * 칸은 그 산업 종목들의 **중앙값**이다(합계가 아니다 — 커버리지가 산업의 절반 수준이라 합계는
 * "몇 개가 커버됐는가"에 좌우된다). 금액 항목은 증가율 중앙값, PER·POR은 배수 중앙값.
 *
 * 배수 칸에는 색조를 넣지 않는다 — 증가율은 클수록 좋지만 배수는 **작을수록 싸다**. 같은
 * 붉은색이 한쪽에서는 좋고 한쪽에서는 나쁘면 표를 훑는 눈이 거짓 신호를 받는다.
 */
export function SectorCompareTable({ data, metric }: SectorCompareTableProps) {
  const isMultiple = isMultipleMetric(metric);
  const spec = METRICS.find((m) => m.key === metric);
  const periodKeys = useMemo(() => data.periods.map((p) => p.key), [data.periods]);

  const accessors = useMemo(() => {
    const map: Record<string, (row: SectorCompareRow) => SortValue> = {
      sector: (r) => r.sector,
      coveredCount: (r) => r.coveredCount,
    };
    for (const key of periodKeys) map[key] = (r) => r.cells[key]?.[metric]?.median ?? null;
    return map;
  }, [periodKeys, metric]);

  // 기본 정렬 눈금은 **마지막 전망** — "앞으로 어느 산업이 좋은가"가 이 표의 첫 질문이다.
  // 배수는 오름차순(싼 순)이 기본 질문이라 방향을 뒤집는다.
  const initialKey = periodKeys[periodKeys.length - 1] ?? 'sector';
  const { sorted, sort, onSort } = useClientSort(
    data.rows, accessors, initialKey, isMultiple ? 'asc' : 'desc',
  );

  return (
    <div className="bg-surface rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 300 + periodKeys.length * 92 }}>
          <thead>
            <tr className="bg-gray-50 text-left text-xs text-gray-500">
              <SortableTh label="산업" col="sector" sort={sort} onSort={onSort} align="left" pad="px-4 py-3" />
              <SortableTh
                label="전망"
                col="coveredCount"
                sort={sort}
                onSort={onSort}
                title="전망을 가진 종목 수 / 활성 종목 수 — 이 산업 칸이 몇 종목에서 나온 값인지"
              />
              {data.periods.map((p) => (
                <SortableTh
                  key={p.key}
                  label={periodLabel(p)}
                  col={p.key}
                  sort={sort}
                  onSort={onSort}
                  title={isMultiple
                    ? `${p.key} ${spec?.label} 중앙값으로 정렬 (오름차순이 싼 순)`
                    : `${p.key} ${spec?.label} 증가율 중앙값으로 정렬`}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.sector} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5 whitespace-nowrap font-medium text-gray-900">
                  {row.sector}
                </td>
                <td className="px-3 py-2.5 text-right text-xs text-gray-400 whitespace-nowrap">
                  {row.coveredCount}/{row.totalCount}
                </td>
                {periodKeys.map((key) => {
                  const cell = row.cells[key]?.[metric];
                  const title = cell
                    ? `${row.sector} ${key} — ${cell.count}종목 중앙값`
                    : '값을 가진 종목이 2개 미만입니다';
                  if (isMultiple) {
                    return (
                      <td
                        key={key}
                        className="px-3 py-2.5 text-right whitespace-nowrap text-gray-700"
                        title={title}
                      >
                        {fmtMultiple(cell?.median)}
                      </td>
                    );
                  }
                  return (
                    <td
                      key={key}
                      className="px-3 py-2.5 text-right whitespace-nowrap"
                      style={heatStyle(cell?.median)}
                      title={title}
                    >
                      <span className={pctColorClass(cell?.median)}>{fmtPct(cell?.median)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={periodKeys.length + 2} className="px-4 py-6 text-sm text-gray-400">
                  표시할 산업이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
