import axios from 'axios';

/**
 * 네이버 증권 종목별 뉴스 (비공식 JSON API) — : 종목 상세 "최근 뉴스" 섹션.
 * 기사 원문 링크는 officeId/articleId 조합: https://n.news.naver.com/mnews/article/{officeId}/{articleId}
 */

const MAX_ITEMS = 10;
const CACHE_TTL = 5 * 60 * 1000; // 종목별 뉴스는 5분 캐시
const TICKER_RE = /^[0-9A-Z]{6}$/;

export interface StockNewsItem {
  title: string;
  press: string;
  datetime: string; // 'YYYY-MM-DD HH:mm'
  url: string;
}

interface RawStockNewsGroup {
  items?: unknown;
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** HTML 엔티티(named·숫자·16진) 디코드 (순수 함수). 다른 뉴스 파서에서도 재사용 가능하도록 export. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === '#') {
      const codePoint = entity[1] === 'x' || entity[1] === 'X'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return HTML_ENTITIES[entity] ?? match;
  });
}

/** 'YYYYMMDDHHmm' → 'YYYY-MM-DD HH:mm'. 형식 불량이면 null (호출부에서 스킵). */
function formatDatetime(dt: string): string | null {
  if (!/^\d{12}$/.test(dt)) return null;
  const year = dt.slice(0, 4);
  const month = dt.slice(4, 6);
  const day = dt.slice(6, 8);
  const hour = dt.slice(8, 10);
  const minute = dt.slice(10, 12);
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/** 종목 뉴스 그룹 배열(JSON) → StockNewsItem 배열 (순수 함수, 방어적 파싱). 최대 10건. */
export function parseStockNews(json: unknown): StockNewsItem[] {
  if (!Array.isArray(json)) return [];

  const out: StockNewsItem[] = [];
  for (const group of json as RawStockNewsGroup[]) {
    const items = Array.isArray(group?.items) ? group.items : [];
    for (const raw of items as Array<Record<string, unknown>>) {
      const officeId = String(raw?.officeId ?? '').trim();
      const articleId = String(raw?.articleId ?? '').trim();
      if (!officeId || !articleId) continue;

      const rawTitle = String(raw?.titleFull ?? raw?.title ?? '').trim();
      if (!rawTitle) continue;

      const datetime = formatDatetime(String(raw?.datetime ?? ''));
      if (!datetime) continue;

      out.push({
        title: decodeHtmlEntities(rawTitle),
        press: String(raw?.officeName ?? ''),
        datetime,
        url: `https://n.news.naver.com/mnews/article/${officeId}/${articleId}`,
      });
      if (out.length >= MAX_ITEMS) return out;
    }
  }
  return out;
}

const cache = new Map<string, { items: StockNewsItem[]; at: number }>();

/** 티커별 최근 뉴스. 5분 캐시, 실패 시 이전 캐시 또는 빈 배열 (fail-soft). */
export async function fetchStockNews(ticker: string): Promise<StockNewsItem[]> {
  if (!TICKER_RE.test(ticker)) return [];

  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.items;

  try {
    const res = await axios.get(`https://m.stock.naver.com/api/news/stock/${ticker}`, {
      params: { pageSize: MAX_ITEMS },
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 8000,
    });
    const items = parseStockNews(res.data);
    if (items.length > 0) cache.set(ticker, { items, at: Date.now() });
    return items;
  } catch {
    return cache.get(ticker)?.items ?? [];
  }
}
