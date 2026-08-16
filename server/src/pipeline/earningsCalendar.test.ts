import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyEarningsEvent,
  parseMonthParam,
  buildCalendarEvents,
  buildListingEvents,
  type CalendarDisclosureInput,
  type CalendarScheduleInput,
  type CalendarListingInput,
} from './earningsCalendar';

test('연결재무제표기준 영업(잠정)실적(공정공시)는 provisional로 분류된다', () => {
  // Arrange
  const reportNm = '연결재무제표기준영업(잠정)실적(공정공시)';

  // Act
  const result = classifyEarningsEvent(reportNm);

  // Assert
  assert.equal(result, 'provisional');
});

test('[기재정정] 프리픽스가 붙어도 provisional로 분류된다', () => {
  // Arrange
  const reportNm = '[기재정정]연결재무제표기준영업(잠정)실적(공정공시)';

  // Act
  const result = classifyEarningsEvent(reportNm);

  // Assert
  assert.equal(result, 'provisional');
});

test('매출액또는손익구조 변동 공시는 provisional로 분류된다', () => {
  // Arrange
  const reportNm = '매출액또는손익구조30%(대규모법인은15%)이상변동';

  // Act
  const result = classifyEarningsEvent(reportNm);

  // Assert
  assert.equal(result, 'provisional');
});

test('괄호 없는 영업잠정실적 표기도 provisional로 분류된다', () => {
  // Arrange
  const reportNm = '영업잠정실적등에대한전망공시';

  // Act
  const result = classifyEarningsEvent(reportNm);

  // Assert
  assert.equal(result, 'provisional');
});

test('기업설명회(IR)개최 공시는 ir로 분류된다', () => {
  // Arrange
  const reportNm = '기업설명회(IR)개최(안내공시)';

  // Act
  const result = classifyEarningsEvent(reportNm);

  // Assert
  assert.equal(result, 'ir');
});

test('IR개최 표기(공백 포함)도 ir로 분류된다', () => {
  // Arrange
  const reportNm = 'IR 개최 안내';

  // Act
  const result = classifyEarningsEvent(reportNm);

  // Assert
  assert.equal(result, 'ir');
});

test('사업보고서는 periodic으로 분류된다', () => {
  // Arrange
  const reportNm = '사업보고서 (2025.12)';

  // Act
  const result = classifyEarningsEvent(reportNm);

  // Assert
  assert.equal(result, 'periodic');
});

test('[기재정정] 프리픽스가 붙은 분기보고서도 periodic으로 분류된다', () => {
  // Arrange
  const reportNm = '[기재정정]분기보고서 (2026.03)';

  // Act
  const result = classifyEarningsEvent(reportNm);

  // Assert
  assert.equal(result, 'periodic');
});

test('반기보고서는 periodic으로 분류된다', () => {
  // Arrange
  const reportNm = '반기보고서 (2026.06)';

  // Act
  const result = classifyEarningsEvent(reportNm);

  // Assert
  assert.equal(result, 'periodic');
});

test('잠정실적과 정기보고서 키워드가 동시에 있으면 provisional이 우선한다', () => {
  // Arrange
  const reportNm = '연결재무제표기준영업(잠정)실적(공정공시) 및 사업보고서 첨부';

  // Act
  const result = classifyEarningsEvent(reportNm);

  // Assert
  assert.equal(result, 'provisional');
});

test('주요사항보고서는 정기보고서 정규식에 매칭되지 않아 null이다', () => {
  // Arrange
  const reportNm = '주요사항보고서(유상증자결정)';

  // Act
  const result = classifyEarningsEvent(reportNm);

  // Assert
  assert.equal(result, null);
});

test('실적·IR과 무관한 공시는 null이다', () => {
  // Arrange
  const reportNm = '주식등의대량보유상황보고서';

  // Act
  const result = classifyEarningsEvent(reportNm);

  // Assert
  assert.equal(result, null);
});

test('정상적인 YYYY-MM은 월초·다음달 1일 범위로 변환된다', () => {
  // Arrange
  const raw = '2026-07';

  // Act
  const result = parseMonthParam(raw);

  // Assert
  assert.deepEqual(result, { month: '2026-07', start: '2026-07-01', end: '2026-08-01' });
});

test('12월은 다음 해 1월 1일로 롤오버된다', () => {
  // Arrange
  const raw = '2026-12';

  // Act
  const result = parseMonthParam(raw);

  // Assert
  assert.deepEqual(result, { month: '2026-12', start: '2026-12-01', end: '2027-01-01' });
});

test('형식이 어긋난 문자열은 null이다', () => {
  // Arrange
  const raw = '2026/07';

  // Act
  const result = parseMonthParam(raw);

  // Assert
  assert.equal(result, null);
});

test('문자열이 아닌 입력은 null이다', () => {
  // Arrange & Act
  const result = parseMonthParam(undefined);

  // Assert
  assert.equal(result, null);
});

test('연도 범위(2020~2100)를 벗어나면 null이다', () => {
  // Arrange
  const raw = '2019-12';

  // Act
  const result = parseMonthParam(raw);

  // Assert
  assert.equal(result, null);
});

// --- buildCalendarEvents ---

const MONTH_START = '2026-07-01';
const MONTH_END = '2026-08-01';

function makeDisclosure(overrides: Partial<CalendarDisclosureInput> = {}): CalendarDisclosureInput {
  return {
    rcept_no: '20260701000001',
    date: '2026-07-01',
    report_nm: '기업설명회(IR)개최(안내공시)',
    ticker: '005930',
    name: '삼성전자',
    market: 'KOSPI',
    sector: '전기전자',
    watched: false,
    ...overrides,
  };
}

function makeSchedule(overrides: Partial<CalendarScheduleInput> = {}): CalendarScheduleInput {
  return {
    rcept_no: '20260701000001',
    announced_dt: '2026-07-01',
    scheduled_dt: '2026-07-30',
    scheduled_time: null,
    kind: 'ir',
    report_nm: '기업설명회(IR)개최(안내공시)',
    ticker: '005930',
    name: '삼성전자',
    market: 'KOSPI',
    sector: '전기전자',
    watched: false,
    ...overrides,
  };
}

test('IR 개최일 파싱 성공 시 접수일 이벤트는 사라지고 개최일 이벤트만 남는다', () => {
  // Arrange
  const disclosures = [makeDisclosure({ date: '2026-07-01' })];
  const schedules = [makeSchedule({ announced_dt: '2026-07-01', scheduled_dt: '2026-07-30' })];

  // Act
  const result = buildCalendarEvents(disclosures, schedules, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-07-30');
  assert.equal(result[0].category, 'ir');
  assert.equal(result[0].source_date, '2026-07-01');
});

test('scheduled_time이 있으면 이벤트의 time 필드로 그대로 전달된다', () => {
  // Arrange
  const disclosures = [makeDisclosure({ date: '2026-07-01' })];
  const schedules = [
    makeSchedule({ announced_dt: '2026-07-01', scheduled_dt: '2026-07-30', scheduled_time: '16:00' }),
  ];

  // Act
  const result = buildCalendarEvents(disclosures, schedules, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 1);
  assert.equal(result[0].time, '16:00');
});

test('scheduled_time이 없으면 이벤트의 time은 null이다', () => {
  // Arrange
  const disclosures = [makeDisclosure({ date: '2026-07-01' })];
  const schedules = [
    makeSchedule({ announced_dt: '2026-07-01', scheduled_dt: '2026-07-30', scheduled_time: null }),
  ];

  // Act
  const result = buildCalendarEvents(disclosures, schedules, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 1);
  assert.equal(result[0].time, null);
});

test('접수일 표시로 폴백된 이벤트(disclosures 유래)는 time이 항상 null이다', () => {
  // Arrange
  const disclosures = [
    makeDisclosure({
      rcept_no: '20260706000006',
      date: '2026-07-06',
      report_nm: '연결재무제표기준영업(잠정)실적(공정공시)',
    }),
  ];
  const schedules: CalendarScheduleInput[] = [];

  // Act
  const result = buildCalendarEvents(disclosures, schedules, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 1);
  assert.equal(result[0].time, null);
});

test('IR 개최일 파싱 실패(scheduled_dt NULL)는 접수일 이벤트를 유지한다', () => {
  // Arrange
  const disclosures = [makeDisclosure({ date: '2026-07-05' })];
  const schedules = [makeSchedule({ announced_dt: '2026-07-05', scheduled_dt: null })];

  // Act
  const result = buildCalendarEvents(disclosures, schedules, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-07-05');
  assert.equal(result[0].category, 'ir');
  assert.equal(result[0].source_date, null);
});

test('접수일과 개최일이 같으면 이벤트가 하나로 단일화되고 source_date는 null이다', () => {
  // Arrange
  const disclosures = [makeDisclosure({ date: '2026-07-10' })];
  const schedules = [makeSchedule({ announced_dt: '2026-07-10', scheduled_dt: '2026-07-10' })];

  // Act
  const result = buildCalendarEvents(disclosures, schedules, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-07-10');
  assert.equal(result[0].source_date, null);
});

test('지난달 접수·이번달 개최인 IR은 이번달 화면에 개최일로 표시된다', () => {
  // Arrange — disclosures는 이번달 접수분만 조회되므로 지난달 접수 건은 포함되지 않는다
  const disclosures: CalendarDisclosureInput[] = [];
  const schedules = [makeSchedule({ announced_dt: '2026-06-28', scheduled_dt: '2026-07-05' })];

  // Act
  const result = buildCalendarEvents(disclosures, schedules, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-07-05');
  assert.equal(result[0].source_date, '2026-06-28');
});

test('이번달 접수·다음달 개최인 IR은 이번달 화면에서 완전히 제거된다', () => {
  // Arrange
  const disclosures = [makeDisclosure({ date: '2026-07-28' })];
  const schedules = [makeSchedule({ announced_dt: '2026-07-28', scheduled_dt: '2026-08-05' })];

  // Act
  const result = buildCalendarEvents(disclosures, schedules, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 0);
});

test('실적공시예고(kind=earnings)는 예정일 파싱 성공 시 발표 예정일에 scheduled로 표시된다', () => {
  // Arrange
  const disclosures: CalendarDisclosureInput[] = [];
  const schedules = [
    makeSchedule({
      rcept_no: '20260702000002',
      announced_dt: '2026-07-02',
      scheduled_dt: '2026-07-25',
      kind: 'earnings',
      report_nm: '결산실적공시예고(안내공시)',
    }),
  ];

  // Act
  const result = buildCalendarEvents(disclosures, schedules, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-07-25');
  assert.equal(result[0].category, 'scheduled');
  assert.equal(result[0].source_date, '2026-07-02');
});

test('실적공시예고 예정일 파싱 실패는 표시하지 않는다', () => {
  // Arrange
  const disclosures: CalendarDisclosureInput[] = [];
  const schedules = [
    makeSchedule({
      rcept_no: '20260702000002',
      announced_dt: '2026-07-02',
      scheduled_dt: null,
      kind: 'earnings',
      report_nm: '결산실적공시예고(안내공시)',
    }),
  ];

  // Act
  const result = buildCalendarEvents(disclosures, schedules, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 0);
});

test('잠정실적 공시는 schedules와 무관하게 접수일에 그대로 표시된다', () => {
  // Arrange
  const disclosures = [
    makeDisclosure({
      rcept_no: '20260703000003',
      date: '2026-07-03',
      report_nm: '연결재무제표기준영업(잠정)실적(공정공시)',
    }),
  ];
  const schedules: CalendarScheduleInput[] = [];

  // Act
  const result = buildCalendarEvents(disclosures, schedules, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-07-03');
  assert.equal(result[0].category, 'provisional');
  assert.equal(result[0].source_date, null);
});

test('정기보고서 공시는 schedules와 무관하게 접수일에 그대로 표시된다', () => {
  // Arrange
  const disclosures = [
    makeDisclosure({
      rcept_no: '20260704000004',
      date: '2026-07-04',
      report_nm: '분기보고서 (2026.06)',
    }),
  ];
  const schedules: CalendarScheduleInput[] = [];

  // Act
  const result = buildCalendarEvents(disclosures, schedules, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-07-04');
  assert.equal(result[0].category, 'periodic');
  assert.equal(result[0].source_date, null);
});

test('실적·IR과 무관한 공시는 disclosures에서 제외된다', () => {
  // Arrange
  const disclosures = [
    makeDisclosure({ rcept_no: '20260705000005', date: '2026-07-05', report_nm: '주식등의대량보유상황보고서' }),
  ];
  const schedules: CalendarScheduleInput[] = [];

  // Act
  const result = buildCalendarEvents(disclosures, schedules, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 0);
});

test('배당결정(kind=dividend)은 기준일 파싱 성공 시 dividend 카테고리로 표시된다', () => {
  // Arrange
  const disclosures: CalendarDisclosureInput[] = [];
  const schedules = [
    makeSchedule({
      rcept_no: '20260707000007',
      announced_dt: '2026-07-07',
      scheduled_dt: '2026-07-31',
      kind: 'dividend',
      report_nm: '현금ㆍ현물배당결정',
    }),
  ];

  // Act
  const result = buildCalendarEvents(disclosures, schedules, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-07-31');
  assert.equal(result[0].category, 'dividend');
  assert.equal(result[0].source_date, '2026-07-07');
});

test('배당결정 기준일 파싱 실패는 표시하지 않는다', () => {
  // Arrange
  const disclosures: CalendarDisclosureInput[] = [];
  const schedules = [
    makeSchedule({
      rcept_no: '20260707000007',
      announced_dt: '2026-07-07',
      scheduled_dt: null,
      kind: 'dividend',
      report_nm: '현금ㆍ현물배당결정',
    }),
  ];

  // Act
  const result = buildCalendarEvents(disclosures, schedules, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 0);
});

// --- buildListingEvents ---

function makeListing(overrides: Partial<CalendarListingInput> = {}): CalendarListingInput {
  return {
    ticker: '900001',
    name: '신규상장사',
    market: 'KOSDAQ',
    sector: 'IT서비스',
    watched: false,
    listed_at: '2026-07-15',
    ...overrides,
  };
}

test('상장일이 월 범위 내이면 listing 이벤트로 변환된다', () => {
  // Arrange
  const rows = [makeListing({ listed_at: '2026-07-15' })];

  // Act
  const result = buildListingEvents(rows, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-07-15');
  assert.equal(result[0].category, 'listing');
  assert.equal(result[0].rcept_no, 'listing-900001');
  assert.equal(result[0].report_nm, '신규상장');
  assert.equal(result[0].url, null);
  assert.equal(result[0].time, null);
  assert.equal(result[0].source_date, null);
});

test('상장일이 월 범위 밖이면 제외된다', () => {
  // Arrange
  const rows = [makeListing({ listed_at: '2026-08-01' })];

  // Act
  const result = buildListingEvents(rows, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result.length, 0);
});

test('관심종목 여부가 그대로 전달된다', () => {
  // Arrange
  const rows = [makeListing({ watched: true })];

  // Act
  const result = buildListingEvents(rows, MONTH_START, MONTH_END);

  // Assert
  assert.equal(result[0].watched, true);
});
