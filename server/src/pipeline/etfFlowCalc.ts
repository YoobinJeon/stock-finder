/**
 * ETF 일별 스냅샷(etf_daily_snapshots) → 자금유입 추정·기간수익률·RS 백분위 계산 (순수 함수).
 * DB I/O 없음 — 라우트가 스냅샷 행을 조회해 이 함수에 넘긴다.
 */

export interface EtfSnapRow {
  ticker: string;
  name: string;
  tab: number;
  snap_date: string;
  close: number | null;
  change_pct: number | null;
  market_cap: number | null;
}

export interface EtfFlowResult {
  ticker: string;
  name: string;
  tab: number;
  marketCap: number | null;
  flowEst: number;          // 기간 자금유입 추정 합 (억원)
  periodReturnPct: number;  // 기간 수익률 (%)
  rsPercentile: number;     // RS 백분위 0~100
}

/**
 * null/undefined는 null로, DECIMAL 문자열은 숫자로 변환. Number(null)=0 함정을 피하기 위해
 * null 여부를 먼저 판별한다.
 */
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

/** 티커별 스냅샷 배열(날짜 오름차순 정렬됨)에서 기간 자금유입 추정 합을 계산 */
function calcFlowEst(sorted: EtfSnapRow[]): number {
  let flowEst = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prevCap = toNum(sorted[i - 1].market_cap);
    const currCap = toNum(sorted[i].market_cap);
    const currChg = toNum(sorted[i].change_pct);
    if (prevCap == null || currCap == null || currChg == null) continue; // 그 날 기여 0
    flowEst += currCap - prevCap * (1 + currChg / 100);
  }
  return flowEst;
}

/** 티커별 스냅샷 배열에서 기간 누적수익률(%)을 계산 — change_pct null인 날은 제외 */
function calcPeriodReturnPct(sorted: EtfSnapRow[]): number {
  let cumFactor = 1;
  for (const row of sorted) {
    const chg = toNum(row.change_pct);
    if (chg == null) continue;
    cumFactor *= 1 + chg / 100;
  }
  return (cumFactor - 1) * 100;
}

export function calcEtfFlows(rows: EtfSnapRow[]): EtfFlowResult[] {
  const byTicker = new Map<string, EtfSnapRow[]>();
  for (const row of rows) {
    const group = byTicker.get(row.ticker) ?? [];
    group.push(row);
    byTicker.set(row.ticker, group);
  }

  const partials: Array<Omit<EtfFlowResult, 'rsPercentile'>> = [];
  for (const group of byTicker.values()) {
    const sorted = [...group].sort((a, b) => a.snap_date.localeCompare(b.snap_date));
    const latest = sorted[sorted.length - 1];

    partials.push({
      ticker: latest.ticker,
      name: latest.name,
      tab: latest.tab,
      marketCap: toNum(latest.market_cap),
      flowEst: calcFlowEst(sorted),
      periodReturnPct: calcPeriodReturnPct(sorted),
    });
  }

  // RS 백분위: periodReturnPct 오름차순 순위 / 전체 개수 * 100 (반올림)
  const n = partials.length;
  const rankByTicker = new Map<string, number>();
  [...partials]
    .sort((a, b) => a.periodReturnPct - b.periodReturnPct)
    .forEach((p, i) => rankByTicker.set(p.ticker, Math.round(((i + 1) / n) * 100)));

  return partials.map((p) => ({ ...p, rsPercentile: n > 0 ? rankByTicker.get(p.ticker)! : 0 }));
}
