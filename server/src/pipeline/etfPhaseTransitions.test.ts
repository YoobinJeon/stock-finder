import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcPhaseTransitions, type PhaseRow } from './etfPhaseTransitions';

function row(
  ticker: string,
  snap_date: string,
  state: string,
  name = `${ticker}-name`,
): PhaseRow {
  return { ticker, name, snap_date, state };
}

test('인접한 두 날짜의 state가 다르면 단일 전환 이벤트를 반환한다', () => {
  // Arrange: A티커가 07-09 neutral → 07-10 entered로 전환
  const rows = [
    row('A', '2026-07-09', 'neutral'),
    row('A', '2026-07-10', 'entered'),
  ];

  // Act
  const result = calcPhaseTransitions(rows);

  // Assert
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    ticker: 'A', name: 'A-name', date: '2026-07-10', from: 'neutral', to: 'entered',
  });
});

test('여러 티커의 전환 이벤트를 날짜 내림차순 → 티커 오름차순으로 정렬한다', () => {
  // Arrange: B는 07-11 전환, A는 07-10 전환 — 날짜 내림차순이면 B가 먼저
  // C도 07-11 전환 — 같은 날짜면 티커 오름차순(B, C)
  const rows = [
    row('A', '2026-07-09', 'neutral'),
    row('A', '2026-07-10', 'entered'),
    row('B', '2026-07-10', 'neutral'),
    row('B', '2026-07-11', 'exited'),
    row('C', '2026-07-10', 'aligned'),
    row('C', '2026-07-11', 'neutral'),
  ];

  // Act
  const result = calcPhaseTransitions(rows);

  // Assert
  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((r) => [r.date, r.ticker]),
    [['2026-07-11', 'B'], ['2026-07-11', 'C'], ['2026-07-10', 'A']],
  );
});

test('state가 계속 같으면 전환 이벤트가 없다', () => {
  // Arrange
  const rows = [
    row('A', '2026-07-09', 'aligned'),
    row('A', '2026-07-10', 'aligned'),
    row('A', '2026-07-11', 'aligned'),
  ];

  // Act
  const result = calcPhaseTransitions(rows);

  // Assert
  assert.deepEqual(result, []);
});

test('티커별 스냅샷이 하루뿐이면 빈 배열을 반환한다', () => {
  // Arrange
  const rows = [row('A', '2026-07-10', 'neutral')];

  // Act
  const result = calcPhaseTransitions(rows);

  // Assert
  assert.deepEqual(result, []);
});

test('중간 결측일이 있어도 남아있는 날짜끼리 인접 비교한다', () => {
  // Arrange: 07-10 스냅샷이 누락되어 07-09(neutral)와 07-11(exited)만 존재 —
  // 이 둘을 인접 비교해 전환으로 처리한다
  const rows = [
    row('A', '2026-07-09', 'neutral'),
    row('A', '2026-07-11', 'exited'),
  ];

  // Act
  const result = calcPhaseTransitions(rows);

  // Assert
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    ticker: 'A', name: 'A-name', date: '2026-07-11', from: 'neutral', to: 'exited',
  });
});

test('입력이 빈 배열이면 빈 배열을 반환한다', () => {
  // Arrange
  const rows: PhaseRow[] = [];

  // Act
  const result = calcPhaseTransitions(rows);

  // Assert
  assert.deepEqual(result, []);
});
