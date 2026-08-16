import axios from 'axios';
import { num } from '../http';

/**
 * 국내 지수선물 실시간 시세 (매크로 티커의 선물 항목).
 * 야후는 KRX 지수선물을 제공하지 않아 네이버 실시간 폴링 API(모바일 앱과 동일 백엔드)를 사용.
 * (2026-07-12 실측: 코스피200 선물(itemCode=FUT)만 확인됨. 코스닥150 선물·코스피200 야간선물(EUREX)은
 *  네이버 소비자 API(ac.stock.naver.com 검색·index/majors)에 상품 자체가 없어 확보 실패 —
 *  소스가 확보되면 이 파일에 itemCode만 추가하면 된다.)
 */

export interface FuturesQuote {
  itemCode: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  up: boolean;
}

/** 네이버 실시간 폴링 응답(datas 배열) → itemCode별 시세 맵 (순수 함수) */
export function parseNaverFuturesPolling(data: unknown): Map<string, FuturesQuote> {
  const out = new Map<string, FuturesQuote>();
  const datas = (data as { datas?: unknown[] } | null)?.datas;
  if (!Array.isArray(datas)) return out;

  for (const d of datas) {
    const row = d as Record<string, unknown>;
    const itemCode = String(row?.itemCode ?? '');
    const price = num(row?.closePrice as string | undefined);
    if (!itemCode || price == null) continue;

    const change = num(row?.compareToPreviousClosePrice as string | undefined) ?? 0;
    const changePct = num(row?.fluctuationsRatio as string | undefined) ?? 0;
    out.set(itemCode, {
      itemCode,
      name: String(row?.stockName ?? itemCode),
      price,
      change,
      changePct,
      up: change >= 0,
    });
  }

  return out;
}

/** 지수선물 실시간 시세 일괄 조회 (실패 시 빈 맵 — fail-soft) */
export async function fetchNaverFutures(itemCodes: string[]): Promise<Map<string, FuturesQuote>> {
  if (itemCodes.length === 0) return new Map();
  try {
    const { data } = await axios.get(
      `https://polling.finance.naver.com/api/realtime/domestic/index/${itemCodes.join(',')}`,
      { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.naver.com/' }, timeout: 8000 },
    );
    return parseNaverFuturesPolling(data);
  } catch {
    return new Map();
  }
}
