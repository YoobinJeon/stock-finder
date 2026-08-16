/**
 * 일봉 시리즈 끝에 "오늘 봉"을 upsert하는 순수함수(불변).
 * getDate로 날짜 필드를 추출해 stock_prices('trade_date')·Candle('date') 어느 shape든 지원.
 */
export function mergeTodayBar<T>(rows: T[], todayRow: T | null, getDate: (r: T) => string): T[] {
  if (!todayRow) return rows;
  if (rows.length === 0) return [todayRow];
  const lastDate = getDate(rows[rows.length - 1]);
  const td = getDate(todayRow);
  if (td > lastDate) return [...rows, todayRow];
  if (td === lastDate) return [...rows.slice(0, -1), todayRow];
  return rows;
}
