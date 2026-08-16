import { fmtKrw, fmtPer, fmtPercent } from '../../pages/compare/compareFormat';

/** 연도 1개 열(확정 실적 또는 컨센서스 추정) — StockDetailPanel이 조립해서 넘긴다. */
export interface GuidanceColumn {
  label: string;              // "2025" (확정) 또는 "2026E" (추정)
  isEstimate: boolean;
  /**
   * 열 헤더 아래에 붙는 부가 배지(어닝 서프라이즈 등). 없으면 아무것도 그리지 않으므로
   * 이 필드를 주지 않는 연간 표는 기존 모양 그대로 유지된다.
   */
  badge?: { text: string; tone: 'up' | 'down' | 'neutral' };
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  per: number | null;         // 확정연도=트레일링 PER, 추정연도=fPER
  roe: number | null;         // 소수 (0.15 = 15%)
  opMargin: number | null;    // 소수
  netMargin: number | null;   // 소수
  revenueGrowth: number | null; // 소수, YoY — 소스(YOY) 제공값
}

/** 한 열의 직전 기간 대비 증가율(소수). 계산 불가면 null. */
export interface GuidanceGrowth {
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
}

/**
 * 직전 기간 대비 증가율. 기준(직전 값)이 0 이하이면 증가율이 의미를 잃으므로(적자→흑자 등)
 * null을 반환해 표에서 빈칸으로 남긴다 — "없으면 기입하지 않음" 요구사항.
 */
function growthOf(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null || prev <= 0) return null;
  return (curr - prev) / prev;
}

/**
 * 열들을 순서대로 받아 열별 증가율을 계산한다(첫 열은 직전 기간이 없으므로 전부 null).
 * 매출 증가율은 소스가 내려준 revenueGrowth를 우선 사용하고, 없을 때만 직전 열에서 파생한다.
 */
export function computeGrowths(columns: GuidanceColumn[]): GuidanceGrowth[] {
  return columns.map((c, i) => {
    const prev = i > 0 ? columns[i - 1] : null;
    return {
      revenue: c.revenueGrowth ?? growthOf(c.revenue, prev?.revenue ?? null),
      operatingIncome: growthOf(c.operatingIncome, prev?.operatingIncome ?? null),
      netIncome: growthOf(c.netIncome, prev?.netIncome ?? null),
    };
  });
}

interface RowDef {
  key: string;
  label: string;
  fmt: (v: number | null) => string;
  /** 열·인덱스·증가율 배열에서 표시할 값을 뽑는다 */
  value: (col: GuidanceColumn, idx: number, growths: GuidanceGrowth[]) => number | null;
  /** 증가율처럼 상위 지표에 종속된 행은 들여쓰기·흐린 색으로 표시 */
  isSub?: boolean;
}

// 지표 바로 아래에 그 지표의 증가율을 붙여 세로 스캔이 쉽도록 배치한다
const ROWS: RowDef[] = [
  { key: 'revenue', label: '매출', fmt: fmtKrw, value: (c) => c.revenue },
  { key: 'revenueGrowth', label: '· 매출 증가율', fmt: fmtPercent, value: (_c, i, g) => g[i].revenue, isSub: true },
  { key: 'operatingIncome', label: '영업이익', fmt: fmtKrw, value: (c) => c.operatingIncome },
  { key: 'opGrowth', label: '· 영업이익 증가율', fmt: fmtPercent, value: (_c, i, g) => g[i].operatingIncome, isSub: true },
  { key: 'netIncome', label: '순이익', fmt: fmtKrw, value: (c) => c.netIncome },
  { key: 'netGrowth', label: '· 순이익 증가율', fmt: fmtPercent, value: (_c, i, g) => g[i].netIncome, isSub: true },
  { key: 'per', label: 'PER(fPER)', fmt: fmtPer, value: (c) => c.per },
  { key: 'roe', label: 'ROE', fmt: fmtPercent, value: (c) => c.roe },
  { key: 'opMargin', label: '영업이익률', fmt: fmtPercent, value: (c) => c.opMargin },
  { key: 'netMargin', label: '순이익률', fmt: fmtPercent, value: (c) => c.netMargin },
];

interface GuidanceTableProps {
  columns: GuidanceColumn[];
  /** 표 위 라벨 — 연간/분기 표를 구분한다 */
  title?: string;
  badge?: string;
  /**
   * 증가율 행 라벨에 덧붙일 접미사(예: "(QoQ)"). 연간은 YoY가 기본값이라 비워두고,
   * 분기는 세 지표(매출·영업이익·순이익) 증가율 기준이 일관되게 하나로 통일돼야 하므로
   * 호출측이 어느 기준인지 명시한다.
   */
  growthLabelSuffix?: string;
}

/**
 * 확정 실적 + 컨센서스 추정을 기간별 열로 나란히 보여주는 테이블(연간·분기 공용).
 * 값이 없는 셀은 비워두고("—"는 fmt 헬퍼가 처리), 모든 열에서 값이 없는 행은 통째로 숨긴다
 * (요구사항: "없으면 기입하지 않음"). 열이 하나도 없으면 렌더링하지 않는다.
 */
export function GuidanceTable({
  columns,
  title = '연도별 실적·추정',
  badge = '컨센서스(E)',
  growthLabelSuffix = '',
}: GuidanceTableProps) {
  if (columns.length === 0) return null;

  const growths = computeGrowths(columns);
  const visibleRows = ROWS.filter((row) => columns.some((c, i) => row.value(c, i, growths) != null));
  if (visibleRows.length === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <p className="text-xs font-medium text-gray-500 mb-2">
        <span className="inline-block bg-blue-50 text-blue-600 rounded px-1.5 py-0.5 text-[10px] font-semibold mr-1.5">
          {badge}
        </span>
        {title}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse min-w-[420px]">
          <thead>
            <tr>
              <th className="text-left text-gray-400 font-normal pb-1.5 pr-3 whitespace-nowrap">항목</th>
              {columns.map((c) => (
                <th
                  key={c.label}
                  className={`text-right font-medium pb-1.5 px-2 whitespace-nowrap ${c.isEstimate ? 'text-blue-500' : 'text-gray-600'}`}
                >
                  <span className="block">{c.label}</span>
                  {c.badge && (
                    <span
                      className={`mt-0.5 inline-block rounded px-1 py-0.5 text-[10px] font-semibold ${
                        c.badge.tone === 'up'
                          ? 'bg-emerald-50 text-emerald-600'
                          : c.badge.tone === 'down'
                            ? 'bg-red-50 text-red-600'
                            : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {c.badge.text}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.key} className={row.isSub ? '' : 'border-t border-gray-50'}>
                <td className={`py-1.5 pr-3 whitespace-nowrap ${row.isSub ? 'text-gray-300 pl-2' : 'text-gray-400'}`}>
                  {row.isSub && growthLabelSuffix ? `${row.label}${growthLabelSuffix}` : row.label}
                </td>
                {columns.map((c, i) => (
                  <td
                    key={c.label}
                    className={`text-right py-1.5 px-2 whitespace-nowrap ${
                      row.isSub ? 'text-gray-500 font-normal' : 'text-gray-800 font-semibold'
                    }`}
                  >
                    {row.fmt(row.value(c, i, growths))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
