import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGroups, parseAxis, DEFAULT_AXIS } from './groupAxis';

const source = {
  members: new Map<number, string[]>([
    [1, ['000100', '000200', '999999']], // 999999는 상장폐지(활성 목록에 없음)
    [2, ['000200']],
    [3, ['999999']],
  ]),
  themeNames: new Map<number, string>([[1, '반도체'], [2, '2차전지']]),
  stocks: new Map<string, { sector: string | null }>([
    ['000100', { sector: '반도체와반도체장비' }],
    ['000200', { sector: '반도체와반도체장비' }],
    ['000300', { sector: '전기제품' }],
    ['000400', { sector: null }],
  ]),
};

test('축 파싱 — 아는 값만 통과시킨다', () => {
  assert.equal(parseAxis('theme'), 'theme');
  assert.equal(parseAxis('sector'), 'sector');
  assert.equal(parseAxis('themes'), null);
  assert.equal(parseAxis(undefined), null, '없으면 호출측이 기본값을 고르게 null을 준다');
  assert.equal(DEFAULT_AXIS, 'theme');
});

test('테마 축 — 상장폐지 멤버는 빼고 센다', () => {
  const groups = buildGroups('theme', source);
  assert.deepEqual(groups.get('1')?.tickers, ['000100', '000200']);
  assert.equal(groups.get('1')?.name, '반도체');
});

test('테마 축 — 활성 멤버가 하나도 없는 테마는 행을 만들지 않는다', () => {
  const groups = buildGroups('theme', source);
  assert.equal(groups.has('3'), false, '상장폐지만 남은 테마는 빈 행이 될 뿐이다');
  assert.equal(groups.has('2'), true, '1종목짜리는 남긴다 — 칸을 비울지는 집계가 판단한다');
});

test('산업 축 — 같은 산업 종목이 한 행으로 모인다', () => {
  const groups = buildGroups('sector', source);
  assert.deepEqual(groups.get('반도체와반도체장비')?.tickers, ['000100', '000200']);
  assert.equal(groups.get('반도체와반도체장비')?.name, '반도체와반도체장비');
  assert.equal(groups.get('전기제품')?.tickers.length, 1);
});

test('산업 축 — 분류 없는 종목은 미분류 행으로 묶지 않고 뺀다', () => {
  const groups = buildGroups('sector', source);
  assert.equal(groups.size, 2);
  for (const g of groups.values()) {
    assert.equal(g.tickers.includes('000400'), false);
  }
});

test('산업 축은 겹치지 않는다 — 한 종목은 한 행에만 들어간다', () => {
  const groups = buildGroups('sector', source);
  const seen = new Set<string>();
  for (const g of groups.values()) {
    for (const t of g.tickers) {
      assert.equal(seen.has(t), false, `${t}가 두 산업에 들어갔다`);
      seen.add(t);
    }
  }
});

test('묶음 목록은 원본 멤버 배열을 건드리지 않는다', () => {
  buildGroups('theme', source);
  assert.deepEqual(source.members.get(1), ['000100', '000200', '999999']);
});
