import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshesPrices, INGEST_SCOPES } from './ingest';

// 시세를 새로 쌓는 스코프에서만 가격 재정합이 뒤따른다.
// 이 판정이 틀리면 액면분할 등으로 깨진 과거 종가가 고쳐지지 않은 채 남는다.

test('시세를 새로 쌓는 스코프는 후속 처리 대상', () => {
  for (const scope of ['prices', 'top200', 'kospi', 'all'] as const) {
    assert.equal(refreshesPrices(scope), true, `${scope}는 대상이어야 한다`);
  }
});

test('시세를 새로 쌓지 않는 스코프는 대상이 아니다', () => {
  for (const scope of ['financials', 'disclosures', 'rescore',
    'earnings-trend', 'quarterly-backfill', 'schedule-reparse'] as const) {
    assert.equal(refreshesPrices(scope), false, `${scope}는 대상이 아니어야 한다`);
  }
});

test('모든 스코프가 판정에 포함된다 — 새 스코프 추가 시 누락 방지', () => {
  for (const scope of INGEST_SCOPES) {
    assert.equal(typeof refreshesPrices(scope), 'boolean', `${scope} 판정 누락`);
  }
});
