import axios from 'axios';
import iconv from 'iconv-lite';

/**
 * 네이버 신규상장 목록 스크레이핑 (EUC-KR HTML) — stocks.listed_at 동기화용.
 * sise_new_stock.naver?sosok=0(KOSPI)·1(KOSDAQ) 병합. 최근 상장 ~100건만 노출되는 페이지라
 * 그 이전 상장 종목은 갱신되지 않지만, "신규상장 보드"(최근 90일)에는 충분.
 * KOSPI 쪽엔 신주인수권증서·스팩·ETN 등 종목 외 코드도 섞여 있으나 stocks 테이블
 * JOIN(syncNewListings)에서 우리 목록에 없는 티커는 자연히 걸러진다.
 */

const BASE = 'https://finance.naver.com/sise/sise_new_stock.naver';

export interface NewListingRow {
  ticker: string;
  name: string;
  listedAt: string; // YYYY-MM-DD
}

const http = axios.create({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  responseType: 'arraybuffer',
  timeout: 15000,
});

/**
 * 신규상장 목록 페이지 HTML → 행 배열 (순수 함수).
 * 행 구조: <td class="no">순위</td><td class="no">YYYY.MM.DD</td>
 *          <td><a href="/item/main.naver?code=XXXXXX" class="tltle">종목명</a></td> ...
 */
export function parseNewListingRows(html: string): NewListingRow[] {
  const rowRe =
    /<td class="no">(\d{4})\.(\d{2})\.(\d{2})<\/td>\s*<td><a href="\/item\/main\.naver\?code=([0-9A-Z]{6})" class="tltle">([^<]+)<\/a><\/td>/g;

  const out: NewListingRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    out.push({
      ticker: m[4],
      name: m[5].trim(),
      listedAt: `${m[1]}-${m[2]}-${m[3]}`,
    });
  }
  return out;
}

/**
 * KOSPI·KOSDAQ 신규상장 목록 병합. 같은 티커가 양쪽에 잡히면 더 최신 상장일을 유지.
 * fail-soft: 실패 시 빈 배열 반환 — syncNewListings가 비치명 호출로 감싸므로 파이프라인엔 영향 없음.
 */
export async function fetchNewListings(): Promise<NewListingRow[]> {
  try {
    const pages = await Promise.all(
      [0, 1].map((sosok) => http.get(BASE, { params: { sosok } })),
    );
    const rows = pages.flatMap((res) =>
      parseNewListingRows(iconv.decode(Buffer.from(res.data), 'euc-kr')),
    );

    const merged = new Map<string, NewListingRow>();
    for (const r of rows) {
      const prev = merged.get(r.ticker);
      if (!prev || r.listedAt > prev.listedAt) merged.set(r.ticker, r);
    }
    return [...merged.values()];
  } catch {
    return [];
  }
}
