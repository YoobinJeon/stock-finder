/**
 * 월간 상승률 스냅샷 캐시 자리.
 *
 * 캐시 자체는 `api/routes/market/monthly.routes.ts`가 채우지만, **무효화는 파이프라인이 걸어야
 * 한다** — `priceRepair`가 과거 종가를 다시 쓰면 그 위에서 계산한 월간 수익률이 낡는다.
 * 캐시 키가 마지막 거래일이라 **거래일이 그대로면 키도 그대로**여서, 무효화를 걸지 않으면
 * 다음 거래일까지 고쳐지기 전 수치를 계속 내보낸다.
 *
 * 라우트 모듈을 파이프라인에서 import하면 계층이 뒤집히므로(api ← pipeline) 캐시 홀더만
 * 중립 위치인 여기에 둔다. 스냅샷의 실제 모양은 라우트가 알고, 여기는 상자 역할만 한다.
 */

let snapshot: unknown = null;

export function readMonthlySnapshot<T>(): T | null {
  return snapshot as T | null;
}

export function writeMonthlySnapshot<T>(value: T): T {
  snapshot = value;
  return value;
}

/** 종가가 다시 쓰였을 때 호출한다 — 다음 요청이 처음부터 다시 계산한다. */
export function invalidateMonthlySnapshot(): void {
  snapshot = null;
}
