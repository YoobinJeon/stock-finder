import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketTradeDates, formatWeekLabel, weeklyChange } from './turnover';

function dates(n: number, startIdx = 0): string[] {
  // 2026-01-01부터 startIdx만큼 건너뛴 뒤 n개의 연속 날짜(영업일 개념 없이 순수 순번)를 생성.
  // 블록 로직은 날짜의 달력 의미가 아니라 정렬 순서만 사용하므로 문자열 순서만 보장하면 된다.
  return Array.from({ length: n }, (_, i) => {
    const idx = startIdx + i;
    return `2026-${String(1 + Math.floor(idx / 28)).padStart(2, '0')}-${String((idx % 28) + 1).padStart(2, '0')}`;
  });
}

test('블록 경계 — 정확히 5의 배수인 거래일은 완성 블록만 생성한다', () => {
  // Arrange: 10개 날짜 → 완성 블록 2개
  const input = dates(10);

  // Act
  const blocks = bucketTradeDates(input);

  // Assert
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].length, 5); // 최신 블록
  assert.equal(blocks[1].length, 5); // 직전 블록
  // 최신 블록(0번째)이 더 나중 날짜들을 담고 있어야 한다
  assert.ok(blocks[0][0] > blocks[1][blocks[1].length - 1]);
});

test('블록 경계 — 5로 나누어떨어지지 않으면 최신 블록이 미완성(5일 미만)이다', () => {
  // Arrange: 12개 날짜 → 5,5,2로 잘리고 마지막 2개짜리가 최신 블록
  const input = dates(12);

  // Act
  const blocks = bucketTradeDates(input);

  // Assert
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].length, 2); // 최신(미완성) 블록
  assert.equal(blocks[1].length, 5);
  assert.equal(blocks[2].length, 5);
});

test('최대 8개 블록만 유지하고 더 오래된 블록은 잘라낸다', () => {
  // Arrange: 45개 날짜 → 9개 블록 생성 가능하지만 최신 8개만 남아야 함
  const input = dates(45);

  // Act
  const blocks = bucketTradeDates(input);

  // Assert
  assert.equal(blocks.length, 8);
  // 잘려나간 가장 오래된 블록(원래 1번째 5개)의 날짜가 결과에 없어야 한다
  const oldestKept = blocks[blocks.length - 1][0];
  assert.equal(oldestKept, dates(45)[5]); // 두 번째 청크의 시작 = 잘리지 않고 남은 것 중 가장 오래된 값
});

test('데이터 부족(10일 미만)이면 완성 블록이 1개 이하일 수 있다', () => {
  // Arrange: 8개 날짜 → 완성 블록 1개(5) + 미완성 블록 1개(3)
  const input = dates(8);

  // Act
  const blocks = bucketTradeDates(input);

  // Assert
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].length, 3); // 최신 미완성
  assert.equal(blocks[1].length, 5); // 유일한 완성 블록
});

test('빈 배열이면 빈 블록 목록을 반환한다', () => {
  assert.deepEqual(bucketTradeDates([]), []);
});

test('중복 날짜는 한 번만 센다', () => {
  const input = [...dates(5), ...dates(5)]; // 동일 5개 날짜가 두 번
  const blocks = bucketTradeDates(input);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].length, 5);
});

test('formatWeekLabel — 여러 날짜면 시작~끝 MM-DD 라벨을 만든다', () => {
  const label = formatWeekLabel(['2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11']);
  assert.equal(label, '07-07~07-11');
});

test('formatWeekLabel — 날짜가 하나뿐이면 단일 MM-DD만 표시한다', () => {
  assert.equal(formatWeekLabel(['2026-07-11']), '07-11');
});

test('formatWeekLabel — 빈 블록이면 빈 문자열', () => {
  assert.equal(formatWeekLabel([]), '');
});

test('weeklyChange — 직전 완성 블록 대비 최신 완성 블록 증감률(%)을 계산한다', () => {
  // Arrange: 100 → 120 (+20%)
  const series = [80, 100, 120];

  // Act
  const change = weeklyChange(series);

  // Assert
  assert.ok(change != null && Math.abs(change - 20) < 1e-9);
});

test('weeklyChange — 감소도 음수로 정확히 계산한다', () => {
  const series = [200, 100];
  const change = weeklyChange(series);
  assert.ok(change != null && Math.abs(change - -50) < 1e-9);
});

test('weeklyChange — 값이 2개 미만이면 null', () => {
  assert.equal(weeklyChange([]), null);
  assert.equal(weeklyChange([100]), null);
});

test('weeklyChange — 직전 값이 0이면 0으로 나누기를 피해 null을 반환한다', () => {
  assert.equal(weeklyChange([0, 100]), null);
});

test('미완성 최신 블록은 weeklyChange 계산에서 호출부가 제외해야 한다(참고용 표시만)', () => {
  // Arrange: 완성 블록 [100, 120] + 미완성 최신 블록 값 50(아직 집계 중)
  const fullSeries = [100, 120, 50];

  // Act: 호출부가 미완성 블록을 슬라이스로 제외하고 넘긴다
  const change = weeklyChange(fullSeries.slice(0, -1));

  // Assert: 50이 아니라 100→120 기준으로 계산되어야 한다
  assert.ok(change != null && Math.abs(change - 20) < 1e-9);
});
