/**
 * 월간 상승률 — 종목의 **월말 종가 대비 월간 수익률**을 뽑는 순수 모듈.
 *
 * 적재 테이블을 두지 않는다. `stock_prices`가 이미 일봉을 보존하고 있어서, 매번 월말 종가만
 * 추려 계산하면 달이 지날 때마다 열이 저절로 하나 늘어난다("계속 누적"). 룰을 고쳐도 과거로
 * 소급되고, 스냅샷 테이블과 원본이 어긋날 여지가 없다.
 */

/** 이 화면이 다루는 첫 달. 그 직전 달(2025-12) 월말 종가가 첫 수익률의 기준점이 된다. */
export const START_MONTH = '2026-01';

/** `YYYY-MM` → 단조 증가 정수. 연 경계를 건너뛰는 실수를 막는다. */
export function monthIndexOf(ym: string): number {
  const [year, month] = ym.split('-').map(Number);
  return year * 12 + (month - 1);
}

export function monthKeyOf(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** `from`부터 `to`까지의 달을 빠짐없이 나열한다(양끝 포함). */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let i = monthIndexOf(from); i <= monthIndexOf(to); i++) out.push(monthKeyOf(i));
  return out;
}

/** 한 종목·한 달의 마지막 거래일 종가. */
export interface MonthEndClose {
  ticker: string;
  ym: string;
  close: number;
}

/** 종목 → (달 → 수익률). 계산이 성립하지 않는 달은 키가 없다. */
export type ReturnsByTicker = Map<string, Map<string, number>>;

/** 오염 구간 집합의 키 — (종목, 달). */
export function suspectKeyOf(ticker: string, ym: string): string {
  return `${ticker}|${ym}`;
}

/**
 * 월말 종가에서 월간 수익률을 만든다.
 *
 * ⚠️ **직전 달이 정확히 한 칸 전일 때만 계산한다.** 거래정지로 한 달이 통째로 빈 종목을 단순히
 * "이전 행"과 비교하면 두 달치 등락이 한 달 수익률로 표시된다(1월 종가와 3월 종가를 비교해
 * 3월 수익률이라고 부르는 꼴). 그런 달은 값을 만들지 않고 비운다 — 빈 칸이 정직한 표시다.
 *
 * 종가가 0 이하인 달도 건너뛴다(분모가 성립하지 않는다).
 *
 * `suspectKeys`에 든 (종목, 달)은 값을 만들지 않는다 — 액면병합·감자가 소급 반영되지 않아
 * 하루 만에 정확히 ×10이 찍힌 구간이다. 그건 수익률이 아니라 눈금이 바뀐 것이고, 그대로 두면
 * 랭킹 상위가 통째로 가짜가 된다(실제로 2026-07 1·2위가 +900%·+400%였다).
 */
export function buildMonthlyReturns(
  rows: readonly MonthEndClose[],
  suspectKeys: ReadonlySet<string> = new Set(),
): ReturnsByTicker {
  const closesByTicker = new Map<string, Map<number, number>>();
  for (const r of rows) {
    if (!Number.isFinite(r.close)) continue;
    let closes = closesByTicker.get(r.ticker);
    if (!closes) {
      closes = new Map();
      closesByTicker.set(r.ticker, closes);
    }
    closes.set(monthIndexOf(r.ym), r.close);
  }

  const out: ReturnsByTicker = new Map();
  for (const [ticker, closes] of closesByTicker) {
    const returns = new Map<string, number>();
    for (const [index, close] of closes) {
      const prev = closes.get(index - 1);
      if (prev == null || prev <= 0) continue;
      const ym = monthKeyOf(index);
      if (suspectKeys.has(suspectKeyOf(ticker, ym))) continue;
      returns.set(ym, close / prev - 1);
    }
    if (returns.size > 0) out.set(ticker, returns);
  }
  return out;
}

/**
 * 마지막 달이 **진행 중**인가 — 그 달의 마지막 달력일에 아직 닿지 않았는가.
 *
 * 앞으로 며칠이 거래일인지는 알 수 없으므로 달력으로만 판정한다. 조금 보수적이지만
 * "이 달은 아직 안 끝났다"를 놓치는 것보다 낫다.
 */
export function isPartialMonth(ym: string, asOf: string): boolean {
  if (asOf.slice(0, 7) !== ym) return false;
  const [year, month] = ym.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Number(asOf.slice(8, 10)) < lastDay;
}
