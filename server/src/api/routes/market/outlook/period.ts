/**
 * 산업 실적 전망 — **축**을 정하는 모듈.
 *
 * 연간 축과 분기 축은 "종목마다 결산 시점이 다를 수 있으니 산업 단위로 축을 하나만 쓴다"는
 * 같은 규칙을 따르고, 눈금의 단위만 다르다. 그래서 두 축을 **단조 증가 정수 인덱스** 하나로
 * 통일해 다룬다 — 연간은 연도 그 자체, 분기는 `year*4 + (q-1)`.
 */

export type PeriodType = 'year' | 'quarter';

/** 축의 한 눈금. `key`는 화면·JSON 키로 쓰는 문자열이다 — `"2026"` 또는 `"2026Q2"`. */
export interface PeriodKey {
  key: string;
  year: number;
  /** 연간 축이면 null. */
  quarter: number | null;
}

/**
 * 축의 폭 — base(확정 최신)를 기준으로 뒤로 몇 칸, 앞으로 몇 칸.
 *
 * 연간은 확정 1 + 전망 3. 분기는 확정 4 + 전망 3 — 계절성이 있는 사업은 네 분기가 다 있어야
 * 한 바퀴가 보이고, 전년 동기(YoY)가 화면 안에 함께 놓여 눈으로 대조된다.
 */
const SPAN: Record<PeriodType, { back: number; forward: number }> = {
  year: { back: 0, forward: 3 },
  quarter: { back: 3, forward: 3 },
};

/** 축 산출에 필요한 최소 행 모양 — 금액은 "이 눈금에 값이 있는가" 판정에만 쓴다. */
export interface AxisRow {
  ticker: string;
  fiscal_year: number;
  fiscal_quarter: number | null;
  is_estimate: boolean;
  revenue: number | null;
  operating_income: number | null;
  net_income: number | null;
}

export function periodKeyOf(year: number, quarter: number | null): string {
  return quarter == null ? String(year) : `${year}Q${quarter}`;
}

/** (연, 분기) → 단조 증가 인덱스. 분기 축의 대소·거리 비교는 전부 이 값으로 한다. */
export function periodIndexOf(year: number, quarter: number | null): number {
  return quarter == null ? year : year * 4 + (quarter - 1);
}

export function periodFromIndex(index: number, type: PeriodType): PeriodKey {
  if (type === 'year') return { key: String(index), year: index, quarter: null };
  const year = Math.floor(index / 4);
  const quarter = (index % 4) + 1;
  return { key: periodKeyOf(year, quarter), year, quarter };
}

/**
 * 이 행이 **값을 갖고 있는가**.
 *
 * ⚠️ 행의 존재만으로 판정하면 안 된다. 애널리스트 커버리지가 없는 종목에도 금액이 전부 null인
 * 빈 전망 행이 만들어져 있어서(2027Q1에 값 없는 행 10건), 행만 세면 아무도 값을 갖지 않은
 * 유령 열이 축에 끼어든다.
 */
export function hasAmount(row: Pick<AxisRow, 'revenue' | 'operating_income' | 'net_income'>): boolean {
  return row.revenue != null || row.operating_income != null || row.net_income != null;
}

/** 이 행이 요청한 축 종류에 속하는가 — 연간 행은 `fiscal_quarter IS NULL`. */
function belongsTo(row: AxisRow, type: PeriodType): boolean {
  return (row.fiscal_quarter != null) === (type === 'quarter');
}

/**
 * 축을 정한다 — **산업 단위로 하나만** 쓴다.
 *
 * 기준(base)은 종목별 '자기 최신 확정 눈금'의 **최빈값**이다.
 *
 * ⚠️ 전체 최댓값을 쓰면 안 된다. 결산이 앞선 소수 종목이 산업 전체 축을 끌어올린다 — 실제로
 * IT서비스 109종목 중 2종목(조기결산)이 축을 2026부터 시작하게 만들어 나머지 107종목의 2025
 * 확정 실적이 화면에서 통째로 사라지고, 그들의 2026 **추정치**가 '2026A'(확정) 헤더 아래
 * 놓였다(2026-08-11 레드팀에서 650건 발견). 분기 축에도 같은 씨앗이 있다 — 2026Q2에 확정
 * 10종목이 섞여 있다.
 */
export function buildAxis(rows: readonly AxisRow[], type: PeriodType): PeriodKey[] {
  const relevant = rows.filter((r) => belongsTo(r, type) && hasAmount(r));
  if (relevant.length === 0) return [];

  const latestActual = new Map<string, number>();
  for (const r of relevant) {
    if (r.is_estimate) continue;
    const index = periodIndexOf(r.fiscal_year, r.fiscal_quarter);
    const cur = latestActual.get(r.ticker);
    if (cur == null || index > cur) latestActual.set(r.ticker, index);
  }

  const freq = new Map<number, number>();
  for (const index of latestActual.values()) freq.set(index, (freq.get(index) ?? 0) + 1);

  let base: number | null = null;
  let bestCount = -1;
  for (const [index, count] of freq) {
    // 동률이면 더 최근 눈금 — 앞서 마감한 쪽의 확정 실적을 버리지 않는다.
    if (count > bestCount || (count === bestCount && base != null && index > base)) {
      base = index;
      bestCount = count;
    }
  }

  const present = new Set(relevant.map((r) => periodIndexOf(r.fiscal_year, r.fiscal_quarter)));
  // 확정 행이 하나도 없으면(전망만 있는 산업) 값이 있는 가장 이른 눈금부터 시작한다.
  if (base == null) base = Math.min(...present);

  const { back, forward } = SPAN[type];
  const axis: PeriodKey[] = [];
  for (let i = base - back; i <= base + forward; i++) {
    // 어떤 종목도 값을 갖지 않은 눈금은 축에 넣지 않는다 — 빈 열은 정보가 아니라 잡음이다.
    if (!present.has(i)) continue;
    axis.push(periodFromIndex(i, type));
  }
  return axis;
}
