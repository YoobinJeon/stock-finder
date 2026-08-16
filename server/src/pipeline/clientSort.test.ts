import { test } from 'node:test';
import assert from 'node:assert/strict';
// 클라이언트의 순수 유틸을 서버 테스트 러너로 검증한다 — 클라이언트에는 러너가 없고,
// 이 파일은 React·JSX를 쓰지 않는 순수 TS라 그대로 import할 수 있다.
import {
  compareSortValues, sortRows, nextSort, type SortOrder,
} from '../../../client/src/shared/lib/clientSort';

const by = <T, K extends keyof T>(k: K) => (r: T) => r[k] as any;

test('숫자는 방향대로 정렬된다', () => {
  assert.ok(compareSortValues(1, 2, 'asc') < 0);
  assert.ok(compareSortValues(1, 2, 'desc') > 0);
  assert.equal(compareSortValues(3, 3, 'desc'), 0);
});

test('빈 값은 방향과 무관하게 항상 뒤로 간다', () => {
  for (const order of ['asc', 'desc'] as SortOrder[]) {
    assert.ok(compareSortValues(null, 5, order) > 0, `${order}: null이 뒤`);
    assert.ok(compareSortValues(5, null, order) < 0, `${order}: null이 뒤`);
    assert.ok(compareSortValues(undefined, 5, order) > 0, `${order}: undefined가 뒤`);
    assert.ok(compareSortValues('', 'a', order) > 0, `${order}: 빈 문자열이 뒤`);
  }
  assert.equal(compareSortValues(null, undefined, 'desc'), 0);
});

test('0과 음수는 빈 값이 아니다 — 수급 순매도(-)가 뒤로 밀리면 안 된다', () => {
  assert.ok(compareSortValues(0, null, 'desc') < 0);
  assert.ok(compareSortValues(-100, null, 'asc') < 0);
  assert.ok(compareSortValues(-100, 0, 'desc') > 0);
});

test('문자열은 한글 로케일로 비교한다', () => {
  const rows = [{ n: '반도체' }, { n: '가전' }, { n: '제약' }];
  assert.deepEqual(sortRows(rows, by('n'), 'asc').map((r) => r.n), ['가전', '반도체', '제약']);
  assert.deepEqual(sortRows(rows, by('n'), 'desc').map((r) => r.n), ['제약', '반도체', '가전']);
});

test('원본 배열을 건드리지 않는다', () => {
  const rows = [{ v: 1 }, { v: 3 }, { v: 2 }];
  const sorted = sortRows(rows, by('v'), 'desc');
  assert.deepEqual(rows.map((r) => r.v), [1, 3, 2], '원본 유지');
  assert.deepEqual(sorted.map((r) => r.v), [3, 2, 1]);
});

test('동점은 원래 순서를 유지한다 — 폴링마다 행이 튀면 안 된다', () => {
  const rows = [
    { id: 'a', v: 5 }, { id: 'b', v: 5 }, { id: 'c', v: 9 }, { id: 'd', v: 5 },
  ];
  assert.deepEqual(sortRows(rows, by('v'), 'desc').map((r) => r.id), ['c', 'a', 'b', 'd']);
});

test('빈 값 행끼리도 원래 순서를 유지한다', () => {
  const rows = [{ id: 'a', v: null }, { id: 'b', v: 1 }, { id: 'c', v: null }];
  assert.deepEqual(sortRows(rows, by('v'), 'desc').map((r) => r.id), ['b', 'a', 'c']);
});

test('빈 배열도 안전하다', () => {
  assert.deepEqual(sortRows([] as { v: number }[], by('v'), 'desc'), []);
});

test('다른 칸을 누르면 내림차순부터, 같은 칸이면 방향만 뒤집는다', () => {
  assert.deepEqual(nextSort({ key: 'a', order: 'desc' }, 'b'), { key: 'b', order: 'desc' });
  assert.deepEqual(nextSort({ key: 'a', order: 'desc' }, 'a'), { key: 'a', order: 'asc' });
  assert.deepEqual(nextSort({ key: 'a', order: 'asc' }, 'a'), { key: 'a', order: 'desc' });
});
