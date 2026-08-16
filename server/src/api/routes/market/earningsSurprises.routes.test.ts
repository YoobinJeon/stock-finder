import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intParam, toOut, BEAT_KINDS, MISS_KINDS } from './earningsSurprises.routes';

// ── intParam: 신뢰하지 않는 쿼리 입력의 정수 파싱 + 범위 폴백 ──

test('범위 안 정수는 그대로 통과', () => {
  assert.equal(intParam('45', 30, 365), 45);
});

test('파라미터가 없으면 기본값', () => {
  assert.equal(intParam(undefined, 30, 365), 30);
  assert.equal(intParam(null, 30, 365), 30);
});

test('숫자가 아니면 기본값 — SQL 조각처럼 보이는 입력 포함', () => {
  assert.equal(intParam('abc', 30, 365), 30);
  assert.equal(intParam('', 30, 365), 30);
  assert.equal(intParam('1 OR 1=1; DROP TABLE stocks', 30, 365), 1); // 선행 정수만 취함
  assert.equal(intParam('; DROP TABLE stocks', 30, 365), 30);
});

test('0·음수는 기본값으로 폴백', () => {
  assert.equal(intParam('0', 30, 365), 30);
  assert.equal(intParam('-5', 30, 365), 30);
});

test('상한 초과는 기본값으로 폴백하되 상한값 자체는 허용', () => {
  assert.equal(intParam('366', 30, 365), 30);
  assert.equal(intParam('365', 30, 365), 365);
  assert.equal(intParam('1', 30, 365), 1); // 하한 경계
});

test('소수는 정수부만 취한다', () => {
  assert.equal(intParam('10.9', 30, 365), 10);
});

test('같은 파라미터가 반복되면 Express가 배열을 주는데, 첫 값으로 해석된다', () => {
  // ?days=7&days=999 → req.query.days === ['7', '999'] → String() 시 "7,999"
  assert.equal(intParam(['7', '999'], 30, 365), 7);
});

// ── kind 분류: 어느 쪽에도 넣으면 안 되는 kind가 새지 않는지 ──

test('상회·하회 목록은 서로 겹치지 않는다', () => {
  const overlap = BEAT_KINDS.filter((k) => MISS_KINDS.includes(k));
  assert.deepEqual(overlap, []);
});

test('pct가 없는 전환 사건은 각 방향에 포함된다', () => {
  assert.ok(BEAT_KINDS.includes('turn_positive'));
  assert.ok(MISS_KINDS.includes('turn_negative'));
});

test('inline·deficit은 서프라이즈가 아니므로 양쪽 모두에서 제외', () => {
  for (const kind of ['inline', 'deficit']) {
    assert.ok(!BEAT_KINDS.includes(kind), `${kind}이 상회 목록에 있으면 안 된다`);
    assert.ok(!MISS_KINDS.includes(kind), `${kind}이 하회 목록에 있으면 안 된다`);
  }
});

// ── toOut: DB 행 → 응답 DTO ──

/** PG가 DECIMAL을 문자열로 돌려주는 것까지 반영한 합성 행 */
const ROW = {
  ticker: '005930',
  name: '샘플전자',
  market: 'KOSPI',
  sector: '전기전자',
  fiscal_year: 2026,
  fiscal_quarter: 2,
  detected_at: '2026-07-20',
  kind: 'beat',
  surprise_pct: '12.5',
  revenue_surprise_pct: '3.25',
  total_score: '78',
  day_change: '-1.4',
};

test('DECIMAL 문자열을 숫자로 변환한다', () => {
  assert.deepEqual(toOut(ROW), {
    ticker: '005930',
    name: '샘플전자',
    market: 'KOSPI',
    sector: '전기전자',
    fiscalYear: 2026,
    fiscalQuarter: 2,
    detectedAt: '2026-07-20',
    kind: 'beat',
    surprisePct: 12.5,
    revenueSurprisePct: 3.25,
    totalScore: 78,
    changePct: -1.4,
  });
});

test('결측은 null로 유지된다 — 전환 사건은 pct가 없다', () => {
  const out = toOut({
    ...ROW,
    kind: 'turn_positive',
    surprise_pct: null,
    revenue_surprise_pct: null,
    total_score: null,
    day_change: null,
    sector: null,
  });
  assert.equal(out.surprisePct, null);
  assert.equal(out.revenueSurprisePct, null);
  assert.equal(out.totalScore, null);
  assert.equal(out.changePct, null);
  assert.equal(out.sector, null);
});

test('0은 결측이 아니다 — falsy 검사로 뭉개면 안 된다', () => {
  const out = toOut({ ...ROW, surprise_pct: '0', total_score: '0', day_change: '0' });
  assert.equal(out.surprisePct, 0);
  assert.equal(out.totalScore, 0);
  assert.equal(out.changePct, 0);
});

test('회계연도·분기가 문자열로 와도 숫자로 정규화한다', () => {
  const out = toOut({ ...ROW, fiscal_year: '2026', fiscal_quarter: '4' });
  assert.equal(out.fiscalYear, 2026);
  assert.equal(out.fiscalQuarter, 4);
});
