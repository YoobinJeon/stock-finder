import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTickersParam } from './parseTickersParam';

test('정상 2개 티커를 배열로 반환한다', () => {
  // Arrange
  const raw = '005930,000660';

  // Act
  const result = parseTickersParam(raw);

  // Assert
  assert.deepEqual(result, ['005930', '000660']);
});

test('정상 3개 티커를 배열로 반환한다', () => {
  // Arrange
  const raw = '005930,000660,035420';

  // Act
  const result = parseTickersParam(raw);

  // Assert
  assert.deepEqual(result, ['005930', '000660', '035420']);
});

test('공백과 소문자를 정규화한다', () => {
  // Arrange
  const raw = ' 005930 , 000660 ';

  // Act
  const result = parseTickersParam(raw);

  // Assert — 소문자 케이스는 대문자 코드로만 검증하되, 여기선 숫자 코드라 대소문자 영향 없음
  assert.deepEqual(result, ['005930', '000660']);
});

test('영문 소문자 코드를 대문자로 정규화한다', () => {
  // Arrange
  const raw = '00088a,005930';

  // Act
  const result = parseTickersParam(raw);

  // Assert
  assert.deepEqual(result, ['00088A', '005930']);
});

test('신형 영문혼합 코드를 통과시킨다', () => {
  // Arrange
  const raw = '0193T0,005930';

  // Act
  const result = parseTickersParam(raw);

  // Assert
  assert.deepEqual(result, ['0193T0', '005930']);
});

test('중복 제거로 1개만 남으면 null을 반환한다', () => {
  // Arrange
  const raw = '005930,005930';

  // Act
  const result = parseTickersParam(raw);

  // Assert
  assert.equal(result, null);
});

test('정상 4개 티커를 배열로 반환한다', () => {
  // Arrange
  const raw = '005930,000660,035420,051910';

  // Act
  const result = parseTickersParam(raw);

  // Assert
  assert.deepEqual(result, ['005930', '000660', '035420', '051910']);
});

test('5개 이상이면 null을 반환한다', () => {
  // Arrange
  const raw = '005930,000660,035420,051910,005380';

  // Act
  const result = parseTickersParam(raw);

  // Assert
  assert.equal(result, null);
});

test('1개뿐이면 null을 반환한다', () => {
  // Arrange
  const raw = '005930';

  // Act
  const result = parseTickersParam(raw);

  // Assert
  assert.equal(result, null);
});

test('잘못된 문자가 포함되면 null을 반환한다', () => {
  // Arrange
  const raw = '005930,ABC-12';

  // Act
  const result = parseTickersParam(raw);

  // Assert
  assert.equal(result, null);
});

test('문자열이 아니면 null을 반환한다', () => {
  // Arrange & Act & Assert
  assert.equal(parseTickersParam(undefined), null);
  assert.equal(parseTickersParam(null), null);
  assert.equal(parseTickersParam(['005930', '000660']), null);
  assert.equal(parseTickersParam(123456), null);
});
