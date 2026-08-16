import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideSurprises,
  MIN_ESTIMATE_BASE,
  SURPRISE_THRESHOLD_PCT,
  SURPRISE_PCT_CLAMP,
  type QuarterRow,
} from './earningsSurprise';

const EOK = 1e8; // 1억원 — 소스가 억원 단위라 테스트도 같은 스케일로 맞춘다

/** 분기 행 1건 생성 헬퍼 — 관심 없는 필드는 기본값으로 채운다 */
function row(
  over: Partial<QuarterRow> & Pick<QuarterRow, 'fiscalYear' | 'fiscalQuarter' | 'isEstimate'>,
): QuarterRow {
  return {
    revenue: 1000 * EOK,
    operatingIncome: 100 * EOK,
    netIncome: 80 * EOK,
    eps: 1000,
    updatedAt: '2026-07-24T09:10:00.000Z',
    ...over,
  };
}

test('전환이 없으면(여전히 추정) 빈 배열', () => {
  const prev = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true })];
  const next = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true })];

  assert.deepEqual(decideSurprises(prev, next), []);
});

test('영업이익 +15% 상회 → beat, pct 정확', () => {
  const prev = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true, operatingIncome: 100 * EOK })];
  const next = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: 115 * EOK })];

  const [r] = decideSurprises(prev, next);

  assert.equal(r.kind, 'beat');
  assert.equal(r.surprisePct, 15);
  assert.equal(r.fiscalYear, 2026);
  assert.equal(r.fiscalQuarter, 2);
  assert.equal(r.est.operatingIncome, 100 * EOK);
  assert.equal(r.act.operatingIncome, 115 * EOK);
  assert.equal(r.estimateUpdatedAt, '2026-07-24T09:10:00.000Z');
});

test('영업이익 -20% 하회 → miss', () => {
  const prev = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true, operatingIncome: 100 * EOK })];
  const next = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: 80 * EOK })];

  const [r] = decideSurprises(prev, next);

  assert.equal(r.kind, 'miss');
  assert.equal(r.surprisePct, -20);
});

test('임계값 +10%/-10%는 경계 포함 (beat/miss)', () => {
  const prev = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true, operatingIncome: 100 * EOK })];
  const up = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: 110 * EOK })];
  const down = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: 90 * EOK })];

  assert.equal(decideSurprises(prev, up)[0].kind, 'beat');
  assert.equal(decideSurprises(prev, down)[0].kind, 'miss');
  assert.equal(SURPRISE_THRESHOLD_PCT, 10);
});

test('임계값 미만(+9.9%)은 inline', () => {
  const prev = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true, operatingIncome: 100 * EOK })];
  const next = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: 109.9 * EOK })];

  const [r] = decideSurprises(prev, next);

  assert.equal(r.kind, 'inline');
  assert.equal(r.surprisePct, 9.9);
});

test('추정이 적자였는데 흑자로 확정 → turn_positive, pct는 NULL', () => {
  const prev = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true, operatingIncome: -50 * EOK })];
  const next = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: 10 * EOK })];

  const [r] = decideSurprises(prev, next);

  assert.equal(r.kind, 'turn_positive');
  assert.equal(r.surprisePct, null);
});

test('추정도 적자·확정도 적자 → deficit, pct는 NULL', () => {
  const prev = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true, operatingIncome: -50 * EOK })];
  const next = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: -30 * EOK })];

  const [r] = decideSurprises(prev, next);

  assert.equal(r.kind, 'deficit');
  assert.equal(r.surprisePct, null);
});

test('흑자 추정이 적자로 확정 → turn_negative, pct는 큰 음수', () => {
  const prev = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true, operatingIncome: 100 * EOK })];
  const next = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: -20 * EOK })];

  const [r] = decideSurprises(prev, next);

  assert.equal(r.kind, 'turn_negative');
  assert.equal(r.surprisePct, -120);
});

test('추정 영업이익이 최소 분모(1억원) 이하면 pct는 NULL — 비율 폭발 방지', () => {
  const prev = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true, operatingIncome: 5e7 })];
  const next = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: 5 * EOK })];

  const [r] = decideSurprises(prev, next);

  assert.equal(r.surprisePct, null);
  assert.equal(r.kind, 'inline');
  assert.equal(MIN_ESTIMATE_BASE, 1e8);
});

test('추정 또는 확정 영업이익이 null이면 기록하지 않는다', () => {
  const prevNull = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true, operatingIncome: null })];
  const actNull = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: null })];
  const ok = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: 110 * EOK })];
  const prevOk = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true, operatingIncome: 100 * EOK })];

  assert.deepEqual(decideSurprises(prevNull, ok), []);
  assert.deepEqual(decideSurprises(prevOk, actNull), []);
});

test('이미 확정이던 분기는 전환이 아니므로 기록하지 않는다', () => {
  const prev = [row({ fiscalYear: 2026, fiscalQuarter: 1, isEstimate: false, operatingIncome: 100 * EOK })];
  const next = [row({ fiscalYear: 2026, fiscalQuarter: 1, isEstimate: false, operatingIncome: 130 * EOK })];

  assert.deepEqual(decideSurprises(prev, next), []);
});

test('직전 스냅샷에 없던 신규 분기는 기록하지 않는다', () => {
  const prev: QuarterRow[] = [];
  const next = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: 100 * EOK })];

  assert.deepEqual(decideSurprises(prev, next), []);
});

test('극단적인 비율은 999로 클램프', () => {
  const prev = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true, operatingIncome: 2 * EOK })];
  const next = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: 10000 * EOK })];

  const [r] = decideSurprises(prev, next);

  assert.equal(r.surprisePct, SURPRISE_PCT_CLAMP);
  assert.equal(r.kind, 'beat');
});

test('매출 추정이 null이면 revenueSurprisePct만 NULL, kind는 영업이익 기준 유지', () => {
  const prev = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true, operatingIncome: 100 * EOK, revenue: null })];
  const next = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: 115 * EOK, revenue: 1200 * EOK })];

  const [r] = decideSurprises(prev, next);

  assert.equal(r.revenueSurprisePct, null);
  assert.equal(r.kind, 'beat');
});

test('여러 분기 중 전환된 분기만 골라낸다', () => {
  const prev = [
    row({ fiscalYear: 2026, fiscalQuarter: 1, isEstimate: false }),
    row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true, operatingIncome: 100 * EOK }),
    row({ fiscalYear: 2026, fiscalQuarter: 3, isEstimate: true }),
  ];
  const next = [
    row({ fiscalYear: 2026, fiscalQuarter: 1, isEstimate: false }),
    row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: 120 * EOK }),
    row({ fiscalYear: 2026, fiscalQuarter: 3, isEstimate: true }),
  ];

  const result = decideSurprises(prev, next);

  assert.equal(result.length, 1);
  assert.equal(result[0].fiscalQuarter, 2);
});

test('미미한 추정치(1억원 이하)가 적자로 확정 → turn_negative, pct는 NULL', () => {
  const prev = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: true, operatingIncome: 5e7 })];
  const next = [row({ fiscalYear: 2026, fiscalQuarter: 2, isEstimate: false, operatingIncome: -50 * EOK })];

  const [r] = decideSurprises(prev, next);

  assert.equal(r.kind, 'turn_negative');
  assert.equal(r.surprisePct, null);
});
