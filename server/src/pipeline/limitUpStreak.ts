/**
 * stock_prices(EOD) 최근 N영업일 → 상한가(전일比 +29.5% 이상) 연속일수 계산 (순수 함수).
 * DB I/O 없음 — 라우트가 최근 거래일 행을 조회해 이 함수에 넘긴다.
 */

export interface PriceRow {
  trade_date: string;
  close: number | string | null;
  prev_close: number | string | null;
}

export interface LimitUpStreak {
  streak: number;
  lastChangePct: number | null;
  lastClose: number | null;
}

// 상한가 제도는 +30%지만 호가단위 반올림 오차를 흡수하기 위해 29.5%를 하한선으로 잡는다.
const LIMIT_UP_THRESHOLD = 0.295;
// 부동소수점 나눗셈 오차(예: 12950/10000-1 === 0.29499999999999993)로 경계값이
// 누락되지 않도록 비교 시 미세 여유를 둔다.
const EPS = 1e-9;

/**
 * null/undefined는 null로, DECIMAL 문자열은 숫자로 변환. Number(null)=0 함정을 피하기 위해
 * null 여부를 먼저 판별한다.
 */
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

/** 최신 거래일부터 연속 상한가 일수. 데이터는 정렬 무관 입력 허용(내부에서 내림차순 정렬). */
export function calcLimitUpStreak(rows: PriceRow[]): LimitUpStreak {
  if (rows.length === 0) {
    return { streak: 0, lastChangePct: null, lastClose: null };
  }

  const sorted = [...rows].sort((a, b) => b.trade_date.localeCompare(a.trade_date));
  const latest = sorted[0];
  const lastClose = toNum(latest.close);
  const latestPrevClose = toNum(latest.prev_close);
  const lastChangePct =
    lastClose != null && latestPrevClose != null && latestPrevClose !== 0
      ? (lastClose / latestPrevClose - 1) * 100
      : null;

  let streak = 0;
  for (const row of sorted) {
    const close = toNum(row.close);
    const prevClose = toNum(row.prev_close);
    if (close == null || prevClose == null || prevClose === 0) break; // 판정 불가 → 중단
    const changeRatio = close / prevClose - 1;
    if (changeRatio < LIMIT_UP_THRESHOLD - EPS) break; // 연속 끊김
    streak++;
  }

  return { streak, lastChangePct, lastClose };
}
