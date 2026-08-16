import axios from 'axios';

/**
 * 네이버 증권 주요뉴스 (비공식 JSON API) — 뉴스 모니터링의 뉴스 피드.
 * 기사 원문 링크는 oid/aid 조합: https://n.news.naver.com/mnews/article/{oid}/{aid}
 */

const NEWS_URL = 'https://api.stock.naver.com/news/mainnews';
const CACHE_TTL = 2 * 60 * 1000; // 뉴스는 2분이면 충분

export interface NewsItem {
  title: string;
  press: string;        // 언론사
  at: string;           // 'YYYY-MM-DD HH:mm'
  url: string;
  summary: string | null;
}

/** mainnews JSON 배열 → NewsItem 배열 (순수 함수, 방어적 파싱) */
export function parseMainNews(json: unknown): NewsItem[] {
  if (!Array.isArray(json)) return [];
  const out: NewsItem[] = [];
  for (const r of json as Array<Record<string, unknown>>) {
    const oid = String(r?.oid ?? '');
    const aid = String(r?.aid ?? '');
    const title = String(r?.tit ?? '').trim();
    const dt = String(r?.dt ?? '');
    if (!oid || !aid || !title || !/^\d{12,14}$/.test(dt)) continue;

    const summary = typeof r?.subcontent === 'string' ? r.subcontent.trim() : '';
    out.push({
      title,
      press: String(r?.ohnm ?? ''),
      at: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)} ${dt.slice(8, 10)}:${dt.slice(10, 12)}`,
      url: `https://n.news.naver.com/mnews/article/${oid}/${aid}`,
      summary: summary.length > 0 ? summary.slice(0, 120) : null,
    });
  }
  return out;
}

let cache: { items: NewsItem[]; at: number } | null = null;

/** 주요뉴스 목록. 2분 캐시, 실패 시 이전 캐시 또는 빈 배열 (fail-soft). */
export async function fetchMainNews(pageSize = 20): Promise<NewsItem[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.items;
  try {
    const res = await axios.get(NEWS_URL, {
      params: { pageSize },
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 8000,
    });
    const items = parseMainNews(res.data);
    if (items.length > 0) cache = { items, at: Date.now() };
    return items;
  } catch {
    return cache?.items ?? [];
  }
}
