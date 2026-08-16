import axios from 'axios';
import iconv from 'iconv-lite';

/**
 * 네이버 업종 시세 페이지에서 섹터별 실시간 등락률·상승/하락 종목수를 조회.
 * 업종명이 SF의 stocks.sector와 1:1(같은 페이지로 수집 — naverSectors.ts)이라 매핑 변환 없이 사용.
 * 산업 레이더 장중 오버레이용. 마감 후에도 네이버는 당일 최종치를 보여줌.
 */

const UPJONG_URL = 'https://finance.naver.com/sise/sise_group.naver?type=upjong';
const CACHE_TTL = 60 * 1000; // 60초 스로틀 (레이더 폴링이 잦아도 네이버는 분당 1회만)

export interface SectorLive {
  chgPct: number; // 전일대비 등락률 (%)
  total: number; // 전체 종목수
  up: number; // 상승 종목수
  down: number; // 하락 종목수
}

/**
 * 업종 시세 페이지 HTML → 섹터명별 실시간 지표 (순수 함수, 검증 용이).
 * 각 행: <a ...no=NN>업종명</a> … <span class="tah…">±X.XX%</span> … 전체·상승·보합·하락 4개 숫자 td.
 */
export function parseSectorLive(html: string): Map<string, SectorLive> {
  const map = new Map<string, SectorLive>();
  const rowRe =
    /sise_group_detail\.naver\?type=upjong&no=\d+">([^<]+)<\/a>[\s\S]*?<span class="tah[^"]*">\s*([+\-]?[\d.]+)%\s*<\/span>\s*<\/td>\s*<td class="number">(\d+)<\/td>\s*<td class="number">(\d+)<\/td>\s*<td class="number">(\d+)<\/td>\s*<td class="number">(\d+)<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const name = m[1].trim();
    // m[5] = 보합(사용 안 함)
    map.set(name, {
      chgPct: Number(m[2]),
      total: Number(m[3]),
      up: Number(m[4]),
      down: Number(m[6]),
    });
  }
  return map;
}

let cache: { map: Map<string, SectorLive>; at: number } | null = null;

/** 섹터별 실시간 지표 맵. 60초 캐시. 실패 시 빈 맵(호출부에서 EOD로 폴백). */
export async function fetchSectorLive(): Promise<Map<string, SectorLive>> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.map;
  try {
    const res = await axios.get(UPJONG_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      responseType: 'arraybuffer',
      timeout: 15000,
    });
    const html = iconv.decode(Buffer.from(res.data), 'euc-kr');
    const map = parseSectorLive(html);
    if (map.size > 0) cache = { map, at: Date.now() };
    return map;
  } catch {
    return cache?.map ?? new Map();
  }
}
