import axios from 'axios';
import iconv from 'iconv-lite';

/**
 * 네이버 시세 순위 페이지 스크레이핑 (EUC-KR HTML) — 오늘의 특징주용.
 * - quant: sise_quant.naver (거래 상위 — 거래대금 컬럼 포함, 자체 정렬해 거래대금 TOP으로 사용)
 * - rise:  sise_rise.naver  (상승률 상위 — 상한가 포함)
 * KOSPI(sosok=0)·KOSDAQ(sosok=1)을 병합해 반환. 마감 후에도 당일 최종치 제공.
 */

const BASE = 'https://finance.naver.com/sise';
const CACHE_TTL = 60 * 1000;

export type MoverBoard = 'quant' | 'rise';

export interface MoverRow {
  ticker: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
  amount: number; // 거래대금 (백만원)
}

const http = axios.create({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  responseType: 'arraybuffer',
  timeout: 15000,
});

/**
 * 시세 순위 페이지 HTML → 행 배열 (순수 함수). sise_quant/sise_rise 공용 행 구조:
 * 종목명 앵커(class="tltle") → 현재가 → 전일비(중첩 td) → 등락률(span ±X.XX%) → 거래량 → 거래대금.
 */
export function parseSiseRows(html: string): MoverRow[] {
  const td = '<td class="number">(?:(?!<\\/td>)[\\s\\S])*?<\\/td>'; // 중첩 내용 있는 td 1개
  const rowRe = new RegExp(
    'main\\.naver\\?code=([0-9A-Z]{6})" class="tltle">([^<]+)<\\/a><\\/td>\\s*' +
      '<td class="number">([\\d,]+)<\\/td>\\s*' + // 현재가
      td + '\\s*' + // 전일비 (사용 안 함)
      '<td class="number">\\s*<span class="tah[^"]*">\\s*([+\\-]?[\\d.,]+)%\\s*<\\/span>\\s*<\\/td>\\s*' + // 등락률
      '<td class="number">([\\d,]+)<\\/td>\\s*' + // 거래량
      '<td class="number">([\\d,]+)<\\/td>', // 거래대금(백만)
    'g',
  );

  const n = (s: string) => Number(s.replace(/,/g, ''));
  const out: MoverRow[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({
      ticker: m[1],
      name: m[2].trim(),
      price: n(m[3]),
      changePct: Number(m[4].replace(/,/g, '')),
      volume: n(m[5]),
      amount: n(m[6]),
    });
  }
  return out;
}

const PAGE: Record<MoverBoard, string> = {
  quant: 'sise_quant.naver',
  rise: 'sise_rise.naver',
};

const cache = new Map<MoverBoard, { rows: MoverRow[]; at: number }>();

/** 보드별 KOSPI+KOSDAQ 병합 행. 60초 캐시, 실패 시 이전 캐시 또는 빈 배열 (fail-soft). */
export async function fetchMovers(board: MoverBoard): Promise<MoverRow[]> {
  const cached = cache.get(board);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.rows;

  try {
    const pages = await Promise.all(
      [0, 1].map((sosok) => http.get(`${BASE}/${PAGE[board]}`, { params: { sosok } })),
    );
    const rows = pages.flatMap((res) =>
      parseSiseRows(iconv.decode(Buffer.from(res.data), 'euc-kr')),
    );
    if (rows.length > 0) cache.set(board, { rows, at: Date.now() });
    return rows;
  } catch {
    return cached?.rows ?? [];
  }
}
