/**
 * 실적 캘린더 — DART 공시 제목을 실적 관련 이벤트로 분류하고, 캘린더 조회월(YYYY-MM)을
 * 검증하는 순수 함수. disclosure_events 테이블을 그대로 사용. periodic(정기보고서)
 * 판별을 위해 A타입 수집이 추가되었다(dartDisclosures.ts) — 이 파일 자체는 순수 분류 로직만.
 *
 * buildCalendarEvents: 접수일 기반 disclosure_events와 예정일 기반 earnings_schedules를
 * 병합해 캘린더 이벤트를 만든다 — IR은 개최일 파싱에 성공하면 접수일 칩을 없애고 개최일에만
 * 표시한다(2026-07-11 실사용 피드백).
 * buildListingEvents: stocks.listed_at 기반 신규상장 이벤트 — DART 공시가 아니므로
 * 별도 순수 함수로 분리.
 */

export type EarningsCategory = 'provisional' | 'ir' | 'scheduled' | 'dividend' | 'periodic' | 'listing';

export interface ParsedMonth {
  month: string;
  start: string;
  end: string;
}

interface CalendarRowBase {
  rcept_no: string;
  report_nm: string;
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
  watched: boolean;
}

/** disclosure_events(접수일) 조회 결과 — 월 범위 접수분. */
export interface CalendarDisclosureInput extends CalendarRowBase {
  date: string; // 접수일 YYYY-MM-DD
}

/** earnings_schedules(예정일) 조회 결과 — scheduled_dt 또는 announced_dt가 월 범위인 것. */
export interface CalendarScheduleInput extends CalendarRowBase {
  announced_dt: string; // 접수일 YYYY-MM-DD
  scheduled_dt: string | null; // 파싱된 예정일 YYYY-MM-DD (파싱 실패 시 NULL)
  scheduled_time: string | null; // 파싱된 예정 시간 HH:MM (파싱 실패/시간 없으면 NULL)
  kind: 'ir' | 'earnings' | 'dividend';
}

/** stocks.listed_at(신규상장일) 조회 결과 — DART 공시가 아닌 조회 전용 이벤트. */
export interface CalendarListingInput {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
  watched: boolean;
  listed_at: string; // YYYY-MM-DD
}

export interface CalendarEvent extends CalendarRowBase {
  date: string;
  category: EarningsCategory;
  // 신규상장(listing)은 DART 공시가 아니므로 원문 링크가 없다
  url: string | null;
  // 예정일로 이동한 이벤트는 접수일, 접수일 그 자체를 표시하는 이벤트는 null
  source_date: string | null;
  // 예정일 원문에서 파싱한 시간 HH:MM — 접수일 표시 이벤트·시간 파싱 실패 시 null
  time: string | null;
}

// 잠정실적: "연결재무제표기준 영업(잠정)실적(공정공시)", "영업잠정실적", "매출액또는손익구조..." 등
const PROVISIONAL_RE = /영업\s*\(?잠정\)?\s*실적|잠정\s*실적|매출액\s*또는\s*손익구조/;
// 기업설명회(IR): "기업설명회(IR)개최(안내공시)" 등
const IR_RE = /기업설명회|IR\s*개최/;
// 정기보고서(A타입): "사업보고서 (2025.12)", "[기재정정]분기보고서 (2026.03)" 등
const PERIODIC_RE = /사업보고서|반기보고서|분기보고서/;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MIN_YEAR = 2020;
const MAX_YEAR = 2100;

// earnings_schedules.kind → 캘린더 카테고리
const SCHEDULE_CATEGORY: Record<CalendarScheduleInput['kind'], EarningsCategory> = {
  ir: 'ir',
  earnings: 'scheduled',
  dividend: 'dividend',
};

/**
 * 실적 관련 공시 제목을 분류한다 — 아니면 null.
 * 우선순위: provisional → ir → periodic (동시 매칭 시 앞쪽 카테고리 우선).
 */
export function classifyEarningsEvent(reportNm: string): EarningsCategory | null {
  if (PROVISIONAL_RE.test(reportNm)) return 'provisional';
  if (IR_RE.test(reportNm)) return 'ir';
  if (PERIODIC_RE.test(reportNm)) return 'periodic';
  return null;
}

/** 'YYYY-MM' 쿼리 파라미터를 검증해 { month, start, end(다음 달 1일) }로 변환한다 — 아니면 null. */
export function parseMonthParam(raw: unknown): ParsedMonth | null {
  if (typeof raw !== 'string') return null;

  const match = MONTH_RE.exec(raw);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;

  const start = `${raw}-01`;
  const isDecember = month === 12;
  const endYear = isDecember ? year + 1 : year;
  const endMonth = isDecember ? 1 : month + 1;
  const end = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  return { month: raw, start, end };
}

function toCalendarEvent(
  row: CalendarRowBase,
  date: string,
  category: EarningsCategory,
  sourceDate: string | null,
  time: string | null = null,
): CalendarEvent {
  return {
    rcept_no: row.rcept_no,
    date,
    report_nm: row.report_nm,
    ticker: row.ticker,
    name: row.name,
    market: row.market,
    sector: row.sector,
    watched: row.watched,
    category,
    source_date: sourceDate,
    time,
    url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${row.rcept_no}`,
  };
}

/**
 * disclosures(접수일)와 schedules(예정일) rows를 병합해 캘린더 이벤트 목록을 만든다.
 * - IR: schedules에 예정일 파싱 성공(scheduled_dt NOT NULL) 건이 있으면 접수일 이벤트를 없애고
 *   개최일 이벤트로 대체한다. 파싱 실패/미동기화 건은 접수일 표시를 유지한다(fallback).
 * - earnings 예고(kind='earnings')는 예정일 파싱 성공 시에만 scheduled 이벤트를 만든다.
 * - 접수일==개최일이면 개최일 이벤트 하나만 남는다(source_date는 이때 null).
 * - 최종 이벤트의 date가 [monthStart, monthEnd) 밖이면 제외한다(안전망 — 조회월과 다른 달로
 *   이동한 이벤트가 섞여 들어오는 것을 막는다).
 */
export function buildCalendarEvents(
  disclosures: CalendarDisclosureInput[],
  schedules: CalendarScheduleInput[],
  monthStart: string,
  monthEnd: string,
): CalendarEvent[] {
  // IR 개최일 파싱에 성공한 rcept_no — 해당 접수일 ir 이벤트는 제외하고 개최일로 이동한다
  const irMovedRceptNos = new Set(
    schedules.filter((s) => s.kind === 'ir' && s.scheduled_dt !== null).map((s) => s.rcept_no),
  );

  const disclosureEvents = disclosures
    .map((d) => {
      const category = classifyEarningsEvent(d.report_nm);
      if (category === null) return null;
      if (category === 'ir' && irMovedRceptNos.has(d.rcept_no)) return null; // 개최일로 이동됨
      return toCalendarEvent(d, d.date, category, null);
    })
    .filter((e): e is CalendarEvent => e !== null);

  const scheduleEvents = schedules
    .map((s) => {
      if (s.scheduled_dt === null) return null; // 파싱 실패 — earnings/dividend는 표시 안 함, ir은 접수일 fallback으로 이미 표시됨
      const category = SCHEDULE_CATEGORY[s.kind];
      const sourceDate = s.scheduled_dt === s.announced_dt ? null : s.announced_dt;
      return toCalendarEvent(s, s.scheduled_dt, category, sourceDate, s.scheduled_time);
    })
    .filter((e): e is CalendarEvent => e !== null);

  return [...disclosureEvents, ...scheduleEvents].filter(
    (e) => e.date >= monthStart && e.date < monthEnd,
  );
}

/**
 * 신규상장 이벤트를 만든다 — stocks.listed_at 기준(DART 공시가 아니므로 buildCalendarEvents와
 * 분리된 순수 함수). rcept_no는 클라 리스트 key용으로 'listing-<ticker>'를 사용한다.
 */
export function buildListingEvents(
  rows: CalendarListingInput[],
  monthStart: string,
  monthEnd: string,
): CalendarEvent[] {
  return rows
    .filter((r) => r.listed_at >= monthStart && r.listed_at < monthEnd)
    .map((r) => ({
      rcept_no: `listing-${r.ticker}`,
      date: r.listed_at,
      report_nm: '신규상장',
      ticker: r.ticker,
      name: r.name,
      market: r.market,
      sector: r.sector,
      watched: r.watched,
      category: 'listing',
      source_date: null,
      time: null,
      url: null,
    }));
}
