export type EarningsCategory = 'provisional' | 'ir' | 'scheduled' | 'dividend' | 'periodic' | 'listing';

export interface EarningsEvent {
  rcept_no: string;
  date: string;
  report_nm: string;
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
  watched: boolean;
  category: EarningsCategory;
  // 신규상장(listing)은 DART 공시가 아니므로 원문 링크가 없다
  url: string | null;
  // 예정일로 이동한 이벤트는 접수일(YYYY-MM-DD), 접수일 그 자체를 표시하는 이벤트는 null
  source_date?: string | null;
  // 예정일 원문에서 파싱한 시간 'HH:MM' — 접수일 표시 이벤트·시간 파싱 실패 시 null/undefined
  time?: string | null;
}

export interface EarningsCalendarResponse {
  month: string;
  total: number;
  days: Record<string, EarningsEvent[]>;
}

// 카테고리별 표시 상수 — 캘린더 셀·상세 목록·팝업에서 공용 (DRY)
export const CATEGORY_LABEL: Record<EarningsCategory, string> = {
  provisional: '잠정실적',
  ir: 'IR',
  scheduled: '발표예정',
  dividend: '배당기준일',
  periodic: '정기보고서',
  listing: '신규상장',
};

export const CATEGORY_DOT: Record<EarningsCategory, string> = {
  provisional: 'bg-red-500',
  ir: 'bg-sky-600',
  scheduled: 'bg-amber-500',
  dividend: 'bg-emerald-500',
  periodic: 'bg-violet-500',
  listing: 'bg-pink-500',
};

export const CATEGORY_CHIP: Record<EarningsCategory, string> = {
  provisional: 'bg-red-50 text-red-600',
  ir: 'bg-sky-50 text-sky-700',
  scheduled: 'bg-amber-50 text-amber-700',
  dividend: 'bg-emerald-50 text-emerald-700',
  periodic: 'bg-violet-50 text-violet-700',
  listing: 'bg-pink-50 text-pink-700',
};

// 상세 목록·팝업 배지는 칩과 동일 톤을 사용
export const CATEGORY_BADGE = CATEGORY_CHIP;

// 시간이 없는 이벤트끼리의 정렬 우선순위 — 잠정실적 > IR > 발표예정 > 배당기준일 > 신규상장 > 정기보고서
const CATEGORY_PRIORITY: Record<EarningsCategory, number> = {
  provisional: 0,
  ir: 1,
  scheduled: 2,
  dividend: 3,
  listing: 4,
  periodic: 5,
};

/**
 * 실적 이벤트 목록을 가독성 좋은 순서로 정렬한다 — 시간 있는 것 먼저 시간 오름차순,
 * 그다음 시간 없는 것은 카테고리 우선순위(잠정실적→IR→발표예정→배당기준일→신규상장→정기보고서) → 이름순.
 * 상세 목록·팝업 dayList 모드 공용(DRY).
 */
export function sortEarningsEvents(events: EarningsEvent[]): EarningsEvent[] {
  return [...events].sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time);
    if (a.time && !b.time) return -1;
    if (!a.time && b.time) return 1;

    const categoryDiff = CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category];
    if (categoryDiff !== 0) return categoryDiff;
    return a.name.localeCompare(b.name, 'ko');
  });
}
