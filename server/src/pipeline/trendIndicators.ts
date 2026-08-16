/**
 * 추세 지표 순수 계산 함수 — MA50/150/200(+MA200 우상향)·52주 저점 대비·RS 백분위.
 * DB I/O 없음. ingest.ts의 computeIndicators()가 종목별로 호출해 stock_indicators에 반영한다.
 * (거장 전략 3종 근사 정밀화 — ARCHITECTURE.md 참고)
 */

export interface TrendMaResult {
  ma50: number | null;
  ma150: number | null;
  ma200: number | null;
  ma200Up: boolean | null;     // 현재 MA200이 약 21거래일 전 MA200보다 위인지
  low52w: number | null;
  pctFrom52wLow: number | null; // 52주 저점 대비 상승률(%)
}

/**
 * closes/lows는 최신순(내림차순, [0]=최신)으로 같은 길이·같은 거래일 순서를 가정한다.
 * 봉 수가 부족한 이평(MA150/200 등)은 null — 상장 초기 종목 등.
 */
export function calcTrendMa(closes: number[], lows: number[]): TrendMaResult {
  const avg = (arr: number[]): number => arr.reduce((s, v) => s + v, 0) / arr.length;
  const maAt = (n: number, offset: number): number | null =>
    closes.length >= n + offset ? avg(closes.slice(offset, offset + n)) : null;

  const ma50 = maAt(50, 0);
  const ma150 = maAt(150, 0);
  const ma200 = maAt(200, 0);
  const ma200Prev = maAt(200, 21);
  const ma200Up = ma200 != null && ma200Prev != null ? ma200 > ma200Prev : null;

  const low52w = lows.length > 0 ? Math.min(...lows) : null;
  const lastClose = closes.length > 0 ? closes[0] : null;
  const pctFrom52wLow =
    low52w != null && low52w > 0 && lastClose != null
      ? ((lastClose - low52w) / low52w) * 100
      : null;

  return { ma50, ma150, ma200, ma200Up, low52w, pctFrom52wLow };
}

export interface MomentumReturn {
  retPct: number;
  months: 12 | 6;
}

/**
 * RS 백분위 산출용 모멘텀 수익률 — 12개월(약 252거래일) 수익률 우선, 봉 부족 시 6개월(약 126거래일)로 대체.
 * 둘 다 부족하면 null(해당 종목은 RS 순위에서 제외).
 */
export function calcMomentumReturn(closes: number[]): MomentumReturn | null {
  const retOver = (days: number): number | null => {
    if (closes.length <= days) return null;
    const base = closes[days];
    return base > 0 ? ((closes[0] - base) / base) * 100 : null;
  };

  const r12 = retOver(251);
  if (r12 != null) return { retPct: r12, months: 12 };
  const r6 = retOver(125);
  if (r6 != null) return { retPct: r6, months: 6 };
  return null;
}

export interface RsInput {
  ticker: string;
  ret: number; // 모멘텀 수익률(%) — calcMomentumReturn 결과
}

export interface RsResult {
  ticker: string;
  rsPercentile: number; // 0~100 (동률은 평균 순위 부여)
}

/**
 * 상대강도(RS) 백분위 — IBD RS 근사: 실제 IBD RS는 최근 분기에 가중치를 더 주는 시계열
 * 가중 산식이지만, 여기서는 단순 수익률(12개월/6개월) 오름차순 순위를 0~100으로 정규화한다.
 * 동률 구간은 평균 순위를 공유(동점 종목이 같은 백분위를 받도록).
 */
export function calcRsPercentile(inputs: RsInput[]): RsResult[] {
  const n = inputs.length;
  if (n === 0) return [];

  const sorted = [...inputs].sort((a, b) => a.ret - b.ret);
  const result: RsResult[] = new Array(n);

  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1].ret === sorted[i].ret) j++;
    // i..j 동률 구간 — 1-based 평균 순위의 백분위
    const avgRank = (i + j) / 2 + 1;
    const pct = Math.round((avgRank / n) * 10000) / 100;
    for (let k = i; k <= j; k++) {
      result[k] = { ticker: sorted[k].ticker, rsPercentile: pct };
    }
    i = j + 1;
  }

  return result;
}
