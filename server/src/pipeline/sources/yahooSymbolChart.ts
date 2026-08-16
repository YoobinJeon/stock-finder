import { getJson } from '../http';

/**
 * 해외 기업·지수 심볼 차트 — 야후 v8 chart API를 심볼 그대로 조회.
 * yahooPrices.fetchYahooChart는 국내 티커(.KS/.KQ 접미사 자동부여) 전용이라 재사용 불가 —
 * 이 모듈은 완성된 심볼(예: '6981.T', '%5EIXIC')을 그대로 받는다.
 * 호출부(market.routes.ts)에서 화이트리스트 검증을 마친 심볼만 넘겨야 한다 —
 * 여기서는 URL에 그대로 꽂아 쓰므로 임의 입력을 받으면 안 됨.
 */

export interface SymbolCandle {
  trade_date: string; // YYYY-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

export interface SymbolChartMeta {
  price: number | null;
  changePct: number | null;
  currency: string | null;
  exchange: string | null;
  longName: string | null;
  high52w: number | null;
  low52w: number | null;
}

export interface SymbolChartResult {
  meta: SymbolChartMeta;
  candles: SymbolCandle[];
}

/** 야후 v8 chart 원응답 → 캔들 + 메타 (순수 함수) */
export function parseYahooSymbolChart(data: unknown): SymbolChartResult | null {
  const result = (data as { chart?: { result?: unknown[] } } | null)?.chart?.result?.[0] as
    | Record<string, any>
    | undefined;
  if (!result) return null;

  const meta = result.meta ?? {};
  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const opens: Array<number | null> = quote.open ?? [];
  const highs: Array<number | null> = quote.high ?? [];
  const lows: Array<number | null> = quote.low ?? [];
  const closes: Array<number | null> = quote.close ?? [];

  const candles: SymbolCandle[] = timestamps
    .map((ts, i) => ({
      trade_date: new Date(ts * 1000).toISOString().split('T')[0],
      open: opens[i] ?? null,
      high: highs[i] ?? null,
      low: lows[i] ?? null,
      close: closes[i] ?? null,
    }))
    .filter((c) => c.close != null);

  if (candles.length === 0) return null;

  const validCloses = candles.map((c) => c.close).filter((c): c is number => c != null);
  const validHighs = candles.map((c) => c.high ?? c.close).filter((c): c is number => c != null);
  const validLows = candles.map((c) => c.low ?? c.close).filter((c): c is number => c != null);

  // 현재가: 실시간 체결가 우선, 없으면 최신 일봉 종가로 폴백
  const current: number | null = meta.regularMarketPrice ?? validCloses[validCloses.length - 1] ?? null;
  // 등락률: 오늘 진행 중인 봉을 제외한 직전 거래일 종가 기준 (meta.chartPreviousClose는 분할 등으로 신뢰 불가한 경우가 있어 미사용)
  const prev = validCloses.length >= 2 ? validCloses[validCloses.length - 2] : current;
  const changePct = current != null && prev != null && prev !== 0 ? ((current - prev) / prev) * 100 : null;

  return {
    meta: {
      price: current,
      changePct,
      currency: typeof meta.currency === 'string' ? meta.currency : null,
      exchange: typeof meta.exchangeName === 'string' ? meta.exchangeName : null,
      longName: typeof meta.longName === 'string' ? meta.longName : null,
      high52w: typeof meta.fiftyTwoWeekHigh === 'number'
        ? meta.fiftyTwoWeekHigh
        : (validHighs.length > 0 ? Math.max(...validHighs) : null),
      low52w: typeof meta.fiftyTwoWeekLow === 'number'
        ? meta.fiftyTwoWeekLow
        : (validLows.length > 0 ? Math.min(...validLows) : null),
    },
    candles,
  };
}

/** 화이트리스트 검증을 마친 심볼의 1년 일봉 + 메타 조회 */
export async function fetchYahooSymbolChart(symbol: string): Promise<SymbolChartResult | null> {
  const data = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`,
  );
  return parseYahooSymbolChart(data);
}
