import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDisclosureEvents, DisclosureEventRow } from './CompositeScorer';

const row = (over: Partial<DisclosureEventRow>): DisclosureEventRow => ({
  event_type: 'bonus',
  score_delta: 5,
  detail: '판매·공급계약 체결',
  d: '07/07',
  recent: true,
  ...over,
});

test('동일 유형 가점은 30일 창에서 1회만 (디바이스 사례: 공급계약 3건 → +5)', () => {
  const rows = [
    row({ d: '07/07' }),
    row({ d: '07/06' }),
    row({ d: '07/02' }),
  ];
  const out = aggregateDisclosureEvents(rows);
  assert.equal(out.delta, 5);
  assert.ok(out.notes.some((n) => n.includes('반복 공시 2건 미가산')));
});

test('서로 다른 유형 가점은 각각 합산', () => {
  const rows = [
    row({ detail: '판매·공급계약 체결' }),
    row({ detail: '자기주식 취득 결정', d: '07/05' }),
  ];
  assert.equal(aggregateDisclosureEvents(rows).delta, 10);
});

test('감점은 동일 유형이어도 중복 누적', () => {
  const rows = [
    row({ event_type: 'penalty', score_delta: -5, detail: '전환사채 발행', d: '07/07' }),
    row({ event_type: 'penalty', score_delta: -5, detail: '전환사채 발행', d: '07/01' }),
  ];
  assert.equal(aggregateDisclosureEvents(rows).delta, -10);
});

test('30일 밖(recent=false) 가감점은 미반영, 제외성 공시는 90일 창 그대로', () => {
  const rows = [
    row({ recent: false, d: '05/27' }),
    row({ event_type: 'exclusion', score_delta: 0, detail: '감사의견 비적정', d: '06/01', recent: false }),
  ];
  const out = aggregateDisclosureEvents(rows);
  assert.equal(out.delta, 0);
  assert.equal(out.exclusions.length, 1);
});

test('델타 합산은 ±15 캡 유지 (서로 다른 유형 4건 +20 → +15)', () => {
  const rows = ['a', 'b', 'c', 'd'].map((t, i) => row({ detail: `유형${t}`, d: `07/0${i + 1}` }));
  assert.equal(aggregateDisclosureEvents(rows).delta, 15);
});

test('입력 불변 — 원본 배열이 변형되지 않음', () => {
  const rows = [row({}), row({ d: '07/06' })];
  const snapshot = JSON.stringify(rows);
  aggregateDisclosureEvents(rows);
  assert.equal(JSON.stringify(rows), snapshot);
});
