/**
 * 'YYYY-MM-DD' 날짜 문자열 전용 UTC 고정 산술 유틸.
 *
 * 배경: `new Date(dateStr)`는 스펙상 UTC로 파싱되지만, 이후 `.getMonth()`/`.setMonth()`/
 * `.getFullYear()` 같은 로컬 타임존 접근자를 섞어 쓰면 서버 TZ가 KST가 아닐 때 날짜가
 * 하루 밀릴 수 있다 (예: UTC 자정을 서구권 TZ에서 읽으면 전날로 보임). 이 파일의 함수는
 * 전 구간 UTC 접근자만 사용해 서버 TZ에 무관하게 동일한 결과를 보장한다.
 */

/** 'YYYY-MM-DD' 문자열을 UTC 자정 Date로 파싱 (로컬 TZ 영향 없음) */
export function parseDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

/** Date를 'YYYY-MM-DD' 문자열로 변환 (UTC 기준) */
export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 'YYYY-MM-DD' 문자열에서 N개월 전(음수면 이후) 날짜를 UTC 고정 산술로 계산.
 * `Date.UTC`의 오버플로 정규화 규칙을 그대로 따른다 (예: 1/31 - 1개월 → 말일 없는 달이면 다음 달로 roll-over).
 */
export function subtractMonthsUTC(dateStr: string, months: number): string {
  const d = parseDateOnly(dateStr);
  const shifted = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate()));
  return formatDateOnly(shifted);
}

/** 'YYYY-MM-DD' 문자열의 UTC 연도 */
export function getUTCYear(dateStr: string): number {
  return parseDateOnly(dateStr).getUTCFullYear();
}

/** 'YYYY-MM-DD' 문자열의 UTC 월 (1~12) */
export function getUTCMonthOneBased(dateStr: string): number {
  return parseDateOnly(dateStr).getUTCMonth() + 1;
}

/** 두 'YYYY-MM-DD' 문자열 사이의 일수 차이 (a - b, UTC 고정) */
export function diffDaysUTC(a: string, b: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return (parseDateOnly(a).getTime() - parseDateOnly(b).getTime()) / MS_PER_DAY;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SUNDAY = 0;
const SATURDAY = 6;

/**
 * 'fromDateStr' 초과 ~ 'toDateStr' 미만(양끝 제외) 구간의 평일(월~금) 수를 센다.
 * 데이터 신선도 배지 — "최신 거래일이 오늘 기준 며칠 지연됐는가"를 판정하는 데 쓴다.
 *
 * 한계(의도된 근사, YAGNI): 주말만 제외하고 KRX 공휴일 캘린더는 반영하지 않는다.
 * 예) 최신 거래일이 연휴 직전 금요일이고 오늘이 연휴 다음 화요일이면, 실제 지연은
 * 없거나 적을 수 있지만 이 함수는 연휴 중 평일(예: 대체공휴일 월요일)을 지연으로
 * 센다. 긴 연휴 동안 신선도 배지가 잠깐 amber로 뜨는 오탐이 발생할 수 있으나,
 * 오탐 비용(며칠 후 자동으로 정상 표시로 복귀)이 낮다고 보고 허용한다.
 *
 * to <= from(범위가 없거나 뒤집힌 경우)이면 0을 반환한다.
 */
export function countWeekdaysBetweenUTC(fromDateStr: string, toDateStr: string): number {
  const from = parseDateOnly(fromDateStr).getTime();
  const to = parseDateOnly(toDateStr).getTime();
  let count = 0;
  for (let t = from + MS_PER_DAY; t < to; t += MS_PER_DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== SUNDAY && dow !== SATURDAY) count += 1;
  }
  return count;
}
