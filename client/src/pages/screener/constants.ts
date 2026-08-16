/**
 * 스크리너 화면 상수 — 페이지 크기·비교 상한·카테고리 색/라벨.
 * (2026-07-26 ScreenerPage.tsx 분할 — 800줄 규칙. 로직은 그대로 옮겼다.)
 */

export const MARKETS = ['전체', 'KOSPI', 'KOSDAQ'];
export const PAGE_SIZE = 20;
export const MAX_COMPARE = 4;
export const COMPARE_LIMIT_MSG_MS = 2500;

export const CATEGORY_COLORS: Record<string, string> = {
  value:          'bg-blue-400',
  quality:        'bg-emerald-400',
  growth:         'bg-orange-400',
  momentum:       'bg-purple-400',
  tech_innovation:'bg-pink-400',
  flow:           'bg-cyan-400',
};

export const CATEGORY_LABELS: Record<string, string> = {
  value:          '가치',
  quality:        '퀄리티',
  growth:         '성장',
  momentum:       '모멘텀',
  tech_innovation:'기술',
  flow:           '수급',
};
