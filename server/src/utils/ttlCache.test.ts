import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyedTtlCache, createTtlCache } from './ttlCache';

test('신선한 캐시는 loader를 재실행하지 않는다', async () => {
  let calls = 0;
  const c = createTtlCache(60_000, async () => { calls++; return calls; });
  const a = await c.get();
  const b = await c.get();
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(calls, 1);
});

test('single-flight: 동시 요청은 loader를 1회만 실행', async () => {
  let calls = 0;
  const c = createTtlCache(60_000, async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    return calls;
  });
  const [a, b, d] = await Promise.all([c.get(), c.get(), c.get()]);
  assert.equal(calls, 1);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(d, 1);
});

test('clear 후에는 재계산', async () => {
  let calls = 0;
  const c = createTtlCache(60_000, async () => { calls++; return calls; });
  await c.get();
  c.clear();
  const v = await c.get();
  assert.equal(v, 2);
  assert.equal(calls, 2);
});

test('ttl 0이면 매번 재계산', async () => {
  let calls = 0;
  const c = createTtlCache(0, async () => { calls++; return calls; });
  await c.get();
  await c.get();
  assert.equal(calls, 2);
});

// ── createKeyedTtlCache (LRU 상한) ────────────────────────────────

test('키별로 값을 분리해 캐시한다', async () => {
  const calls: string[] = [];
  const c = createKeyedTtlCache(60_000, 10, (key) => async () => { calls.push(key); return key; });
  assert.equal(await c.get('005930'), '005930');
  assert.equal(await c.get('000660'), '000660');
  assert.equal(await c.get('005930'), '005930');
  assert.deepEqual(calls, ['005930', '000660']); // 두 번째 005930은 캐시 히트
});

test('상한을 넘으면 가장 오래 안 쓰인 키부터 버린다', async () => {
  const calls: string[] = [];
  const c = createKeyedTtlCache(60_000, 2, (key) => async () => { calls.push(key); return key; });
  await c.get('A');
  await c.get('B');
  await c.get('C'); // A 축출
  assert.equal(c.size(), 2);
  await c.get('A'); // 축출됐으므로 loader 재실행
  assert.deepEqual(calls, ['A', 'B', 'C', 'A']);
});

test('최근 사용한 키는 축출 대상에서 뒤로 밀린다 (LRU)', async () => {
  const calls: string[] = [];
  const c = createKeyedTtlCache(60_000, 2, (key) => async () => { calls.push(key); return key; });
  await c.get('A');
  await c.get('B');
  await c.get('A'); // A를 최근 사용으로 갱신 → 다음 축출 대상은 B
  await c.get('C'); // B 축출
  await c.get('A'); // 여전히 캐시에 있어야 함
  assert.deepEqual(calls, ['A', 'B', 'C']);
});

test('키 개수는 상한을 넘지 않는다 — 무작위 티커 폭주 방어', async () => {
  const c = createKeyedTtlCache(60_000, 5, (key) => async () => key);
  for (let i = 0; i < 500; i += 1) await c.get(`T${i}`);
  assert.equal(c.size(), 5);
});

test('loader가 실패하면 그 키를 캐시에 남기지 않는다', async () => {
  let calls = 0;
  const c = createKeyedTtlCache(60_000, 10, () => async () => { calls++; throw new Error('조회 실패'); });
  await assert.rejects(() => c.get('005930'));
  assert.equal(c.size(), 0);
  await assert.rejects(() => c.get('005930')); // 즉시 재시도돼야 함(고착 금지)
  assert.equal(calls, 2);
});
