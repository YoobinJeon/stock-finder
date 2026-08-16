/**
 * RS(상대강도) 랭킹 순수 계산 모듈 — DB I/O 없음.
 * stockeasy.intellio.kr 통합 RS 참고: 기간별(1M/3M/6M/12M) RS 백분위 + 최근 가중 통합 RS + 섹터 RS.
 * market/rsRanking.ts 라우트가 stock_prices 피벗 결과를 넘겨 호출한다.
 * (RS 랭킹 — ARCHITECTURE.md 참고)
 */
import { calcRsPercentile, type RsInput } from './trendIndicators';

// 오늘(rn=1) · 1M(21거래일) · 3M(63) · 6M(126) · 12M(251) 근사 오프셋.
// rn = ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY trade_date DESC) — rn=1이 최신 종가.
// RS 랭킹 페이지(market/rsRanking.ts)와 스크리너 저장값 갱신(ingest.ts)이 동일 상수를 공유한다(DRY).
export const RS_OFFSET_TODAY = 1;
export const RS_OFFSET_1M = 22;
export const RS_OFFSET_3M = 64;
export const RS_OFFSET_6M = 127;
export const RS_OFFSET_12M = 252;

export interface PeriodCloses {
  c0: number | null;   // 최신(오늘) 종가
  c1m: number | null;  // 약 21거래일 전 종가
  c3m: number | null;  // 약 63거래일 전
  c6m: number | null;  // 약 126거래일 전
  c12m: number | null; // 약 251거래일 전
}

export interface PeriodReturns {
  r1m: number | null;
  r3m: number | null;
  r6m: number | null;
  r12m: number | null;
}

/** base(과거 종가)가 없거나 0 이하면 해당 기간 수익률은 null — 상장 초기 종목 등 */
function returnPct(current: number | null, base: number | null): number | null {
  if (current == null || base == null || base <= 0) return null;
  return ((current - base) / base) * 100;
}

/**
 * 기간별 수익률(%) 계산. c0(오늘 종가)이 없으면 어떤 기간도 계산 불가하므로 전부 null.
 */
export function calcPeriodReturns(closes: PeriodCloses): PeriodReturns {
  const { c0, c1m, c3m, c6m, c12m } = closes;
  if (c0 == null) {
    return { r1m: null, r3m: null, r6m: null, r12m: null };
  }
  return {
    r1m: returnPct(c0, c1m),
    r3m: returnPct(c0, c3m),
    r6m: returnPct(c0, c6m),
    r12m: returnPct(c0, c12m),
  };
}

/**
 * 데이터 오염 종목 배제 사유.
 * - frozen: 1M 수익률이 정확히 0%이고 3M도 0%거나 없음 → 거래정지 등으로 가격이 동결된 것으로 의심.
 * - series_break: 12M 창 안에 연속 거래일 종가 비율이 [0.6, 1.4] 밖인 날 존재(라우트 SQL이 판정) —
 *   감자·거래정지 후 재개 등 가격 불연속. priceRepair가 못 고친(원천에도 불연속) 종목만 남는다.
 *
 * 2026-07-18: 누적 수익률 +300% 가드(suspect_jump) 폐기 — 브이엠(12M +872%, 일별 브레이크 없는
 * 진짜 연속 상승)을 오탐 제외하던 문제. 누적 수익률은 "왜곡"과 "진짜 대박주"를 구분 못 하고,
 * 일별 불연속 여부가 정확한 판별 기준이다 (KRX 제한폭 ±30% — priceRepair와 동일 근거).
 */
export type RankExclusionReason = 'frozen' | 'series_break' | null;

/**
 * 랭킹 대상 적합성 판정 — 거래정지(가격 동결) 종목을 배제한다.
 * 가격 불연속(series_break)은 일별 시계열이 필요해 라우트 SQL에서 판정한다.
 * 모든 기간이 null인 종목은 애초에 어떤 백분위에도 잡히지 않으므로 여기서는 ok:true로 두고
 * (배제 사유가 없음) 각 기간·통합 계산의 null 처리에 맡긴다.
 */
export function isRankable(returns: PeriodReturns): { ok: boolean; reason: RankExclusionReason } {
  const { r1m, r3m } = returns;

  if (r1m != null && r1m === 0 && (r3m == null || r3m === 0)) {
    return { ok: false, reason: 'frozen' };
  }

  return { ok: true, reason: null };
}

// 최근 가중 산식 — 사용자 선호(2026-07-17)에 따라 최근 1개월에 가장 큰 비중을 둔다.
// 가중치는 **백분위(순위) 공간**에 적용한다 (2026-07-18 전환): 수익률 공간에서 가중하면
// 기간별 수익률 분산 차이(3M ±200% vs 1M ±40%) 때문에 절대값이 큰 장기 구간이 명목 가중치를
// 무력화한다 — 예: 1M -39%(RS 4.7)인데 3M +177%가 압도해 통합 99.8로 뜨던 문제.
const INTEGRATED_WEIGHTS: ReadonlyArray<{ key: keyof PeriodRsPercentiles; weight: number }> = [
  { key: 'm1', weight: 0.4 },
  { key: 'm3', weight: 0.3 },
  { key: 'm6', weight: 0.2 },
  { key: 'm12', weight: 0.1 },
];

export interface PeriodRsPercentiles {
  m1: number | null;
  m3: number | null;
  m6: number | null;
  m12: number | null;
}

/**
 * 최근 가중 통합 RS 점수 — 기간별 RS 백분위의 가중평균 (0.4×1M + 0.3×3M + 0.2×6M + 0.1×12M).
 * 백분위끼리는 스케일이 동일(0~100)하므로 가중치가 명목대로 작동한다.
 * 일부 장기 구간이 null이면 존재하는 구간끼리 가중치를 재정규화한다.
 * 최소 요건: m1과 m3이 모두 있어야 함(둘 중 하나라도 없으면 통합 랭킹에서 제외) — null 반환.
 */
export function calcIntegratedRsScore(rs: PeriodRsPercentiles): number | null {
  if (rs.m1 == null || rs.m3 == null) return null;

  const available = INTEGRATED_WEIGHTS.filter((w) => rs[w.key] != null);
  const totalWeight = available.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight === 0) return null;

  const weightedSum = available.reduce((sum, w) => sum + (rs[w.key] as number) * w.weight, 0);
  return weightedSum / totalWeight;
}

export interface StockRsRow {
  ticker: string;
  name: string;
  sector: string | null;
  marketCap: number | null;
  market: string;
  ret: PeriodReturns;
}

export interface StockRsOut {
  ticker: string;
  name: string;
  sector: string | null;
  marketCap: number | null;
  market: string;
  rs: { m1: number | null; m3: number | null; m6: number | null; m12: number | null; integrated: number | null };
  ret: { m1: number | null; m3: number | null; m6: number | null; m12: number | null };
}

/**
 * 기간별(1M/3M/6M/12M) RS 백분위를 각각 계산한 뒤, 그 백분위들의 가중평균
 * (calcIntegratedRsScore)을 다시 백분위로 환산해 통합 RS를 만든다.
 * 값이 null인 종목은 해당 기간 백분위 계산에서 제외되고 결과에서도 null 유지.
 * 거래정지·가격 왜곡 종목 배제는 이 함수 호출 전 라우트에서 isRankable로 걸러낸다.
 */
export function rankStocks(rows: readonly StockRsRow[]): StockRsOut[] {
  const percentileFor = (getRet: (r: StockRsRow) => number | null): Map<string, number> => {
    const inputs: RsInput[] = rows
      .filter((r) => getRet(r) != null)
      .map((r) => ({ ticker: r.ticker, ret: getRet(r) as number }));
    const results = calcRsPercentile(inputs);
    return new Map(results.map((res) => [res.ticker, res.rsPercentile]));
  };

  const m1Map = percentileFor((r) => r.ret.r1m);
  const m3Map = percentileFor((r) => r.ret.r3m);
  const m6Map = percentileFor((r) => r.ret.r6m);
  const m12Map = percentileFor((r) => r.ret.r12m);

  // 통합 = 기간별 백분위의 가중평균 그대로 표시 (재백분위 없음, 2026-07-18) —
  // 재백분위는 상위권을 한 번 더 밀어올려(브이엠 가중평균 99.0 → 표시 99.9) 기간 컬럼과의
  // 암산 검증을 불가능하게 만들었다. 가중평균 그대로면 통합 = 눈에 보이는 기간 RS들의 가중평균.
  const integratedMap = new Map<string, number>();
  for (const r of rows) {
    const score = calcIntegratedRsScore({
      m1: m1Map.get(r.ticker) ?? null,
      m3: m3Map.get(r.ticker) ?? null,
      m6: m6Map.get(r.ticker) ?? null,
      m12: m12Map.get(r.ticker) ?? null,
    });
    if (score != null) integratedMap.set(r.ticker, Math.round(score * 100) / 100);
  }

  return rows.map((r) => ({
    ticker: r.ticker,
    name: r.name,
    sector: r.sector,
    marketCap: r.marketCap,
    market: r.market,
    rs: {
      m1: m1Map.get(r.ticker) ?? null,
      m3: m3Map.get(r.ticker) ?? null,
      m6: m6Map.get(r.ticker) ?? null,
      m12: m12Map.get(r.ticker) ?? null,
      integrated: integratedMap.get(r.ticker) ?? null,
    },
    ret: {
      m1: r.ret.r1m,
      m3: r.ret.r3m,
      m6: r.ret.r6m,
      m12: r.ret.r12m,
    },
  }));
}

export interface SectorRsOut {
  sector: string;
  medianRs: number;
  count: number;
  top: Array<{ ticker: string; name: string; rs: number }>;
}

const MIN_SECTOR_MEMBERS = 3;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 섹터별 통합 RS 집계 — 중앙값·구성원 수·통합 RS 상위 3종목.
 * 구성원 3개 미만인 섹터는 표본이 너무 작아 랭킹 신뢰도가 낮으므로 결과에서 제외한다
 * (숨기는 대신 드롭 — 응답 스키마가 sectors 배열 하나이므로 별도 "제외 목록"은 두지 않음. 필요해지면 추가).
 */
export function aggregateSectorRs(
  stocks: ReadonlyArray<{ ticker: string; name: string; sector: string | null; integratedRs: number | null }>,
): SectorRsOut[] {
  const bySector = new Map<string, Array<{ ticker: string; name: string; integratedRs: number }>>();

  for (const s of stocks) {
    if (s.sector == null || s.integratedRs == null) continue;
    const list = bySector.get(s.sector) ?? [];
    bySector.set(s.sector, [...list, { ticker: s.ticker, name: s.name, integratedRs: s.integratedRs }]);
  }

  const sectors: SectorRsOut[] = [];
  for (const [sector, members] of bySector) {
    if (members.length < MIN_SECTOR_MEMBERS) continue;
    const top = [...members]
      .sort((a, b) => b.integratedRs - a.integratedRs)
      .slice(0, 3)
      .map((m) => ({ ticker: m.ticker, name: m.name, rs: m.integratedRs }));
    sectors.push({
      sector,
      medianRs: median(members.map((m) => m.integratedRs)),
      count: members.length,
      top,
    });
  }

  return sectors.sort((a, b) => b.medianRs - a.medianRs);
}
