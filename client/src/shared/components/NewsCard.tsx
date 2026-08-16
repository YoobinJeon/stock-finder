import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { API } from '../api/endpoints';

interface NewsItem {
  title: string;
  press: string;
  at: string;   // 'YYYY-MM-DD HH:mm'
  url: string;
  summary: string | null;
}

interface NewsResponse {
  count: number;
  items: NewsItem[];
}

/** 시장 주요뉴스 위젯 — 네이버 증권 mainnews (2분 갱신, 클릭 시 기사 새 탭) */
export function NewsCard() {
  const [keyword, setKeyword] = useState('');

  const { data, isLoading } = useQuery<NewsResponse>({
    queryKey: ['market', 'news'],
    queryFn: () => apiClient.get(API.market.news).then((r) => r.data),
    refetchInterval: 2 * 60 * 1000,
    staleTime: 100 * 1000,
  });

  const items = data?.items ?? [];
  const trimmedKeyword = keyword.trim();
  const filteredItems = trimmedKeyword.length === 0
    ? items
    : items.filter((n) => n.title.toLowerCase().includes(trimmedKeyword.toLowerCase()));

  return (
    <div className="bg-surface rounded-xl border border-gray-200 mb-8">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold text-gray-900 shrink-0">📰 시장 주요뉴스</h3>
        <div className="flex items-center gap-2 min-w-0">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="키워드 필터"
            className="w-28 sm:w-36 text-xs px-2 py-1 rounded-md border border-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
          <span className="text-xs text-gray-400 shrink-0 hidden sm:inline">네이버 증권 · 2분 갱신</span>
        </div>
      </div>

      {isLoading && <p className="px-5 py-6 text-sm text-gray-400">불러오는 중…</p>}
      {!isLoading && items.length === 0 && (
        <p className="px-5 py-6 text-sm text-gray-400">뉴스를 가져오지 못했습니다.</p>
      )}
      {!isLoading && items.length > 0 && filteredItems.length === 0 && (
        <p className="px-5 py-6 text-sm text-gray-400">'{trimmedKeyword}' 매칭 뉴스 없음</p>
      )}

      <div className="divide-y divide-gray-50">
        {filteredItems.slice(0, 8).map((n) => (
          <a
            key={n.url}
            href={n.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-5 py-2.5 hover:bg-gray-50"
          >
            <p className="text-sm text-gray-900 leading-snug">{n.title}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {n.press} · {n.at.slice(5)} {/* MM-DD HH:mm */}
            </p>
          </a>
        ))}
      </div>
    </div>
  );
}
