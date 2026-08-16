import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlayFlowsQuotes, collectFlowsTickers, FlowGroup } from './flowsOverlay';
import type { Quote } from './shared';

interface Row {
  ticker: string;
  estAvgPrice: number | null;
  currentPrice: number | null;
  returnPct: number | null;
  name: string; // 제네릭 통과 필드 확인용
}

const row = (over: Partial<Row> = {}): Row => ({
  ticker: '005930',
  estAvgPrice: 70000,
  currentPrice: 71000,
  returnPct: 1.4,
  name: '삼성전자',
  ...over,
});

const quote = (over: Partial<Quote> = {}): Quote => ({
  price: 75000,
  change: 1000,
  changePct: 1.35,
  up: true,
  ...over,
});

const groupOf = (buy: Row[], sell: Row[] = []): FlowGroup<Row> => ({ key: 'foreign', label: '외국인', buy, sell });

test('시세가 있으면 currentPrice·returnPct가 교체된다', () => {
  const groups = [groupOf([row({ ticker: '005930', estAvgPrice: 70000 })])];
  const quotes = new Map([['005930', quote({ price: 77000 })]]);

  const out = overlayFlowsQuotes(groups, quotes);

  assert.equal(out[0].buy[0].currentPrice, 77000);
  assert.equal(out[0].buy[0].returnPct, ((77000 - 70000) / 70000) * 100);
  assert.equal(out[0].buy[0].name, '삼성전자'); // 제네릭 필드는 그대로 통과
});

test('시세가 없는 종목은 원본 그대로(같은 참조)', () => {
  const original = row({ ticker: '000660' });
  const groups = [groupOf([original])];
  const quotes = new Map<string, Quote>(); // 빈 시세맵

  const out = overlayFlowsQuotes(groups, quotes);

  assert.equal(out[0].buy[0], original); // 참조 동일
});

test('estAvgPrice가 null이면 returnPct도 null', () => {
  const groups = [groupOf([row({ ticker: '005930', estAvgPrice: null })])];
  const quotes = new Map([['005930', quote({ price: 77000 })]]);

  const out = overlayFlowsQuotes(groups, quotes);

  assert.equal(out[0].buy[0].currentPrice, 77000);
  assert.equal(out[0].buy[0].returnPct, null);
});

test('collectFlowsTickers는 buy/sell·여러 그룹에 걸쳐 중복을 제거한다', () => {
  const groups = [
    groupOf(
      [row({ ticker: '005930' }), row({ ticker: '000660' })],
      [row({ ticker: '005930' })], // buy와 중복
    ),
    { key: 'inst', label: '기관', buy: [row({ ticker: '000660' })], sell: [row({ ticker: '035420' })] },
  ];

  const tickers = collectFlowsTickers(groups);

  assert.deepEqual([...tickers].sort(), ['000660', '005930', '035420']);
});

test('입력 배열·그룹·행 객체를 변경하지 않는다(불변)', () => {
  const original = row({ ticker: '005930', estAvgPrice: 70000 });
  const groups = [groupOf([original])];
  const groupsSnapshot = JSON.parse(JSON.stringify(groups));
  const quotes = new Map([['005930', quote({ price: 77000 })]]);

  overlayFlowsQuotes(groups, quotes);

  assert.deepEqual(groups, groupsSnapshot); // 원본 구조 그대로
  assert.equal(groups[0].buy[0], original); // 원본 행 객체도 그대로
});
