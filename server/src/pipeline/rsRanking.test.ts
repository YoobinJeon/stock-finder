import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcPeriodReturns,
  calcIntegratedRsScore,
  isRankable,
  aggregateSectorRs,
  rankStocks,
  type PeriodCloses,
} from './rsRanking';

// ── calcPeriodReturns ──

test('모든 종가가 있으면 기간별 수익률을 정상 계산한다', () => {
  const closes: PeriodCloses = { c0: 110, c1m: 100, c3m: 100, c6m: 100, c12m: 100 };
  const out = calcPeriodReturns(closes);
  assert.equal(out.r1m, 10);
  assert.equal(out.r3m, 10);
  assert.equal(out.r6m, 10);
  assert.equal(out.r12m, 10);
});

test('base 종가가 없으면 해당 기간만 null', () => {
  const closes: PeriodCloses = { c0: 110, c1m: 100, c3m: null, c6m: 100, c12m: 100 };
  const out = calcPeriodReturns(closes);
  assert.equal(out.r1m, 10);
  assert.equal(out.r3m, null);
  assert.equal(out.r6m, 10);
  assert.equal(out.r12m, 10);
});

test('base 종가가 0 이하이면 null', () => {
  const closes: PeriodCloses = { c0: 110, c1m: 0, c3m: -5, c6m: 100, c12m: 100 };
  const out = calcPeriodReturns(closes);
  assert.equal(out.r1m, null);
  assert.equal(out.r3m, null);
});

test('오늘 종가(c0)가 없으면 전체 null(상장 초기 등)', () => {
  const closes: PeriodCloses = { c0: null, c1m: 100, c3m: 100, c6m: 100, c12m: 100 };
  const out = calcPeriodReturns(closes);
  assert.deepEqual(out, { r1m: null, r3m: null, r6m: null, r12m: null });
});

test('입력 객체를 변경하지 않는다(불변)', () => {
  const closes: PeriodCloses = { c0: 110, c1m: 100, c3m: 100, c6m: 100, c12m: 100 };
  const snapshot = { ...closes };
  calcPeriodReturns(closes);
  assert.deepEqual(closes, snapshot);
});

// ── calcIntegratedRsScore ──
// 2026-07-18: 백분위(순위) 공간 가중평균으로 전환 — 수익률 공간 가중은 기간별 분산 차이로
// 장기 구간이 명목 가중치를 무력화하던 문제(1M -39%인데 통합 99.8) 수정.

test('모든 구간이 있으면 백분위 가중평균(0.4/0.3/0.2/0.1)', () => {
  const out = calcIntegratedRsScore({ m1: 10, m3: 50, m6: 80, m12: 100 });
  // 0.4*10 + 0.3*50 + 0.2*80 + 0.1*100 = 4 + 15 + 16 + 10 = 45
  assert.ok(out != null);
  assert.ok(Math.abs(out - 45) < 1e-9);
});

test('1M 폭락(백분위 5)이면 3M이 최상위(100)여도 중위권으로 내려간다 — 화신정공 케이스', () => {
  const out = calcIntegratedRsScore({ m1: 5, m3: 100, m6: 100, m12: 100 });
  // 0.4*5 + 0.3*100 + 0.2*100 + 0.1*100 = 2 + 60 = 62 — 99.8이 아니라 62
  assert.ok(out != null);
  assert.ok(Math.abs(out - 62) < 1e-9);
});

test('m1+m3만 있으면 가중치 0.4/0.3 → 4/7, 3/7로 재정규화', () => {
  const out = calcIntegratedRsScore({ m1: 10, m3: 20, m6: null, m12: null });
  assert.ok(out != null);
  assert.ok(Math.abs(out - (4 / 7) * 10 - (3 / 7) * 20) < 1e-9);
});

test('m1이 없으면 통합 점수는 null(랭킹 최소 요건 미달)', () => {
  const out = calcIntegratedRsScore({ m1: null, m3: 20, m6: 30, m12: 40 });
  assert.equal(out, null);
});

test('m3이 없으면 통합 점수는 null(랭킹 최소 요건 미달)', () => {
  const out = calcIntegratedRsScore({ m1: 5, m3: null, m6: 30, m12: 40 });
  assert.equal(out, null);
});

test('입력 객체를 변경하지 않는다(불변)', () => {
  const input = { m1: 5, m3: 10, m6: 20, m12: 40 };
  const snapshot = { ...input };
  calcIntegratedRsScore(input);
  assert.deepEqual(input, snapshot);
});

// ── isRankable ──

test('거래정지 의심: 1M도 0%·3M도 0%면 배제', () => {
  const out = isRankable({ r1m: 0, r3m: 0, r6m: 5, r12m: 10 });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'frozen');
});

test('거래정지 의심: 1M이 0%이고 3M이 없으면(상장 1개월 미만 데이터) 배제', () => {
  const out = isRankable({ r1m: 0, r3m: null, r6m: null, r12m: null });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'frozen');
});

test('1M이 0%라도 3M이 실제로 움직였으면 정상(단기 횡보일 뿐)', () => {
  const out = isRankable({ r1m: 0, r3m: 15, r6m: 20, r12m: 30 });
  assert.equal(out.ok, true);
  assert.equal(out.reason, null);
});

test('누적 수익률이 아무리 커도 배제하지 않는다 — 브이엠(12M +872%) 오탐 수정 (2026-07-18)', () => {
  // 가격 불연속(series_break) 판정은 일별 시계열이 필요해 라우트 SQL 담당 — 순수 함수는 동결만 본다.
  const out = isRankable({ r1m: 20, r3m: 150, r6m: 400, r12m: 872 });
  assert.equal(out.ok, true);
  assert.equal(out.reason, null);
});

test('모든 기간이 null이면 배제 사유 없음(ok:true) — 통합 RS는 어차피 null 처리됨', () => {
  const out = isRankable({ r1m: null, r3m: null, r6m: null, r12m: null });
  assert.equal(out.ok, true);
  assert.equal(out.reason, null);
});

test('정상 종목은 배제되지 않는다', () => {
  const out = isRankable({ r1m: 5, r3m: 10, r6m: 15, r12m: 25 });
  assert.equal(out.ok, true);
  assert.equal(out.reason, null);
});

// ── aggregateSectorRs ──

const stock = (ticker: string, sector: string | null, rs: number | null) => ({
  ticker, name: `${ticker}_name`, sector, integratedRs: rs,
});

test('섹터 중앙값(홀수 구성원)', () => {
  const stocks = [
    stock('A', '반도체', 10), stock('B', '반도체', 20), stock('C', '반도체', 30),
  ];
  const out = aggregateSectorRs(stocks);
  assert.equal(out.length, 1);
  assert.equal(out[0].medianRs, 20);
  assert.equal(out[0].count, 3);
});

test('섹터 중앙값(짝수 구성원 — 중간 두 값 평균)', () => {
  const stocks = [
    stock('A', '반도체', 10), stock('B', '반도체', 20), stock('C', '반도체', 30), stock('D', '반도체', 40),
  ];
  const out = aggregateSectorRs(stocks);
  assert.equal(out[0].medianRs, 25); // (20+30)/2
});

test('구성원 3개 미만 섹터는 결과에서 제외', () => {
  const stocks = [
    stock('A', '반도체', 10), stock('B', '반도체', 20), stock('C', '반도체', 30),
    stock('D', '2차전지', 50), stock('E', '2차전지', 60), // 2개뿐 — 제외 대상
  ];
  const out = aggregateSectorRs(stocks);
  assert.equal(out.length, 1);
  assert.equal(out[0].sector, '반도체');
});

test('sector 또는 integratedRs가 null인 종목은 집계에서 제외', () => {
  const stocks = [
    stock('A', '반도체', 10), stock('B', '반도체', 20), stock('C', '반도체', 30),
    stock('D', null, 90), stock('E', '반도체', null),
  ];
  const out = aggregateSectorRs(stocks);
  assert.equal(out[0].count, 3);
});

test('통합 RS 상위 3종목을 top에 담고, 섹터는 medianRs 내림차순 정렬', () => {
  const stocks = [
    stock('A', '반도체', 10), stock('B', '반도체', 90), stock('C', '반도체', 50), stock('D', '반도체', 70),
    stock('E', '2차전지', 5), stock('F', '2차전지', 6), stock('G', '2차전지', 7),
  ];
  const out = aggregateSectorRs(stocks);
  assert.equal(out[0].sector, '반도체'); // 중앙값 더 높음
  assert.deepEqual(out[0].top.map((t) => t.ticker), ['B', 'D', 'C']); // 90,70,50 순
});

test('입력 배열을 변경하지 않는다(불변)', () => {
  const stocks = [stock('A', '반도체', 10), stock('B', '반도체', 20), stock('C', '반도체', 30)];
  const snapshot = stocks.map((s) => ({ ...s }));
  aggregateSectorRs(stocks);
  assert.deepEqual(stocks, snapshot);
});

// ── rankStocks (percentile wiring) ──

test('rankStocks: 값이 없는 종목은 해당 기간 RS가 null 유지', () => {
  const rows = [
    {
      ticker: 'A', name: 'A사', sector: '반도체', marketCap: 1000, market: 'KOSPI',
      ret: { r1m: 10, r3m: 10, r6m: 10, r12m: 10 },
    },
    {
      ticker: 'B', name: 'B사', sector: '반도체', marketCap: 2000, market: 'KOSPI',
      ret: { r1m: null, r3m: 20, r6m: null, r12m: null },
    },
  ];
  const out = rankStocks(rows);
  const b = out.find((r) => r.ticker === 'B')!;
  assert.equal(b.rs.m1, null);
  assert.equal(b.rs.integrated, null);
  assert.ok(b.rs.m3 != null);
});
