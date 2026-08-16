import { getJson } from '../http';

export interface DailyPrice {
  trade_date: string; // YYYY-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

/** Yahoo Finance 차트 API에서 국내 종목(.KS/.KQ) 일봉 조회 */
export async function fetchYahooChart(
  ticker: string,
  market: string,
  range = '1y',
  interval = '1d',
): Promise<DailyPrice[]> {
  const suffix = market === 'KOSDAQ' ? '.KQ' : '.KS';
  const symbol = encodeURIComponent(ticker + suffix);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;

  const data = await getJson(url);
  const result = data?.chart?.result?.[0];
  if (!result) return [];

  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const opens: number[] = quote.open ?? [];
  const highs: number[] = quote.high ?? [];
  const lows: number[] = quote.low ?? [];
  const closes: number[] = quote.close ?? [];
  const volumes: number[] = quote.volume ?? [];

  return timestamps
    .map((ts, i) => ({
      trade_date: new Date(ts * 1000).toISOString().split('T')[0],
      open: opens[i] != null ? Number(opens[i].toFixed(0)) : null,
      high: highs[i] != null ? Number(highs[i].toFixed(0)) : null,
      low: lows[i] != null ? Number(lows[i].toFixed(0)) : null,
      close: closes[i] != null ? Number(closes[i].toFixed(0)) : null,
      volume: volumes[i] ?? null,
    }))
    .filter((r) => r.close != null);
}
