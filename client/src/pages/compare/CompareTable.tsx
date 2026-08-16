import { Fragment } from 'react';
import { CompareMiniChart } from './CompareMiniChart';
import {
  type CompareRow,
  toNum,
  parseBreakdown,
  fmtKrw,
  fmtPer,
  fmtDecimal,
  fmtPercent,
  fmtRawPercent,
  fmtPrice,
  fmtRatio,
  fmtShares,
  opMargin,
  scoreBadgeClass,
  ENGINE_CATEGORIES,
} from './compareFormat';

const ENGINE_BAR_COLORS: Record<string, string> = {
  value:           'bg-blue-400',
  quality:         'bg-emerald-400',
  growth:          'bg-orange-400',
  momentum:        'bg-purple-400',
  tech_innovation: 'bg-pink-400',
};

// ── 균등 열 폭 (table-fixed + colgroup) ────────────────────────
// 지표명 열은 고정폭, 종목 열은 개수(2~4)와 무관하게 서로 동일한 폭으로 분배.
const LABEL_COL_WIDTH_PX = 160;
/** 종목 열이 좁아졌을 때도 가로 스크롤로 전환되도록 하는 최소 폭 (모바일 동작 유지). */
const MIN_STOCK_COL_WIDTH_PX = 180;

interface MetricDef {
  label: string;
  direction: 'up' | 'down' | 'neutral';
  value: (r: CompareRow) => number | null;
  /** 값이 순위 비교에 유효한지 (예: PER 음수/적자 제외) */
  rankable?: (v: number) => boolean;
  render: (r: CompareRow) => string;
}

function bestIndices(rows: CompareRow[], def: MetricDef): Set<number> {
  if (def.direction === 'neutral') return new Set();
  const values = rows.map((r) => {
    const v = def.value(r);
    if (v == null) return null;
    if (def.rankable && !def.rankable(v)) return null;
    return v;
  });
  const validIdx = values.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0);
  if (validIdx.length < 2) return new Set();
  const validVals = validIdx.map((i) => values[i]!);
  const target = def.direction === 'up' ? Math.max(...validVals) : Math.min(...validVals);
  return new Set(validIdx.filter((i) => values[i] === target));
}

function cellClass(isBest: boolean): string {
  return isBest
    ? 'px-3 py-2 text-right text-sm truncate bg-emerald-50 text-emerald-700 font-semibold rounded'
    : 'px-3 py-2 text-right text-sm truncate text-gray-700';
}

function LabelTd({ children }: { children: string }) {
  return (
    <td
      title={children}
      className="sticky left-0 z-[1] bg-surface px-3 py-2 text-xs font-medium text-gray-500 truncate border-r border-gray-100"
    >
      {children}
    </td>
  );
}

function MetricTr({ def, rows }: { def: MetricDef; rows: CompareRow[] }) {
  const best = bestIndices(rows, def);
  return (
    <tr className="border-b border-gray-50">
      <LabelTd>{def.label}</LabelTd>
      {rows.map((r, i) => (
        <td key={r.ticker} className={cellClass(best.has(i))}>{def.render(r)}</td>
      ))}
    </tr>
  );
}

function SectionHeaderTr({ label, colSpan }: { label: string; colSpan: number }) {
  return (
    <tr>
      <th colSpan={colSpan} className="bg-gray-50 text-left px-3 py-2 text-xs font-semibold text-gray-600 sticky left-0 z-[1]">
        {label}
      </th>
    </tr>
  );
}

// ── 지표 정의 (섹션별) ─────────────────────────────────────────

const VALUE_METRICS: MetricDef[] = [
  { label: 'tPER', direction: 'down', value: (r) => toNum(r.per), rankable: (v) => v > 0,
    render: (r) => fmtPer(toNum(r.per)) },
  { label: 'fPER', direction: 'down', value: (r) => toNum(r.forward_per), rankable: (v) => v > 0,
    render: (r) => fmtPer(toNum(r.forward_per)) },
  { label: 'PBR', direction: 'down', value: (r) => toNum(r.pbr), rankable: (v) => v > 0,
    render: (r) => fmtDecimal(toNum(r.pbr)) },
  { label: '배당수익률', direction: 'up', value: (r) => toNum(r.div_yield),
    render: (r) => fmtPercent(toNum(r.div_yield)) },
  { label: 'EV/EBITDA', direction: 'down', value: (r) => toNum(r.ev_ebitda), rankable: (v) => v > 0,
    render: (r) => fmtDecimal(toNum(r.ev_ebitda), 1) },
];

const QUALITY_METRICS: MetricDef[] = [
  { label: 'ROE', direction: 'up', value: (r) => toNum(r.roe),
    render: (r) => fmtPercent(toNum(r.roe)) },
  { label: '부채비율', direction: 'down', value: (r) => toNum(r.debt_ratio),
    render: (r) => fmtPercent(toNum(r.debt_ratio)) },
  { label: '영업이익률', direction: 'up', value: (r) => {
      const rev = toNum(r.revenue); const op = toNum(r.operating_income);
      return rev != null && rev > 0 && op != null ? (op / rev) * 100 : null;
    },
    render: (r) => opMargin(toNum(r.revenue), toNum(r.operating_income)) },
];

const GROWTH_METRICS: MetricDef[] = [
  { label: '매출성장률', direction: 'up', value: (r) => toNum(r.revenue_growth),
    render: (r) => fmtPercent(toNum(r.revenue_growth)) },
  { label: 'EPS성장률', direction: 'up', value: (r) => toNum(r.eps_growth),
    render: (r) => fmtPercent(toNum(r.eps_growth)) },
];

const SCALE_METRICS: MetricDef[] = [
  { label: '시가총액', direction: 'neutral', value: (r) => toNum(r.market_cap),
    render: (r) => fmtKrw(toNum(r.market_cap)) },
  { label: '매출', direction: 'neutral', value: (r) => toNum(r.revenue),
    render: (r) => fmtKrw(toNum(r.revenue)) + (r.fiscal_year ? ` '${String(r.fiscal_year).slice(2)}` : '') },
  { label: '영업이익', direction: 'neutral', value: (r) => toNum(r.operating_income),
    render: (r) => fmtKrw(toNum(r.operating_income)) },
  { label: '현재가', direction: 'neutral', value: (r) => toNum(r.last_close),
    render: (r) => fmtPrice(toNum(r.last_close)) },
];

const TECH_METRICS: MetricDef[] = [
  { label: '52주고점대비', direction: 'up', value: (r) => toNum(r.pct_from_52w_high),
    render: (r) => fmtRawPercent(toNum(r.pct_from_52w_high)) },
  { label: 'RSI(14)', direction: 'neutral', value: (r) => toNum(r.rsi14),
    render: (r) => fmtDecimal(toNum(r.rsi14), 1) },
  { label: '거래량배율', direction: 'neutral', value: (r) => toNum(r.vol_ratio),
    render: (r) => fmtRatio(toNum(r.vol_ratio)) },
  { label: '외국인 20일 순매수', direction: 'up', value: (r) => toNum(r.foreign_net_20d),
    render: (r) => fmtShares(toNum(r.foreign_net_20d)) },
  { label: '기관 20일 순매수', direction: 'up', value: (r) => toNum(r.inst_net_20d),
    render: (r) => fmtShares(toNum(r.inst_net_20d)) },
  { label: '외인보유율', direction: 'neutral', value: (r) => toNum(r.foreign_hold_ratio),
    render: (r) => fmtRawPercent(toNum(r.foreign_hold_ratio)) },
];

interface MetricSection {
  key: string;
  label: string;
  metrics: MetricDef[];
}

/** 지표 커스텀 설정 패널(ComparePage)·테이블 렌더링이 공유하는 섹션 정의 — 5섹션 구조 단일 소스. */
export const METRIC_SECTIONS: MetricSection[] = [
  { key: 'value', label: '밸류', metrics: VALUE_METRICS },
  { key: 'quality', label: '퀄리티', metrics: QUALITY_METRICS },
  { key: 'growth', label: '성장', metrics: GROWTH_METRICS },
  { key: 'scale', label: '규모·가격', metrics: SCALE_METRICS },
  { key: 'tech', label: '기술·수급', metrics: TECH_METRICS },
];

function FlagBadge({ ok }: { ok: boolean | null }) {
  if (ok == null) return <span className="text-gray-300">—</span>;
  return (
    <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${ok ? 'text-white bg-rose-500' : 'text-gray-400 bg-gray-100'}`}>
      {ok ? '✓' : '—'}
    </span>
  );
}

function ConsensusTr({ rows }: { rows: CompareRow[] }) {
  return (
    <tr className="border-b border-gray-50">
      <LabelTd>컨센서스 매출·영업익</LabelTd>
      {rows.map((r) => {
        const rev = toNum(r.est_revenue);
        const op = toNum(r.est_operating_income);
        const isEmpty = rev == null && op == null;
        const title = isEmpty
          ? undefined
          : `매출 ${fmtKrw(rev)} · 영업익 ${fmtKrw(op)}${r.est_fiscal_year ? ` ('${String(r.est_fiscal_year).slice(2)}E)` : ''}`;
        return (
          <td key={r.ticker} title={title} className="px-3 py-2 text-right text-xs text-gray-500 truncate">
            {isEmpty ? '—' : (
              <>
                매출 {fmtKrw(rev)} · 영업익 {fmtKrw(op)}
                {r.est_fiscal_year && <span className="text-gray-300"> ('{String(r.est_fiscal_year).slice(2)}E)</span>}
              </>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function FlagsTr({ rows }: { rows: CompareRow[] }) {
  return (
    <tr className="border-b border-gray-50">
      <LabelTd>정배열 · 20일선</LabelTd>
      {rows.map((r) => (
        <td key={r.ticker} className="px-3 py-2 text-right whitespace-nowrap">
          <span className="inline-flex gap-1 justify-end">
            <FlagBadge ok={r.golden_cross} />
            <FlagBadge ok={r.above_ma20} />
          </span>
        </td>
      ))}
    </tr>
  );
}

function totalScoreValue(r: CompareRow): number | null {
  return toNum(r.total_score);
}

function engineScore(r: CompareRow, category: string): number | null {
  const e = parseBreakdown(r.breakdown).find((x) => x.category === category);
  return e ? e.score : null;
}

function ScoreBarCell({ score, color, best }: { score: number | null; color: string; best: boolean }) {
  return (
    <td className={cellClass(best)}>
      {score == null ? '—' : (
        <div className="flex flex-col items-end gap-1">
          <span>{Math.round(score)}점</span>
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
          </div>
        </div>
      )}
    </td>
  );
}

function ScoreRows({ rows }: { rows: CompareRow[] }) {
  const totalDef: MetricDef = { label: '종합점수', direction: 'up', value: totalScoreValue, render: () => '' };
  const totalBest = bestIndices(rows, totalDef);

  return (
    <>
      <tr className="border-b border-gray-50">
        <LabelTd>종합점수</LabelTd>
        {rows.map((r, i) => (
          <ScoreBarCell key={r.ticker} score={totalScoreValue(r)} color="bg-gray-700" best={totalBest.has(i)} />
        ))}
      </tr>
      {ENGINE_CATEGORIES.map(({ key, label }) => {
        const def: MetricDef = { label, direction: 'up', value: (r) => engineScore(r, key), render: () => '' };
        const best = bestIndices(rows, def);
        return (
          <tr key={key} className="border-b border-gray-50">
            <LabelTd>{label}</LabelTd>
            {rows.map((r, i) => (
              <ScoreBarCell
                key={r.ticker}
                score={engineScore(r, key)}
                color={ENGINE_BAR_COLORS[key] ?? 'bg-gray-400'}
                best={best.has(i)}
              />
            ))}
          </tr>
        );
      })}
    </>
  );
}

interface CompareTableProps {
  rows: CompareRow[];
  /** 숨길 지표 label 집합 (ComparePage "지표 설정" 패널 — useHiddenMetrics) */
  hiddenMetrics?: Set<string>;
}

/** 종목 비교 테이블 — 지표명 sticky 첫 열 + 종목당 1열, 섹션별 그룹핑, 최우수 셀 강조. */
export function CompareTable({ rows, hiddenMetrics }: CompareTableProps) {
  const colSpan = 1 + rows.length;

  return (
    <div className="bg-surface rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table
          className="w-full table-fixed text-sm"
          style={{ minWidth: LABEL_COL_WIDTH_PX + rows.length * MIN_STOCK_COL_WIDTH_PX }}
        >
          {/* 지표명 열은 고정폭, 종목 열은 남은 폭을 종목 수만큼 균등 분배 — 열 폭이 데이터 길이에 흔들리지 않도록 함 */}
          <colgroup>
            <col style={{ width: LABEL_COL_WIDTH_PX }} />
            {rows.map((r) => (
              <col key={r.ticker} style={{ width: `calc((100% - ${LABEL_COL_WIDTH_PX}px) / ${rows.length})` }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-gray-100">
              <th className="sticky left-0 z-[1] bg-surface px-3 py-3 border-r border-gray-100" />
              {rows.map((r) => (
                <th key={r.ticker} className="px-3 py-3 text-right">
                  <div className="flex flex-col items-end gap-1 w-full">
                    <span title={r.name} className="max-w-full truncate font-bold text-gray-900">{r.name}</span>
                    <span
                      title={`${r.ticker} · ${r.market}${r.sector ? ` · ${r.sector}` : ''}`}
                      className="max-w-full truncate text-xs text-gray-400"
                    >
                      {r.ticker} · {r.market}{r.sector ? ` · ${r.sector}` : ''}
                    </span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${scoreBadgeClass(toNum(r.total_score))}`}>
                      {toNum(r.total_score) != null ? `${Math.round(toNum(r.total_score)!)}점` : '—'}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
            <tr className="border-b border-gray-100">
              <th className="sticky left-0 z-[1] bg-surface px-3 py-2 border-r border-gray-100" />
              {rows.map((r) => (
                <th key={r.ticker} className="px-2 py-2">
                  <CompareMiniChart ticker={r.ticker} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <SectionHeaderTr label="점수" colSpan={colSpan} />
            <ScoreRows rows={rows} />

            {METRIC_SECTIONS.map((section) => {
              const visible = hiddenMetrics
                ? section.metrics.filter((def) => !hiddenMetrics.has(def.label))
                : section.metrics;
              // 섹션의 지표가 전부 숨겨지면 헤더·부속 행(컨센서스·정배열 배지)도 함께 미표시
              if (visible.length === 0) return null;
              return (
                <Fragment key={section.key}>
                  <SectionHeaderTr label={section.label} colSpan={colSpan} />
                  {visible.map((def) => <MetricTr key={def.label} def={def} rows={rows} />)}
                  {section.key === 'growth' && <ConsensusTr rows={rows} />}
                  {section.key === 'tech' && <FlagsTr rows={rows} />}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
