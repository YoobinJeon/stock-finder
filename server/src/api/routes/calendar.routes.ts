import { Router, Request, Response } from 'express';
import { getDb } from '../../config/database';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  parseMonthParam,
  buildCalendarEvents,
  buildListingEvents,
  type CalendarDisclosureInput,
  type CalendarScheduleInput,
  type CalendarListingInput,
  type CalendarEvent,
} from '../../pipeline/earningsCalendar';

const router = Router();

/** KST(UTC+9) 기준 현재 월('YYYY-MM')을 구한다 — month 파라미터 기본값. */
function currentKstMonth(): string {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const year = kstNow.getUTCFullYear();
  const month = String(kstNow.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function groupByDate(events: CalendarEvent[]): Record<string, CalendarEvent[]> {
  const sorted = [...events].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return sorted.reduce<Record<string, CalendarEvent[]>>(
    (acc, event) => ({ ...acc, [event.date]: [...(acc[event.date] ?? []), event] }),
    {},
  );
}

// 월별 실적 관련 공시(잠정실적·IR·예정일·배당기준일·신규상장) 캘린더 —
// disclosure_events + earnings_schedules + stocks.listed_at.
// IR·실적예고·배당결정은 예정일(기준일) 파싱 성공 시 접수일이 아닌 실제 예정일에 표시(실사용 피드백, 2026-07-11).
router.get('/earnings', asyncHandler(async (req: Request, res: Response) => {
  const rawMonth = typeof req.query.month === 'string' ? req.query.month : currentKstMonth();
  const parsed = parseMonthParam(rawMonth);

  if (!parsed) {
    res.status(400).json({ error: 'month는 YYYY-MM 형식이어야 합니다' });
    return;
  }

  const db = getDb();

  const { rows: disclosureRows } = await db.query(
    `SELECT d.rcept_no, to_char(d.rcept_dt,'YYYY-MM-DD') AS date, d.report_nm,
            d.ticker, s.name, s.market, s.sector,
            (w.ticker IS NOT NULL) AS watched
     FROM disclosure_events d
     JOIN stocks s ON s.ticker = d.ticker AND s.is_active = TRUE
     LEFT JOIN watchlist w ON w.ticker = d.ticker
     WHERE d.rcept_dt >= $1 AND d.rcept_dt < $2
     ORDER BY d.rcept_dt, s.name`,
    [parsed.start, parsed.end],
  );

  // scheduled_dt 또는 announced_dt가 월 범위에 걸치는 건을 모두 가져온다 —
  // 전자는 "이번달에 예정일이 있는 건"(지난달 접수분 포함), 후자는 "이번달 접수분의
  // 예정일 이동/제외 판단"(다음달 개최분 제외 포함)에 쓰인다.
  const { rows: scheduleRows } = await db.query(
    `SELECT es.rcept_no, to_char(es.announced_dt,'YYYY-MM-DD') AS announced_dt,
            to_char(es.scheduled_dt,'YYYY-MM-DD') AS scheduled_dt, es.scheduled_time,
            es.kind, es.report_nm,
            es.ticker, s.name, s.market, s.sector,
            (w.ticker IS NOT NULL) AS watched
     FROM earnings_schedules es
     JOIN stocks s ON s.ticker = es.ticker AND s.is_active = TRUE
     LEFT JOIN watchlist w ON w.ticker = es.ticker
     WHERE es.scheduled_dt IS NOT NULL
       AND ((es.scheduled_dt >= $1 AND es.scheduled_dt < $2)
         OR (es.announced_dt >= $1 AND es.announced_dt < $2))
     ORDER BY es.scheduled_dt, s.name`,
    [parsed.start, parsed.end],
  );

  // 신규상장 — DART 공시가 아닌 stocks.listed_at 기준 조회
  const { rows: listingRows } = await db.query(
    `SELECT s.ticker, s.name, s.market, s.sector, to_char(s.listed_at,'YYYY-MM-DD') AS listed_at,
            (w.ticker IS NOT NULL) AS watched
     FROM stocks s
     LEFT JOIN watchlist w ON w.ticker = s.ticker
     WHERE s.is_active = TRUE AND s.listed_at >= $1 AND s.listed_at < $2
     ORDER BY s.listed_at, s.name`,
    [parsed.start, parsed.end],
  );

  const events = [
    ...buildCalendarEvents(
      disclosureRows as CalendarDisclosureInput[],
      scheduleRows as CalendarScheduleInput[],
      parsed.start,
      parsed.end,
    ),
    ...buildListingEvents(listingRows as CalendarListingInput[], parsed.start, parsed.end),
  ];

  res.json({ month: parsed.month, total: events.length, days: groupByDate(events) });
}));

export default router;
