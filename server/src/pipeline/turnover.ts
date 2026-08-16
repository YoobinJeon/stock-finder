/**
 * 거래대금 모니터 — 주간 버킷 순수함수.
 *
 * "주"는 달력 주가 아니라 최근 거래일부터 5거래일씩 묶은 블록이다. 라우트가 거래일 목록을
 * 오래된→최신 순으로 넘기면, 이 모듈이 5일 단위로 잘라 최대 8개 블록(최신 40거래일)만
 * 남기고 최신 블록을 앞에 오도록 정렬한다. 마지막(최신) 블록은 아직 5거래일이 안 쌓였으면
 * "미완성"으로 취급 — 진행 중인 주간을 나타낸다.
 */

/** 5거래일 단위 블록으로 자른 결과 하나. 오래된 날짜가 앞, 최신 날짜가 뒤에 온다. */
export type TradeDateBlock = string[];

/**
 * 거래일 목록(중복 없는 'YYYY-MM-DD' 문자열, 순서 무관)을 5거래일 블록으로 접는다.
 * 오래된 날짜부터 5개씩 묶고, 마지막 조각(가장 최신 날짜들)이 5개 미만이면 그대로 남긴다
 * (=진행 중인 최신 블록). 결과는 최대 8개, **최신 블록이 배열의 0번째**가 되도록 뒤집는다.
 */
export function bucketTradeDates(dates: string[]): TradeDateBlock[] {
  const sorted = [...new Set(dates)].sort();
  const blocks: TradeDateBlock[] = [];
  for (let i = 0; i < sorted.length; i += 5) {
    blocks.push(sorted.slice(i, i + 5));
  }
  return blocks.slice(-8).reverse();
}

/**
 * 블록 하나(오래된→최신 날짜 배열)를 "MM-DD~MM-DD" 라벨로 표시. 단일 날짜면 "MM-DD"만 표시.
 */
export function formatWeekLabel(block: TradeDateBlock): string {
  if (block.length === 0) return '';
  const sorted = [...block].sort();
  const first = sorted[0].slice(5);
  const last = sorted[sorted.length - 1].slice(5);
  return first === last ? first : `${first}~${last}`;
}

/**
 * 주간 시계열(오래된→최신 순, 완성된 블록만)에서 직전 완성 블록 대비 최신 완성 블록의
 * 증감률(%)을 계산한다. 미완성(진행 중) 최신 블록은 호출부에서 미리 잘라내고 넘겨야 한다
 * 이 함수는 항상 배열의 마지막 두 값을 비교한다.
 * 값이 2개 미만이거나 직전 값이 0이면(0으로 나누기 방지) null.
 */
export function weeklyChange(series: number[]): number | null {
  if (series.length < 2) return null;
  const prev = series[series.length - 2];
  const latest = series[series.length - 1];
  if (prev === 0) return null;
  return ((latest - prev) / prev) * 100;
}
