const TICKER_RE = /^[0-9A-Z]{6}$/;
const MIN_TICKERS = 2;
const MAX_TICKERS = 4;

/**
 * 콤마 구분 tickers 쿼리 파라미터를 검증.
 * 각 항목은 trim → 대문자화 → 빈 항목/중복 제거 후 6자리 영문숫자 코드(신형 영문혼합 포함)인지 검사.
 * 최종 개수가 2~4개가 아니거나 하나라도 형식이 맞지 않으면 null.
 */
export function parseTickersParam(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null;

  const tickers = [...new Set(
    raw.split(',')
      .map((t) => t.trim().toUpperCase())
      .filter((t) => t.length > 0),
  )];

  if (tickers.some((t) => !TICKER_RE.test(t))) return null;
  if (tickers.length < MIN_TICKERS || tickers.length > MAX_TICKERS) return null;

  return tickers;
}
