import axios from 'axios';
import { num } from '../http';

/**
 * 트레이딩뷰 스캐너 API로 조회하는 지수선물 시세 (매크로 티커의 코스닥150 선물).
 * 네이버 실시간 폴링 API(naverFutures.ts)에는 코스피200 선물(FUT)만 있고 코스닥150 선물 상품이 없어
 * 별도 소스로 트레이딩뷰 scanner API(KRX:KQI1! 등)를 사용한다.
 * (요청/응답 스펙은 실측으로 확인했다 — 아래 파서 주석 참고)
 */

export interface TvFuturesQuote {
  ticker: string;
  name: string;
  price: number;
  changePct: number;
  description: string;
}

/** 트레이딩뷰 scanner API 응답(data 배열, d=[name, close, change, description]) → 티커별 시세 맵 (순수 함수) */
export function parseTvFuturesScan(data: unknown): Map<string, TvFuturesQuote> {
  const out = new Map<string, TvFuturesQuote>();
  const rows = (data as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(rows)) return out;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const ticker = String(r?.s ?? '');
    const d = r?.d;
    if (!ticker || !Array.isArray(d)) continue;

    const price = num(d[1] as number | string | undefined);
    if (price == null) continue;

    out.set(ticker, {
      ticker,
      name: String(d[0] ?? ticker),
      price,
      changePct: num(d[2] as number | string | undefined) ?? 0,
      description: String(d[3] ?? ''),
    });
  }

  return out;
}

/** 트레이딩뷰 scanner API로 선물 시세 일괄 조회 (실패 시 빈 맵 — fail-soft) */
export async function fetchTvFutures(tickers: string[]): Promise<Map<string, TvFuturesQuote>> {
  if (tickers.length === 0) return new Map();
  try {
    const { data } = await axios.post(
      'https://scanner.tradingview.com/global/scan',
      {
        symbols: { tickers },
        columns: ['name', 'close', 'change', 'description'],
      },
      {
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      },
    );
    return parseTvFuturesScan(data);
  } catch (err) {
    console.warn('[tradingviewFutures] 선물 시세 조회 실패 — 빈 맵 반환', err);
    return new Map();
  }
}
