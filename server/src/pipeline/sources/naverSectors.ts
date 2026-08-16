import axios from 'axios';
import iconv from 'iconv-lite';
import { sleep } from '../http';

/**
 * 네이버 금융 업종(섹터) 페이지 스크레이핑 (EUC-KR HTML).
 * 모바일 API에는 업종 일괄 조회가 없어 기존 검증된 스크레이퍼를 유지.
 */
const UPJONG_URL = 'https://finance.naver.com/sise/sise_group.naver?type=upjong';
const UPJONG_DETAIL_URL = 'https://finance.naver.com/sise/sise_group_detail.naver';

const http = axios.create({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  responseType: 'arraybuffer',
  timeout: 15000,
});

async function fetchSectorCodes(): Promise<Array<{ code: string; name: string }>> {
  const res = await http.get(UPJONG_URL);
  const html = iconv.decode(Buffer.from(res.data), 'euc-kr');
  const re = /type=upjong&no=(\d+)">([^<]+)<\/a>/g;
  const sectors: Array<{ code: string; name: string }> = [];
  const seen = new Set<string>();
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      sectors.push({ code: m[1], name: m[2].trim() });
    }
  }
  return sectors;
}

async function fetchSectorTickers(no: string): Promise<string[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await http.get(UPJONG_DETAIL_URL, { params: { type: 'upjong', no } });
      const html = iconv.decode(Buffer.from(res.data), 'euc-kr');
      const re = /main\.naver\?code=(\d{6})/g;
      const tickers: string[] = [];
      const seen = new Set<string>();
      let m;
      while ((m = re.exec(html)) !== null) {
        if (!seen.has(m[1])) {
          seen.add(m[1]);
          tickers.push(m[1]);
        }
      }
      return tickers;
    } catch {
      if (attempt < 2) await sleep(1000 * (attempt + 1));
    }
  }
  return [];
}

/** 티커 → 업종명 매핑 생성 */
export async function buildSectorMap(): Promise<Map<string, string>> {
  const sectorCodes = await fetchSectorCodes();
  const tickerToSector = new Map<string, string>();
  const BATCH = 3;

  for (let i = 0; i < sectorCodes.length; i += BATCH) {
    const batch = sectorCodes.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async ({ code, name }) => {
        const tickers = await fetchSectorTickers(code);
        tickers.forEach((t) => tickerToSector.set(t, name.trim()));
      }),
    );
    await sleep(200);
  }
  return tickerToSector;
}
