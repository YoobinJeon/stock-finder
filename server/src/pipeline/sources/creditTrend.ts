/**
 * 신용잔고 추이의 소스 중립 타입과 데이터 품질 가드.
 *
 * 원천이 키움(ka10013)에서 KIS([국내주식-110])로 전환되면서, 두 소스가 공유하는 표현과
 * 방어 로직을 여기로 분리했다. 가드는 원천이 무엇이든 유지한다 — KIS가 이번 검증에서
 * 정상이었다는 것이 "결함이 없다"는 보장은 아니기 때문
 * (docs/superpowers/specs/2026-07-26-kis-source-migration-assessment.md).
 */

export interface CreditTrendPoint {
  /**
   * **거래일**(YYYY-MM-DD). KIS `deal_date` 기준.
   * 키움 `ka10013`의 `dt`는 결제일(T+2)이라 같은 잔고가 2영업일 뒤 날짜로 붙는다 —
   * 주가와 대조할 때 어긋나므로 거래일을 표준으로 삼는다.
   */
  date: string;
  /** 결제일(YYYY-MM-DD). 제공하지 않는 소스에서는 null */
  settlementDate: string | null;
  currentPrice: number | null;  // 당일 종가(원, 항상 양수)
  priceChange: number | null;   // 전일대비 주가 변동(원)
  volume: number | null;        // 거래량(주)
  newQty: number | null;        // 신규 융자(주)
  repaidQty: number | null;     // 상환(주)
  remainQty: number | null;     // 신용융자 잔고수량(주)
  remainAmt: number | null;     // 신용융자 잔고금액(원)
  changeQty: number | null;     // 잔고수량 전일대비(주)
  shareRatio: number | null;    // 공여율(%) — 원본 % 값 그대로
  remainRatio: number | null;   // 신용잔고율(%) — 원본 % 값 그대로
  /** 대주(공매도) 잔고수량(주) — KIS만 제공, 키움은 별도 호출이라 null */
  shortRemainQty: number | null;
  /** 대주 잔고율(%) — KIS만 제공 */
  shortRemainRatio: number | null;
}

/** 신용 필드가 모두 비어 있는 행(잔고수량·잔고금액 동시 0) — 결함 응답과 실제 무잔고가 공유하는 형태 */
function isCreditZeroRow(p: CreditTrendPoint): boolean {
  return p.remainQty === 0 && p.remainAmt === 0;
}

function hasCreditBalance(p: CreditTrendPoint): boolean {
  return p.remainQty != null && p.remainQty > 0;
}

/**
 * 원천이 간헐적으로 내려주는 "구간 통째로 0" 결함을 결측(null)으로 되돌리는 순수 함수.
 *
 * 2026-07-26 실측(키움 ka10013, 010120): 동일 요청을 수 분 간격으로 반복했을 때
 * 2026-06-09~06-26(14영업일)의 잔고 필드가 회차에 따라 정상값(1,308,514주)과 "0"을 오갔다.
 * `return_code=0`·HTTP 200이라 실패로 감지되지 않고, `num("0")`은 유효한 0이라 파싱에서도
 * 걸러지지 않는다. 잔고가 136만주 → 정확히 0으로 14영업일 → 166만주로 복귀하는 것은
 * 경제적으로 불가능하므로(전량 상환 후 동일 규모 재개는 일어나지 않는다) 차트에 0을 그리는
 * 대신 빈 구간으로 남긴다.
 *
 * **앞뒤 양쪽에 잔고가 있는 "내부" 0 구간만** 결함으로 판정한다 — 신용거래 불가 종목의 전 구간 0,
 * 신용 개시 이전의 선행 0, 잔고 소멸 이후의 후행 0은 실제 값이므로 건드리지 않는다.
 * 입력을 변형하지 않고 새 배열을 반환하며, 정렬 방향(최신순/과거순)에 의존하지 않는다.
 */
export function nullifyInteriorZeroRuns(points: readonly CreditTrendPoint[]): CreditTrendPoint[] {
  const firstReal = points.findIndex(hasCreditBalance);
  if (firstReal === -1) return [...points]; // 잔고가 한 번도 없는 종목 — 전부 실제 0
  let lastReal = points.length - 1;
  while (lastReal > firstReal && !hasCreditBalance(points[lastReal])) lastReal -= 1;

  const suspect = new Set<number>();
  for (let i = firstReal + 1; i < lastReal; i += 1) {
    if (isCreditZeroRow(points[i])) suspect.add(i);
  }
  if (suspect.size === 0) return [...points];

  return points.map((p, i) =>
    suspect.has(i)
      ? {
          ...p,
          newQty: null,
          repaidQty: null,
          remainQty: null,
          remainAmt: null,
          changeQty: null,
          shareRatio: null,
          remainRatio: null,
        }
      : p,
  );
}
