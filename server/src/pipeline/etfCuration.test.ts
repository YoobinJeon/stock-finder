import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBoardList, parseBoardConfig, type EtfBoardConfig } from './etfCuration';

const DEFAULTS = [
  { ticker: '069500', group: '시장' },
  { ticker: '229200', group: '시장' },
  { ticker: '132030', group: '해외·원자재' },
];

function config(overrides: Partial<EtfBoardConfig> = {}): EtfBoardConfig {
  return { added: [], removed: [], ...overrides };
}

test('mergeBoardList: 빈 구성이면 기본 목록을 그대로 반환한다', () => {
  // Arrange & Act
  const result = mergeBoardList(DEFAULTS, config());

  // Assert
  assert.deepEqual(result, DEFAULTS);
});

test('mergeBoardList: removed에 포함된 기본 종목은 제외한다', () => {
  // Arrange
  const cfg = config({ removed: ['132030'] });

  // Act
  const result = mergeBoardList(DEFAULTS, cfg);

  // Assert
  assert.deepEqual(result, [
    { ticker: '069500', group: '시장' },
    { ticker: '229200', group: '시장' },
  ]);
});

test('mergeBoardList: added 종목은 기본 목록 뒤에 순서대로 추가된다', () => {
  // Arrange
  const cfg = config({ added: [{ ticker: '466400', group: '테마' }] });

  // Act
  const result = mergeBoardList(DEFAULTS, cfg);

  // Assert
  assert.deepEqual(result, [...DEFAULTS, { ticker: '466400', group: '테마' }]);
});

test('mergeBoardList: 기본 목록에 이미 있는 티커를 added로도 지정하면 added 정의가 우선한다', () => {
  // Arrange: 069500은 기본 '시장'이지만 사용자가 '커스텀' 그룹으로 재정의
  const cfg = config({ added: [{ ticker: '069500', group: '커스텀' }] });

  // Act
  const result = mergeBoardList(DEFAULTS, cfg);

  // Assert: 기본 목록의 069500(시장)은 사라지고 added의 069500(커스텀)만 남음, 순서는 뒤로
  assert.deepEqual(result, [
    { ticker: '229200', group: '시장' },
    { ticker: '132030', group: '해외·원자재' },
    { ticker: '069500', group: '커스텀' },
  ]);
});

test('mergeBoardList: 같은 티커가 removed와 added 모두에 있으면 added가 우선한다', () => {
  // Arrange
  const cfg = config({
    removed: ['069500'],
    added: [{ ticker: '069500', group: '커스텀' }],
  });

  // Act
  const result = mergeBoardList(DEFAULTS, cfg);

  // Assert
  assert.deepEqual(result, [
    { ticker: '229200', group: '시장' },
    { ticker: '132030', group: '해외·원자재' },
    { ticker: '069500', group: '커스텀' },
  ]);
});

test('mergeBoardList: 빈 기본 목록 + added만 있어도 정상 동작한다', () => {
  // Arrange
  const cfg = config({ added: [{ ticker: '466400', group: '테마' }] });

  // Act
  const result = mergeBoardList([], cfg);

  // Assert
  assert.deepEqual(result, [{ ticker: '466400', group: '테마' }]);
});

test('parseBoardConfig: 유효한 구성을 그대로 파싱한다', () => {
  // Arrange
  const body = { added: [{ ticker: '466400', group: '테마' }], removed: ['132030'] };

  // Act
  const result = parseBoardConfig(body);

  // Assert
  assert.deepEqual(result, body);
});

test('parseBoardConfig: added/removed가 빈 배열이어도 유효하다 (기본값 복원 케이스)', () => {
  // Arrange & Act
  const result = parseBoardConfig({ added: [], removed: [] });

  // Assert
  assert.deepEqual(result, { added: [], removed: [] });
});

test('parseBoardConfig: added가 30개를 초과하면 null', () => {
  // Arrange
  const added = Array.from({ length: 31 }, (_, i) => ({
    ticker: String(100000 + i).padStart(6, '0'),
    group: '테마',
  }));

  // Act
  const result = parseBoardConfig({ added, removed: [] });

  // Assert
  assert.equal(result, null);
});

test('parseBoardConfig: added가 정확히 30개면 유효하다', () => {
  // Arrange
  const added = Array.from({ length: 30 }, (_, i) => ({
    ticker: String(100000 + i).padStart(6, '0'),
    group: '테마',
  }));

  // Act
  const result = parseBoardConfig({ added, removed: [] });

  // Assert
  assert.notEqual(result, null);
  assert.equal(result?.added.length, 30);
});

test('parseBoardConfig: ticker가 6자리가 아니면 null', () => {
  // Arrange & Act
  const result = parseBoardConfig({ added: [{ ticker: '12345', group: '테마' }], removed: [] });

  // Assert
  assert.equal(result, null);
});

test('parseBoardConfig: ticker에 소문자가 섞이면 null (영문 대문자·숫자만 허용)', () => {
  // Arrange & Act
  const result = parseBoardConfig({ added: [{ ticker: '46640a', group: '테마' }], removed: [] });

  // Assert
  assert.equal(result, null);
});

test('parseBoardConfig: group이 빈 문자열이면 null', () => {
  // Arrange & Act
  const result = parseBoardConfig({ added: [{ ticker: '466400', group: '' }], removed: [] });

  // Assert
  assert.equal(result, null);
});

test('parseBoardConfig: group이 20자를 초과하면 null', () => {
  // Arrange
  const group = 'a'.repeat(21);

  // Act
  const result = parseBoardConfig({ added: [{ ticker: '466400', group }], removed: [] });

  // Assert
  assert.equal(result, null);
});

test('parseBoardConfig: group이 정확히 20자면 유효하다', () => {
  // Arrange
  const group = 'a'.repeat(20);

  // Act
  const result = parseBoardConfig({ added: [{ ticker: '466400', group }], removed: [] });

  // Assert
  assert.notEqual(result, null);
});

test('parseBoardConfig: removed에 형식이 틀린 티커가 있으면 null', () => {
  // Arrange & Act
  const result = parseBoardConfig({ added: [], removed: ['abc'] });

  // Assert
  assert.equal(result, null);
});

test('parseBoardConfig: added/removed가 배열이 아니면 null', () => {
  // Arrange & Act
  const result1 = parseBoardConfig({ added: 'not-array', removed: [] });
  const result2 = parseBoardConfig({ added: [], removed: 'not-array' });

  // Assert
  assert.equal(result1, null);
  assert.equal(result2, null);
});

test('parseBoardConfig: body가 null이거나 객체가 아니면 null', () => {
  // Arrange & Act & Assert
  assert.equal(parseBoardConfig(null), null);
  assert.equal(parseBoardConfig(undefined), null);
  assert.equal(parseBoardConfig('string'), null);
  assert.equal(parseBoardConfig(42), null);
});

test('parseBoardConfig: added 항목에 ticker/group 필드가 없으면 null', () => {
  // Arrange & Act
  const result = parseBoardConfig({ added: [{}], removed: [] });

  // Assert
  assert.equal(result, null);
});
