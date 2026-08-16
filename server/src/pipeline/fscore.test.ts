import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcFscore, FinYear } from './fscore';

const y = (o: Partial<FinYear>): FinYear => ({
  netIncome: null, roe: null, debtRatio: null, revenueGrowth: null, ...o,
});

test('5개 전부 충족이면 score 5, max 5', () => {
  const out = calcFscore([
    y({ netIncome: 100, roe: 0.15, debtRatio: 0.3, revenueGrowth: 0.2 }),
    y({ roe: 0.10, debtRatio: 0.5 }),
  ]);
  assert.equal(out.score, 5);
  assert.equal(out.max, 5);
});

test('전부 불충족이면 score 0, max 5', () => {
  const out = calcFscore([
    y({ netIncome: -100, roe: -0.05, debtRatio: 0.6, revenueGrowth: -0.1 }),
    y({ roe: 0.10, debtRatio: 0.3 }),
  ]);
  assert.equal(out.score, 0);
  assert.equal(out.max, 5);
});

test('전년 없으면 전년대비 기준 2개 제외 → max 3 (기준 1·2·5만)', () => {
  const out = calcFscore([
    y({ netIncome: 100, roe: 0.15, debtRatio: 0.3, revenueGrowth: 0.2 }),
  ]);
  assert.equal(out.max, 3);
  assert.equal(out.score, 3);
  assert.deepEqual(out.criteria.map((c) => c.name), ['순이익 흑자', 'ROE 양수', '매출 성장']);
});

test('null 필드는 해당 기준 자체를 제외한다', () => {
  const out = calcFscore([
    y({ netIncome: 100 }), // roe·debtRatio·revenueGrowth null
  ]);
  assert.equal(out.max, 1);
  assert.equal(out.score, 1);
});

test('빈 배열이면 score 0, max 0', () => {
  const out = calcFscore([]);
  assert.equal(out.score, 0);
  assert.equal(out.max, 0);
  assert.deepEqual(out.criteria, []);
});
