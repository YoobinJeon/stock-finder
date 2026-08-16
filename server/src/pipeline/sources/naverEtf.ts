import axios from 'axios';
import iconv from 'iconv-lite';

/**
 * 네이버 ETF 전종목 실시간 시세 (비공식 JSON API).
 * DB 저장 없이 라이브 전용 — 3개월 수익률까지 응답에 포함되어 있어 v1은 스냅샷 불필요.
 * 응답 래핑: { resultCode, result: { etfItemList: [...] } } (2026-07 실측 1,141종목)
 */

const ETF_URL = 'https://finance.naver.com/api/sise/etfItemList.nhn';
const CACHE_TTL = 60 * 1000; // 60초 — 페이지 폴링이 잦아도 네이버는 분당 1회만

/** 네이버 etfTabCode(1~7) → 분류명 */
export const ETF_TABS: Record<number, string> = {
  1: '국내 시장지수',
  2: '국내 업종/테마',
  3: '국내 파생',
  4: '해외 주식',
  5: '원자재',
  6: '채권',
  7: '기타',
};

export interface EtfItem {
  ticker: string;
  name: string;
  tab: number;                     // etfTabCode 1~7
  price: number;                   // 현재가 (원)
  changePct: number;               // 등락률 (%)
  nav: number | null;              // 순자산가치 (원)
  deviationPct: number | null;     // NAV 괴리율 (%)
  threeMonthReturn: number | null; // 3개월 수익률 (%)
  volume: number;                  // 거래량 (주)
  amount: number;                  // 거래대금 (백만원)
  marketCap: number;               // 시가총액 (억원)
}

/** JSON 응답 → EtfItem 배열 (순수 함수). 형식이 어긋난 행은 건너뛴다. */
export function parseEtfList(json: unknown): EtfItem[] {
  const raw = (json as { result?: { etfItemList?: unknown } })?.result?.etfItemList;
  if (!Array.isArray(raw)) return [];

  const items: EtfItem[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    const ticker = String(r?.itemcode ?? '');
    const price = Number(r?.nowVal);
    // 종목코드는 숫자 6자리 외에 영문 혼합(예: 00088A — 신형 코드체계)도 존재
    if (!/^[0-9A-Z]{6}$/.test(ticker) || !Number.isFinite(price) || price <= 0) continue;

    const navNum = r?.nav == null ? NaN : Number(r.nav);
    const nav = Number.isFinite(navNum) && navNum > 0 ? navNum : null;
    // Number(null)=0 이므로 null/undefined는 명시적으로 걸러야 0으로 둔갑하지 않음
    const threeM = r?.threeMonthEarnRate == null ? NaN : Number(r.threeMonthEarnRate);

    items.push({
      ticker,
      name: String(r?.itemname ?? ticker),
      tab: Number(r?.etfTabCode) || 0,
      price,
      changePct: Number(r?.changeRate) || 0,
      nav,
      deviationPct: nav != null ? ((price - nav) / nav) * 100 : null,
      threeMonthReturn: Number.isFinite(threeM) ? threeM : null,
      volume: Number(r?.quant) || 0,
      // 네이버 응답의 필드명 오타(amonut)를 그대로 쓰되, 수정될 경우 대비 amount도 수용
      amount: Number(r?.amonut ?? r?.amount) || 0,
      marketCap: Number(r?.marketSum) || 0,
    });
  }
  return items;
}

let cache: { items: EtfItem[]; at: number } | null = null;

/** ETF 전종목 리스트. 60초 캐시, 실패 시 이전 캐시 또는 빈 배열 (fail-soft). */
export async function fetchEtfList(): Promise<EtfItem[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.items;
  try {
    const res = await axios.get(ETF_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://finance.naver.com/',
      },
      responseType: 'arraybuffer', // 응답이 EUC-KR(text/plain)이라 직접 디코딩
      timeout: 8000,
    });
    const json = JSON.parse(iconv.decode(Buffer.from(res.data), 'euc-kr'));
    const items = parseEtfList(json);
    if (items.length > 0) cache = { items, at: Date.now() };
    return items;
  } catch {
    return cache?.items ?? [];
  }
}
