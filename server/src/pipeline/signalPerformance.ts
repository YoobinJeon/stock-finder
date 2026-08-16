/**
 * 시그널 적중률 집계 — 순수 함수 (DB I/O 없음). 고정 보유기간(5거래일·20거래일) 기준으로
 * 시그널일 종가 대비 수익률을 계산한다. 라우트(signals.routes.ts)가 LATERAL 조인으로
 * 거래일 오프셋 종가를 가져와 이 함수에 넘긴다.
 *
 * 마크투마켓 스냅샷(시그널일 → 현재 최신봉) 방식은 보유기간이 시그널마다 제각각이라
 * 하락장에서 왜곡된 수치가 나올 수 있어 폐기 — 레드팀 점검(2026-07-18)..
 */

/** 단기 보유기간 — 5거래일 종가 기준 */
export const RET_5D_TRADING_DAYS = 5;
/** 중기 보유기간 — 20거래일 종가 기준 */
export const RET_20D_TRADING_DAYS = 20;

export interface SignalReturnRow {
  type: string;
  /** 시그널 발생일 종가 */
  baseClose: number;
  /** 발생일 이후 5번째 거래일 종가 — 아직 도래 전이면 null */
  close5d: number | null;
  /** 발생일 이후 20번째 거래일 종가 — 아직 도래 전이면 null */
  close20d: number | null;
}

export interface ReturnStats {
  /** 표본 수 (해당 기간이 도래한 시그널만) */
  n: number;
  avgRet: number;
  winRate: number;
}

export interface SignalTypePerformance {
  type: string;
  /** 해당 타입의 전체 시그널 표본 수 (기간 도래 여부 무관) */
  count: number;
  ret5d: ReturnStats;
  ret20d: ReturnStats;
  /** 5거래일이 아직 도래하지 않아 ret5d 집계에서 제외된 표본 수 */
  pending5d: number;
  /** 20거래일이 아직 도래하지 않아 ret20d 집계에서 제외된 표본 수 */
  pending20d: number;
}

/** 시그널일 종가 대비 목표일 종가 수익률(%) */
export function computeReturnPct(baseClose: number, targetClose: number): number {
  return ((targetClose - baseClose) / baseClose) * 100;
}

const EMPTY_STATS: ReturnStats = { n: 0, avgRet: 0, winRate: 0 };

/** 수익률 배열 → {표본수, 평균수익률, 승률}. 빈 배열이면 0으로 채운 통계 반환(표본 없음과 구분은 n=0으로). */
export function summarizeReturns(rets: readonly number[]): ReturnStats {
  if (rets.length === 0) return EMPTY_STATS;
  const avg = rets.reduce((sum, v) => sum + v, 0) / rets.length;
  const wins = rets.filter((v) => v > 0).length;
  return {
    n: rets.length,
    avgRet: Math.round(avg * 100) / 100,
    winRate: Math.round((wins / rets.length) * 1000) / 10,
  };
}

interface TypeBucket {
  rets5d: readonly number[];
  rets20d: readonly number[];
  pending5d: number;
  pending20d: number;
  count: number;
}

const EMPTY_BUCKET: TypeBucket = { rets5d: [], rets20d: [], pending5d: 0, pending20d: 0, count: 0 };

/**
 * 타입별 시그널 적중률 집계. avgRet 내림차순 정렬(기존 스냅샷 방식과 동일한 정렬 기준 —
 * 5일 성과가 좋은 타입을 먼저 보여준다).
 */
export function aggregateSignalPerformance(rows: readonly SignalReturnRow[]): SignalTypePerformance[] {
  const byType = new Map<string, TypeBucket>();
  for (const r of rows) {
    const prev = byType.get(r.type) ?? EMPTY_BUCKET;
    byType.set(r.type, {
      rets5d: r.close5d != null ? [...prev.rets5d, computeReturnPct(r.baseClose, r.close5d)] : prev.rets5d,
      rets20d: r.close20d != null ? [...prev.rets20d, computeReturnPct(r.baseClose, r.close20d)] : prev.rets20d,
      pending5d: prev.pending5d + (r.close5d == null ? 1 : 0),
      pending20d: prev.pending20d + (r.close20d == null ? 1 : 0),
      count: prev.count + 1,
    });
  }

  return [...byType.entries()]
    .map(([type, b]) => ({
      type,
      count: b.count,
      ret5d: summarizeReturns(b.rets5d),
      ret20d: summarizeReturns(b.rets20d),
      pending5d: b.pending5d,
      pending20d: b.pending20d,
    }))
    .sort((a, b) => b.ret5d.avgRet - a.ret5d.avgRet);
}
