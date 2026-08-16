/**
 * 실적 발표·IR 개최 "예정일" 파싱 — 공시 원문에서 미래 개최/발표 예정일을 추출해
 * earnings_schedules에 적재한다 (: 캘린더 "발표예정"/IR 카테고리).
 */
import type { Db } from '../config/database';
import { sleep } from './http';
import { fetchDartDocumentText } from './sources/dartDocument';
import { logger } from '../utils/logger';

export type ScheduleKind = 'ir' | 'earnings' | 'dividend';

// 기업설명회(IR) 개최 안내
const IR_RE = /기업설명회|IR개최/;
// 결산실적공시예고, 영업실적등에대한전망(공정공시) 등
const EARNINGS_RE = /실적공시예고|실적발표예정|영업실적등에대한전망/;
// 현금ㆍ현물배당결정, 주식배당결정 등 — 'ㆍ'는 공백이 아니므로 공백 제거 후에도 그대로 남는다
const DIVIDEND_RE = /배당결정/;

/** 예정일 파싱 대상 공시인지 판별 — 아니면 null. [기재정정]은 원본과 중복이므로 제외. */
export function classifyScheduleSource(reportNm: string): ScheduleKind | null {
  const nm = reportNm.replace(/\s/g, '');
  if (nm.includes('정정')) return null;
  if (IR_RE.test(nm)) return 'ir';
  if (EARNINGS_RE.test(nm)) return 'earnings';
  if (DIVIDEND_RE.test(nm)) return 'dividend';
  return null;
}

// 'YYYY년 M월 D일' / 'YYYY.MM.DD' / 'YYYY-MM-DD' / 'YYYY/MM/DD' (공백·자릿수 변형 허용)
const DATE_RE =
  /(\d{4})\s*(?:년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일|\.(\d{1,2})\.(\d{1,2})|-(\d{1,2})-(\d{1,2})|\/(\d{1,2})\/(\d{1,2}))/g;

// 예정일이 주로 등장하는 키워드 뒤 이 길이(문자 수) 이내를 우선 탐색
const KEYWORD_WINDOW = 200;
const KEYWORD_RE = /일시|개최일|발표일|공시\s*예정일|예정일/g;
// 배당결정 공시는 "배당기준일"(또는 단순 "기준일") 뒤에서 날짜를 찾는다
const DIVIDEND_KEYWORD_RE = /배당기준일|기준일/g;

/** kind별 예정일 탐색 키워드 정규식 — dividend는 기준일 계열, 그 외(ir·earnings)는 기존 KEYWORD_RE. */
function keywordRegexForKind(kind: ScheduleKind): RegExp {
  return kind === 'dividend' ? DIVIDEND_KEYWORD_RE : KEYWORD_RE;
}

// 오파싱 방어: 접수일 이후 이 일수 이내만 유효한 예정일로 인정
const MAX_LOOKAHEAD_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function isWithinLookahead(dateStr: string, announcedDate: string): boolean {
  const d = new Date(`${dateStr}T00:00:00Z`).getTime();
  const a = new Date(`${announcedDate}T00:00:00Z`).getTime();
  if (Number.isNaN(d) || Number.isNaN(a)) return false;
  return d >= a && d <= a + MAX_LOOKAHEAD_DAYS * MS_PER_DAY;
}

interface DateMatch {
  dateStr: string;
  // 원본 텍스트 기준 날짜 매치가 끝나는 절대 위치 — 시간 탐색 시작점
  endIndex: number;
}

/**
 * region(원본 텍스트의 부분 문자열) 내 첫 유효 날짜(announcedDate 이상·180일 이내)를 찾는다.
 * regionOffset은 region이 원본 텍스트에서 시작하는 절대 위치(endIndex 계산용).
 */
function findValidDateInRegion(
  region: string,
  announcedDate: string,
  regionOffset: number,
): DateMatch | null {
  DATE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DATE_RE.exec(region))) {
    const year = Number(match[1]);
    const month = Number(match[2] ?? match[4] ?? match[6] ?? match[8]);
    const day = Number(match[3] ?? match[5] ?? match[7] ?? match[9]);
    if (!isValidCalendarDate(year, month, day)) continue;

    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (isWithinLookahead(dateStr, announcedDate)) {
      return { dateStr, endIndex: regionOffset + match.index + match[0].length };
    }
  }
  return null;
}

function firstValidDate(text: string, announcedDate: string): string | null {
  return findValidDateInRegion(text, announcedDate, 0)?.dateStr ?? null;
}

/**
 * 공시 원문 텍스트에서 접수일 이후의 첫 예정일 매치(날짜 문자열 + 원문 내 위치)를 찾는다.
 * keywordRe는 kind별 탐색 키워드(기본값 KEYWORD_RE) — 반드시 'g' 플래그를 가진 정규식이어야 한다.
 */
function findScheduledDateMatch(
  text: string,
  announcedDate: string,
  keywordRe: RegExp = KEYWORD_RE,
): DateMatch | null {
  keywordRe.lastIndex = 0;
  let keywordMatch: RegExpExecArray | null;
  while ((keywordMatch = keywordRe.exec(text))) {
    const start = keywordMatch.index + keywordMatch[0].length;
    const region = text.slice(start, start + KEYWORD_WINDOW);
    const found = findValidDateInRegion(region, announcedDate, start);
    if (found) return found;
  }

  return findValidDateInRegion(text, announcedDate, 0);
}

/** 공시 원문 텍스트에서 접수일 이후의 첫 예정일을 찾는다 — 없으면 null */
export function parseScheduledDate(
  text: string,
  announcedDate: string,
  keywordRe: RegExp = KEYWORD_RE,
): string | null {
  return findScheduledDateMatch(text, announcedDate, keywordRe)?.dateStr ?? null;
}

// 예정일 매치 위치 이후 이 길이(문자 수) 이내에서 시간을 탐색
const TIME_WINDOW = 100;
/**
 * "16:00" / "16시" / "16시 30분" / "오후 4시" / "오전 9시 30분" 매칭.
 * - 콜론형은 분 2자리 필수 — "4. 개최방법 1:1 미팅"의 비율 표기를 01:01로 오인하던 버그 방지.
 * - ';'도 허용 — 원문에 "13;30"처럼 콜론을 오타로 적는 사례가 실제로 있다.
 * - '시' 뒤 '간' 배제 — "2시간", "시작시간" 같은 표현을 시각으로 오인하지 않도록.
 */
const TIME_RE = /(오전|오후)?\s*(?:(\d{1,2})\s*[:;]\s*(\d{2})|(\d{1,2})\s*시(?!간)\s*(?:(\d{1,2})\s*분)?)/;
/**
 * 원문이 예정 시각을 "--:--"(미정)로 적은 경우 — DART IR 서식에서 시간 미정 시 이렇게 채운다.
 * 날짜 바로 뒤에 붙으므로 시작 위치에 고정해서 판별하고, 이때는 탐색을 중단한다.
 * 그러지 않으면 뒤쪽 본문의 "1:1 미팅" 등을 시각으로 잘못 집어온다.
 */
const TIME_UNDECIDED_RE = /^\s*-{1,2}\s*[:;]\s*-{1,2}/;

/** 오전/오후 표기를 반영해 'HH:MM'으로 변환한다 — 시/분이 범위를 벗어나면 null */
function toHhmm(meridiem: string | undefined, rawHour: number, minute: number): string | null {
  let hour = rawHour;
  if (meridiem === '오후' && hour !== 12) hour += 12;
  if (meridiem === '오전' && hour === 12) hour = 0;

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 날짜 매치 종료 위치 이후 TIME_WINDOW 내에서 시간을 찾아 'HH:MM'으로 변환한다 — 없거나 무효면 null */
function parseTimeAfter(text: string, dateEndIndex: number): string | null {
  const region = text.slice(dateEndIndex, dateEndIndex + TIME_WINDOW);
  if (TIME_UNDECIDED_RE.test(region)) return null;

  const match = TIME_RE.exec(region);
  if (!match) return null;

  const isColonForm = match[2] !== undefined;
  const hour = Number(isColonForm ? match[2] : match[4]);
  const minute = isColonForm ? Number(match[3]) : match[5] !== undefined ? Number(match[5]) : 0;

  return toHhmm(match[1], hour, minute);
}

/**
 * 공시 원문 텍스트에서 접수일 이후의 첫 예정일과, 그 위치 이후에 등장하는 예정 시간을 함께 찾는다.
 * 날짜를 찾지 못하면 null. 시간을 찾지 못하거나 무효(25시 등)하면 time은 null(날짜만으로 유효).
 */
export function parseScheduledDateTime(
  text: string,
  announcedDate: string,
  keywordRe: RegExp = KEYWORD_RE,
): { date: string; time: string | null } | null {
  const dateMatch = findScheduledDateMatch(text, announcedDate, keywordRe);
  if (!dateMatch) return null;

  return { date: dateMatch.dateStr, time: parseTimeAfter(text, dateMatch.endIndex) };
}

interface CandidateRow {
  rcept_no: string;
  ticker: string;
  rcept_dt: string;
  report_nm: string;
}

const SYNC_LOOKBACK_DAYS = 60;
const SYNC_MAX_PER_RUN = 50;
const SYNC_REQUEST_DELAY_MS = 300;

/**
 * 최근 60일 disclosure_events 중 예정일 파싱 대상인데 earnings_schedules에 없는 건을
 * 파싱해 적재한다 (멱등 — rcept_no PK, 파싱 실패도 scheduled_dt NULL로 저장해 재시도 방지).
 */
export async function syncEarningsSchedules(
  db: Db,
  apiKey: string,
): Promise<{ scanned: number; parsed: number }> {
  const { rows } = await db.query(
    `SELECT d.rcept_no, d.ticker, to_char(d.rcept_dt,'YYYY-MM-DD') AS rcept_dt, d.report_nm
     FROM disclosure_events d
     LEFT JOIN earnings_schedules es ON es.rcept_no = d.rcept_no
     WHERE es.rcept_no IS NULL AND d.rcept_dt >= NOW() - INTERVAL '${SYNC_LOOKBACK_DAYS} days'
     ORDER BY d.rcept_dt DESC`,
  );

  const candidates = (rows as CandidateRow[])
    .map((row) => ({ row, kind: classifyScheduleSource(row.report_nm) }))
    .filter((c): c is { row: CandidateRow; kind: ScheduleKind } => c.kind !== null)
    .slice(0, SYNC_MAX_PER_RUN);

  let parsed = 0;
  let fetchFailed = 0;
  for (const { row, kind } of candidates) {
    const text = await fetchDartDocumentText(apiKey, row.rcept_no);

    // 원문 조회 실패(일시적 오류·레이트리밋 → null)는 예정일을 확정 저장하지 않고 건너뛴다.
    // 저장하면 scheduled_dt=NULL로 굳어져(재시도 차단) 예정일이 영구 유실되고 IR 이벤트가
    // 접수일 칩에 머무는 버그가 있었다 — 다음 실행에서 재시도되도록 skip한다.
    if (text === null) {
      fetchFailed++;
      await sleep(SYNC_REQUEST_DELAY_MS);
      continue;
    }

    // 원문 조회 성공 후 파싱 실패는 정상적으로 NULL 저장(재시도 방지) — 원문에 예정일이 없는 건.
    const parsedSchedule = parseScheduledDateTime(text, row.rcept_dt, keywordRegexForKind(kind));
    const scheduledDt = parsedSchedule?.date ?? null;
    const scheduledTime = parsedSchedule?.time ?? null;
    if (scheduledDt) parsed++;

    await db.query(
      `INSERT INTO earnings_schedules (rcept_no, ticker, announced_dt, scheduled_dt, scheduled_time, kind, report_nm)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (rcept_no) DO NOTHING`,
      [row.rcept_no, row.ticker, row.rcept_dt, scheduledDt, scheduledTime, kind, row.report_nm.slice(0, 300)],
    );

    await sleep(SYNC_REQUEST_DELAY_MS);
  }

  const failNote = fetchFailed > 0 ? `, ${fetchFailed}건 원문 조회 실패(다음 실행 재시도)` : '';
  logger.info(`실적 예정일 동기화: ${candidates.length}건 대상, ${parsed}건 예정일 파싱 성공${failNote}`);
  return { scanned: candidates.length, parsed };
}

// 재파싱 대상 기간 — 캘린더가 실제로 보여주는 최근·예정 구간을 덮는 범위
const REPARSE_LOOKBACK_DAYS = 90;

interface ReparseRow {
  rcept_no: string;
  announced_dt: string;
  scheduled_dt: string | null;
  scheduled_time: string | null;
  kind: ScheduleKind;
}

/** 재파싱 결과 요약 — 무엇이 몇 건 바뀌었는지 보고용 */
export interface ReparseTally {
  scanned: number;
  updated: number;
  fetchFailed: number;
}

/**
 * 이미 적재된 earnings_schedules 행을 원문에서 다시 파싱해 갱신한다 (파싱 규칙 수정 소급 적용).
 * sync는 ON CONFLICT DO NOTHING이라 기존 행을 고치지 못하므로, 파서를 고친 뒤에는 이 경로로
 * 최근 REPARSE_LOOKBACK_DAYS일치를 다시 읽어 예정일·시간을 UPDATE한다.
 * 원문 조회 실패 건은 기존 값을 그대로 두고 건너뛴다(조회 실패로 값을 지우지 않기 위해).
 */
export async function reparseEarningsSchedules(
  db: Db,
  apiKey: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ReparseTally> {
  const { rows } = await db.query(
    `SELECT rcept_no, to_char(announced_dt,'YYYY-MM-DD') AS announced_dt,
            to_char(scheduled_dt,'YYYY-MM-DD') AS scheduled_dt, scheduled_time, kind
     FROM earnings_schedules
     WHERE announced_dt >= NOW() - INTERVAL '${REPARSE_LOOKBACK_DAYS} days'
     ORDER BY announced_dt DESC`,
  );

  const targets = rows as ReparseRow[];
  let updated = 0;
  let fetchFailed = 0;

  for (const [index, row] of targets.entries()) {
    const text = await fetchDartDocumentText(apiKey, row.rcept_no);
    if (text === null) {
      fetchFailed++;
    } else {
      const reparsed = parseScheduledDateTime(text, row.announced_dt, keywordRegexForKind(row.kind));
      const scheduledDt = reparsed?.date ?? null;
      const scheduledTime = reparsed?.time ?? null;

      if (scheduledDt !== row.scheduled_dt || scheduledTime !== row.scheduled_time) {
        await db.query(
          `UPDATE earnings_schedules SET scheduled_dt = $2, scheduled_time = $3 WHERE rcept_no = $1`,
          [row.rcept_no, scheduledDt, scheduledTime],
        );
        updated++;
        logger.info(
          `예정일 재파싱: ${row.rcept_no} ${row.scheduled_dt ?? '-'} ${row.scheduled_time ?? '--:--'}` +
            ` → ${scheduledDt ?? '-'} ${scheduledTime ?? '--:--'}`,
        );
      }
    }

    onProgress?.(index + 1, targets.length);
    await sleep(SYNC_REQUEST_DELAY_MS);
  }

  const failNote = fetchFailed > 0 ? `, ${fetchFailed}건 원문 조회 실패(기존 값 유지)` : '';
  logger.info(`실적 예정일 재파싱: ${targets.length}건 대상, ${updated}건 갱신${failNote}`);
  return { scanned: targets.length, updated, fetchFailed };
}
