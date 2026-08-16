import { getJson, num, sleep } from '../http';
import type { IngestScope } from '../ingest';

export interface ListedStock {
  ticker: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ';
  marketCap: number | null; // 원
}

const PAGE_SIZE = 100;
const MAX_PAGES = 40;

const listUrl = (market: string, page: number) =>
  `https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=${PAGE_SIZE}`;

/** 시총순 정렬된 종목 목록 (네이버 모바일 JSON API) */
async function fetchMarket(
  market: 'KOSPI' | 'KOSDAQ',
  limit = Number.POSITIVE_INFINITY,
): Promise<ListedStock[]> {
  const out: ListedStock[] = [];

  for (let page = 1; out.length < limit && page <= MAX_PAGES; page++) {
    const data = await getJson(listUrl(market, page));
    const stocks: any[] = data?.stocks ?? [];

    for (const s of stocks) {
      if (!s?.itemCode || !s?.stockName) continue;
      if (s.stockEndType && s.stockEndType !== 'stock') continue; // ETF/ETN 등 제외
      out.push({
        ticker: String(s.itemCode),
        name: String(s.stockName).trim(),
        market,
        marketCap: num(s.marketValueRaw ?? s.marketValue),
      });
    }

    if (stocks.length < PAGE_SIZE) break;
    await sleep(150);
  }

  return Number.isFinite(limit) ? out.slice(0, limit) : out;
}

export async function fetchStockList(scope: IngestScope): Promise<ListedStock[]> {
  if (scope === 'top200') {
    const [kospi, kosdaq] = await Promise.all([
      fetchMarket('KOSPI', 200),
      fetchMarket('KOSDAQ', 100),
    ]);
    return dedupe([...kospi, ...kosdaq])
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
      .slice(0, 200);
  }

  if (scope === 'kospi') return dedupe(await fetchMarket('KOSPI'));

  const [kospi, kosdaq] = await Promise.all([fetchMarket('KOSPI'), fetchMarket('KOSDAQ')]);
  return dedupe([...kospi, ...kosdaq]);
}

function dedupe(list: ListedStock[]): ListedStock[] {
  const map = new Map<string, ListedStock>();
  for (const s of list) if (!map.has(s.ticker)) map.set(s.ticker, s);
  return [...map.values()];
}
