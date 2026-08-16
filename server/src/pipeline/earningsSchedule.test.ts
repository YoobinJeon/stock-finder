import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyScheduleSource, parseScheduledDate, parseScheduledDateTime } from './earningsSchedule';

test('기업설명회(IR)개최(안내공시)는 ir로 분류된다', () => {
  // Arrange
  const reportNm = '기업설명회(IR)개최(안내공시)';

  // Act
  const result = classifyScheduleSource(reportNm);

  // Assert
  assert.equal(result, 'ir');
});

test('결산실적공시예고(안내공시)는 earnings로 분류된다', () => {
  // Arrange
  const reportNm = '결산실적공시예고(안내공시)';

  // Act
  const result = classifyScheduleSource(reportNm);

  // Assert
  assert.equal(result, 'earnings');
});

test('영업실적등에대한전망(공정공시)는 earnings로 분류된다', () => {
  // Arrange
  const reportNm = '영업실적등에대한전망(공정공시)';

  // Act
  const result = classifyScheduleSource(reportNm);

  // Assert
  assert.equal(result, 'earnings');
});

test('[기재정정] 프리픽스가 붙으면 원본과 중복이므로 null이다', () => {
  // Arrange
  const reportNm = '[기재정정]기업설명회(IR)개최(안내공시)';

  // Act
  const result = classifyScheduleSource(reportNm);

  // Assert
  assert.equal(result, null);
});

test('실적·IR과 무관한 공시는 null이다', () => {
  // Arrange
  const reportNm = '주식등의대량보유상황보고서';

  // Act
  const result = classifyScheduleSource(reportNm);

  // Assert
  assert.equal(result, null);
});

test('현금ㆍ현물배당결정은 dividend로 분류된다', () => {
  // Arrange
  const reportNm = '현금ㆍ현물배당결정';

  // Act
  const result = classifyScheduleSource(reportNm);

  // Assert
  assert.equal(result, 'dividend');
});

test('주식배당결정도 dividend로 분류된다', () => {
  // Arrange
  const reportNm = '주식배당결정';

  // Act
  const result = classifyScheduleSource(reportNm);

  // Assert
  assert.equal(result, 'dividend');
});

test('[기재정정] 프리픽스가 붙은 배당결정은 원본과 중복이므로 null이다', () => {
  // Arrange
  const reportNm = '[기재정정]현금ㆍ현물배당결정';

  // Act
  const result = classifyScheduleSource(reportNm);

  // Assert
  assert.equal(result, null);
});

test('IR 본문의 "N. 일시 : YYYY년 MM월 DD일" 형태에서 예정일을 파싱한다', () => {
  // Arrange
  const text = '1. 일시 : 2026년 07월 15일 16:00 2. 장소 : 여의도 3. 참석대상 : 기관투자자';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDate(text, announcedDate);

  // Assert
  assert.equal(result, '2026-07-15');
});

test('결산실적공시예고 본문의 "결산실적 공시 예정일" 형태에서 예정일을 파싱한다', () => {
  // Arrange
  const text = '당사는 2026사업연도 결산실적을 아래와 같이 공시할 예정입니다. 결산실적 공시 예정일 : 2026-08-14';
  const announcedDate = '2026-07-20';

  // Act
  const result = parseScheduledDate(text, announcedDate);

  // Assert
  assert.equal(result, '2026-08-14');
});

test('점(.) 구분 날짜 형식(YYYY.MM.DD)도 파싱된다', () => {
  // Arrange
  const text = '개최일 : 2026.9.3 (목) 14:00';
  const announcedDate = '2026-08-01';

  // Act
  const result = parseScheduledDate(text, announcedDate);

  // Assert
  assert.equal(result, '2026-09-03');
});

test('슬래시(/) 구분 날짜 형식(YYYY/MM/DD)도 파싱된다', () => {
  // Arrange
  const text = '발표일 : 2026/10/05';
  const announcedDate = '2026-09-01';

  // Act
  const result = parseScheduledDate(text, announcedDate);

  // Assert
  assert.equal(result, '2026-10-05');
});

test('과거 날짜만 있는 본문은 null이다', () => {
  // Arrange
  const text = '2025년 12월 1일 이사회 결의를 거쳐 본 공시를 제출합니다.';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDate(text, announcedDate);

  // Assert
  assert.equal(result, null);
});

test('날짜가 전혀 없는 본문은 null이다', () => {
  // Arrange
  const text = '자세한 사항은 홈페이지 공지사항을 참고하시기 바랍니다.';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDate(text, announcedDate);

  // Assert
  assert.equal(result, null);
});

test('존재하지 않는 날짜(2월 30일)는 거부하고 다음 유효 날짜를 채택한다', () => {
  // Arrange
  const text = '일시 : 2026년 02월 30일 (오타), 변경된 일시 2026년 03월 02일';
  const announcedDate = '2026-01-01';

  // Act
  const result = parseScheduledDate(text, announcedDate);

  // Assert
  assert.equal(result, '2026-03-02');
});

test('180일을 초과하는 먼 미래 날짜는 거부된다', () => {
  // Arrange
  const text = '일시 : 2027년 06월 01일';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDate(text, announcedDate);

  // Assert
  assert.equal(result, null);
});

test('접수일과 같은 날짜도 유효한 예정일로 채택된다', () => {
  // Arrange
  const text = '일시 : 2026년 07월 01일 14:00';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDate(text, announcedDate);

  // Assert
  assert.equal(result, '2026-07-01');
});

// --- parseScheduledDateTime ---

test('"HH:MM" 형태 시간을 파싱한다', () => {
  // Arrange
  const text = '1. 일시 : 2026년 07월 15일 16:00 2. 장소 : 여의도 3. 참석대상 : 기관투자자';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDateTime(text, announcedDate);

  // Assert
  assert.deepEqual(result, { date: '2026-07-15', time: '16:00' });
});

test('"N시 M분" 형태 시간을 파싱한다', () => {
  // Arrange
  const text = '일시 : 2026년 07월 15일 16시 30분, 장소 : 본사 대회의실';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDateTime(text, announcedDate);

  // Assert
  assert.deepEqual(result, { date: '2026-07-15', time: '16:30' });
});

test('"오후 N시" 형태는 12시간제를 24시간제로 변환한다', () => {
  // Arrange
  const text = '일시 : 2026년 07월 15일 오후 4시, 장소 : 여의도';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDateTime(text, announcedDate);

  // Assert
  assert.deepEqual(result, { date: '2026-07-15', time: '16:00' });
});

test('"오전 N시" 형태도 파싱된다', () => {
  // Arrange
  const text = '일시 : 2026년 07월 15일 오전 9시, 장소 : 여의도';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDateTime(text, announcedDate);

  // Assert
  assert.deepEqual(result, { date: '2026-07-15', time: '09:00' });
});

test('시간이 없으면 date만 반환하고 time은 null이다', () => {
  // Arrange
  const text = '일시 : 2026년 07월 15일, 장소 : 여의도';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDateTime(text, announcedDate);

  // Assert
  assert.deepEqual(result, { date: '2026-07-15', time: null });
});

test('날짜 자체를 못 찾으면 null이다', () => {
  // Arrange
  const text = '자세한 사항은 홈페이지 공지사항을 참고하시기 바랍니다.';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDateTime(text, announcedDate);

  // Assert
  assert.equal(result, null);
});

test('"오후 12시"는 정오(12:00)로 변환된다 — 경계값', () => {
  // Arrange
  const text = '일시 : 2026년 07월 15일 오후 12시, 장소 : 여의도';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDateTime(text, announcedDate);

  // Assert
  assert.deepEqual(result, { date: '2026-07-15', time: '12:00' });
});

test('"오전 12시"는 자정(00:00)으로 변환된다 — 경계값', () => {
  // Arrange
  const text = '일시 : 2026년 07월 15일 오전 12시, 장소 : 여의도';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDateTime(text, announcedDate);

  // Assert
  assert.deepEqual(result, { date: '2026-07-15', time: '00:00' });
});

test('25시처럼 유효 범위를 벗어난 시각은 거부되고 time은 null이다', () => {
  // Arrange
  const text = '일시 : 2026년 07월 15일 25시, 장소 : 여의도';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDateTime(text, announcedDate);

  // Assert
  assert.deepEqual(result, { date: '2026-07-15', time: null });
});

// --- kind별 키워드 정규식 파라미터(배당기준일) ---

const DIVIDEND_KEYWORD_RE = /배당기준일|기준일/g;

test('배당결정 본문의 "배당기준일" 뒤에서 기준일을 파싱한다', () => {
  // Arrange
  const text = '1. 배당구분 : 현금배당 2. 배당기준일 : 2026년 06월 30일 3. 1주당 배당금 : 500원';
  const announcedDate = '2026-05-15';

  // Act
  const result = parseScheduledDate(text, announcedDate, DIVIDEND_KEYWORD_RE);

  // Assert
  assert.equal(result, '2026-06-30');
});

test('"배당기준일" 키워드가 없어도 단순 "기준일"로 폴백해 파싱한다', () => {
  // Arrange
  const text = '1. 기준일 : 2026-06-30 2. 배당금액 : 500원';
  const announcedDate = '2026-05-15';

  // Act
  const result = parseScheduledDate(text, announcedDate, DIVIDEND_KEYWORD_RE);

  // Assert
  assert.equal(result, '2026-06-30');
});

test('배당 본문에 시간이 없으면 date만 반환하고 time은 null이다', () => {
  // Arrange
  const text = '1. 배당구분 : 현금배당 2. 배당기준일 : 2026년 06월 30일';
  const announcedDate = '2026-05-15';

  // Act
  const result = parseScheduledDateTime(text, announcedDate, DIVIDEND_KEYWORD_RE);

  // Assert
  assert.deepEqual(result, { date: '2026-06-30', time: null });
});

test('기본 키워드(KEYWORD_RE)를 쓰는 IR 본문에는 "기준일"이 없어도 영향받지 않는다', () => {
  // Arrange — 인자를 생략하면 기존 KEYWORD_RE 동작을 그대로 유지한다
  const text = '1. 일시 : 2026년 07월 15일 16:00 2. 장소 : 여의도';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDate(text, announcedDate);

  // Assert
  assert.equal(result, '2026-07-15');
});

// --- 시각 오파싱 방어 (2026-08-01: 캘린더에 01:01이 뜨던 버그) ---

test('시각이 "--:--"(미정)이면 뒤쪽 "1:1 미팅"을 시각으로 잡지 않는다', () => {
  // Arrange — 한국항공우주 20260721801052 실제 원문 구조
  const text =
    '1. 일시 및 장소 일시 2026-07-30 --:-- 장소 대면 미팅(서울 여의도 등) 2. 참가 대상자 국내 기관 투자자' +
    ' 3. 개최목적 2026년 2분기 실적 설명 4. 개최방법 1:1 미팅 및 그룹 미팅';
  const announcedDate = '2026-07-21';

  // Act
  const result = parseScheduledDateTime(text, announcedDate);

  // Assert
  assert.deepEqual(result, { date: '2026-07-30', time: null });
});

test('"1:1"처럼 분이 한 자리인 콜론 표기는 시각으로 인정하지 않는다', () => {
  // Arrange — "--:--" 표기가 없어도 비율 표기를 시각으로 오인하면 안 된다
  const text = '1. 일시 : 2026년 07월 15일 장소 서울 2. 개최방법 1:1 미팅';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDateTime(text, announcedDate);

  // Assert
  assert.deepEqual(result, { date: '2026-07-15', time: null });
});

test('콜론을 세미콜론으로 오타낸 "13;30"도 시각으로 인정한다', () => {
  // Arrange — AP시스템 원문에 실재하는 오타. 종료시간(17:30)이 아니라 시작시간을 잡아야 한다
  const text = '1. 일시 2026-07-02 13;30 17:30 2. 장소 한국거래소홍보관';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDateTime(text, announcedDate);

  // Assert
  assert.deepEqual(result, { date: '2026-07-02', time: '13:30' });
});

test('"2시간"처럼 시간(duration) 표현은 시각으로 인정하지 않는다', () => {
  // Arrange
  const text = '1. 일시 : 2026년 07월 15일 장소 서울 소요 2시간';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDateTime(text, announcedDate);

  // Assert
  assert.deepEqual(result, { date: '2026-07-15', time: null });
});

test('"16:00" 표준 표기는 그대로 파싱된다 — 개선 후 회귀 없음', () => {
  // Arrange
  const text = '1. 일시 및 장소 일시 2026-07-15 16:00 장소 - 2. 참가 대상자 국내 기관투자자';
  const announcedDate = '2026-07-01';

  // Act
  const result = parseScheduledDateTime(text, announcedDate);

  // Assert
  assert.deepEqual(result, { date: '2026-07-15', time: '16:00' });
});
