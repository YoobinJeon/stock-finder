/**
 * 산업 실적 전망 — 축 위의 한 눈금에 **증가율과 배수**를 붙이는 모듈.
 *
 * 연간과 분기가 갈리는 지점이 두 곳이다.
 * 1. 증가율의 기준점: 연간은 직전 연도(= YoY) 하나뿐이지만, 분기는 전년 동기(YoY)와
 *    직전 분기(QoQ) 둘 다 뜻이 있어 **양쪽을 다 계산해 내려보내고 화면이 고른다.**
 * 2. PER·POR의 분모: 연간은 그 해 이익, 분기는 **TTM(직전 4개 분기 합)**이다. 시총 ÷ 한 분기
 *    이익은 연간 배수의 약 4배로 나와, 연간 화면과 나란히 놓으면 같은 이름의 다른 숫자가 된다.
 */
import { growthRate, isTurnaround } from '../../../../pipeline/growthRate';
import { periodIndexOf, type PeriodKey, type PeriodType } from './period';

/** TTM에 합산할 분기 수. */
const TTM_QUARTERS = 4;

export interface FinancialRow {
  fiscal_year: number;
  fiscal_quarter: number | null;
  is_estimate: boolean;
  revenue: number | null;
  operating_income: number | null;
  net_income: number | null;
}

/** 한 항목의 직전 기간 대비 변화. 증가율이 성립하지 않는 구간은 `turnaround`가 대신 말한다. */
export interface Delta {
  growth: number | null;
  turnaround: boolean;
}

export interface Deltas {
  revenue: Delta;
  operatingIncome: Delta;
  netIncome: Delta;
}

/** 한 종목·한 눈금의 실적 또는 전망. */
export interface OutlookPeriod {
  key: string;
  year: number;
  quarter: number | null;
  isEstimate: boolean;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  /** 연간이면 직전 연도 대비, 분기면 전년 동기 대비. */
  yoy: Deltas;
  /** 분기 축에서만 채워진다. 연간은 null — 연간의 '직전 연도 대비'가 곧 YoY다. */
  qoq: Deltas | null;
  /** 영업이익률 — 규모가 다른 기업을 나란히 볼 때 증가율만으로는 체력이 안 보인다. */
  opMargin: number | null;
  /** 시총 ÷ 순이익(연간) 또는 시총 ÷ TTM 순이익(분기). 배. */
  per: number | null;
  /** 시총 ÷ 영업이익(연간) 또는 시총 ÷ TTM 영업이익(분기). 배. */
  por: number | null;
}

/**
 * 배수 = 시가총액 ÷ 이익. 이익이 0 이하면 배수가 성립하지 않으므로 null.
 *
 * ⚠️ **PER도 `stock_financials.per`(네이버 제공)을 쓰지 않고 여기서 계산한다.** 네이버 PER은
 * 주가÷EPS(지배주주 기준)라 분자가 시총과 다르고, 우선주가 있는 종목은 특히 벌어진다
 * (삼성전자 2026E: 저장 4.82 vs 시총 기준 4.2). POR에는 대응하는 저장값이 아예 없어서
 * 계산할 수밖에 없는데, 두 열의 분자가 다르면 "순이익 기준 4.2배 / 영업이익 기준 3.4배"라는
 * 나란한 비교 자체가 깨진다. 그래서 **분자를 시총 하나로 통일**한다.
 */
export function multipleOf(marketCap: number | null, profit: number | null): number | null {
  if (marketCap == null || marketCap <= 0 || profit == null || profit <= 0) return null;
  return marketCap / profit;
}

/**
 * TTM — 이 분기를 포함한 **직전 4개 분기 합**. 네 분기가 모두 있고 값이 하나도 비지 않을
 * 때만 계산하고, 하나라도 없으면 null이다.
 *
 * 구간에 확정과 전망이 섞이는 것은 의도된 것이다(선행 TTM) — 2026Q3E의 TTM은
 * 25Q4(A) + 26Q1(A) + 26Q2(E) + 26Q3(E)이고, "지금 주가로 향후 1년 이익을 사면 몇 배인가"를
 * 묻는 값이다.
 *
 * ⚠️ 순이익은 DB에 2025Q1부터만 있다(그 이전 분기는 DART 백필분이라 매출·영업이익뿐).
 * 따라서 이른 분기 열의 PER은 구조적으로 빈다 — 화면에서 그렇게 밝힌다.
 */
export function ttmSum(
  byIndex: ReadonlyMap<number, FinancialRow>,
  index: number,
  pick: (row: FinancialRow) => number | null,
): number | null {
  let sum = 0;
  for (let i = index - (TTM_QUARTERS - 1); i <= index; i++) {
    const row = byIndex.get(i);
    if (!row) return null;
    const value = pick(row);
    if (value == null) return null;
    sum += value;
  }
  return sum;
}

function deltasBetween(cur: FinancialRow, prev: FinancialRow | undefined): Deltas {
  return {
    revenue: {
      growth: growthRate(cur.revenue, prev?.revenue),
      // 매출은 음수가 될 수 없어 흑자전환 개념이 없다.
      turnaround: false,
    },
    operatingIncome: {
      growth: growthRate(cur.operating_income, prev?.operating_income),
      turnaround: isTurnaround(cur.operating_income, prev?.operating_income),
    },
    netIncome: {
      growth: growthRate(cur.net_income, prev?.net_income),
      turnaround: isTurnaround(cur.net_income, prev?.net_income),
    },
  };
}

/** YoY 기준점까지의 거리 — 연간은 1년 전, 분기는 4분기 전. */
function yoyStep(type: PeriodType): number {
  return type === 'quarter' ? 4 : 1;
}

/**
 * 종목의 기간 행에 증가율과 배수를 붙인다. 축에 없는 눈금은 결과에서 버린다.
 *
 * 증가율의 기준점은 **축 밖이라도 데이터가 있으면 쓴다** — 그래야 축 첫 칸에도 증가율이 나온다.
 * `marketCap`은 **현재** 시총이다: 연도별 값이 아니라 "지금 주가로 그 해 이익을 사면 몇 배인가".
 */
export function attachMetrics(
  rows: readonly FinancialRow[],
  axis: readonly PeriodKey[],
  type: PeriodType,
  marketCap: number | null = null,
): Record<string, OutlookPeriod> {
  const byIndex = new Map<number, FinancialRow>();
  for (const r of rows) byIndex.set(periodIndexOf(r.fiscal_year, r.fiscal_quarter), r);

  const isQuarter = type === 'quarter';
  const out: Record<string, OutlookPeriod> = {};

  for (const period of axis) {
    const index = periodIndexOf(period.year, period.quarter);
    const cur = byIndex.get(index);
    if (!cur) continue;

    const netBase = isQuarter
      ? ttmSum(byIndex, index, (r) => r.net_income)
      : cur.net_income;
    const opBase = isQuarter
      ? ttmSum(byIndex, index, (r) => r.operating_income)
      : cur.operating_income;

    out[period.key] = {
      key: period.key,
      year: period.year,
      quarter: period.quarter,
      isEstimate: cur.is_estimate,
      revenue: cur.revenue,
      operatingIncome: cur.operating_income,
      netIncome: cur.net_income,
      yoy: deltasBetween(cur, byIndex.get(index - yoyStep(type))),
      qoq: isQuarter ? deltasBetween(cur, byIndex.get(index - 1)) : null,
      opMargin:
        cur.revenue != null && cur.revenue > 0 && cur.operating_income != null
          ? cur.operating_income / cur.revenue
          : null,
      per: multipleOf(marketCap, netBase),
      por: multipleOf(marketCap, opBase),
    };
  }
  return out;
}

/**
 * 전망을 실제로 갖고 있는가.
 *
 * ⚠️ `is_estimate` 행의 **존재**로 판정하면 안 된다. 애널리스트 커버리지가 없는 종목에도
 * 금액이 전부 null인 빈 전망 행이 만들어져 있어서(반도체 166종목 전부가 행은 갖고 있고
 * 값이 있는 건 84종목뿐이었다), 행만 세면 커버리지가 100%로 보인다.
 */
export function hasUsableEstimate(periods: Record<string, OutlookPeriod>): boolean {
  return Object.values(periods).some(
    (p) => p.isEstimate &&
      (p.revenue != null || p.operatingIncome != null || p.netIncome != null),
  );
}
