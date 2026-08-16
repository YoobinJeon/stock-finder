/** 실적 캘린더 월간 그리드 계산 — 순수 함수 (날짜 로직은 브라우저 로컬 타임존 기준). */

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export interface MonthDayCell {
  /** 'YYYY-MM-DD' — 여백 칸이면 빈 문자열 */
  date: string;
  day: number | null;
  inMonth: boolean;
}

function splitMonth(month: string): { year: number; monthIndex: number } {
  const [yearStr, monthStr] = month.split('-');
  return { year: Number(yearStr), monthIndex: Number(monthStr) - 1 };
}

/** 'YYYY-MM'에 delta(월 단위, 음수 가능)를 더한 새 월 문자열을 반환한다. */
export function shiftMonth(month: string, delta: number): string {
  const { year, monthIndex } = splitMonth(month);
  const d = new Date(year, monthIndex + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 오늘이 속한 월('YYYY-MM') — URL 파라미터 기본값. */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** 오늘 날짜('YYYY-MM-DD'). */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** 월간 캘린더 그리드(7열)를 만든다 — 전월/익월 여백 칸 포함, 7의 배수 길이. */
export function buildMonthGrid(month: string): MonthDayCell[] {
  const { year, monthIndex } = splitMonth(month);
  const monthStr = String(monthIndex + 1).padStart(2, '0');
  const startWeekday = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  const leadingBlanks: MonthDayCell[] = Array.from({ length: startWeekday }, () => ({
    date: '', day: null, inMonth: false,
  }));
  const monthDays: MonthDayCell[] = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    return { date: `${year}-${monthStr}-${String(day).padStart(2, '0')}`, day, inMonth: true };
  });
  const cells = [...leadingBlanks, ...monthDays];
  const trailingCount = (7 - (cells.length % 7)) % 7;
  const trailingBlanks: MonthDayCell[] = Array.from({ length: trailingCount }, () => ({
    date: '', day: null, inMonth: false,
  }));

  return [...cells, ...trailingBlanks];
}
