import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMomentum, MomentumFinRow, MomentumIndicatorRow } from './MomentumEngine';

const closesToRows = (closes: number[]): MomentumFinRow[] => closes.map((close) => ({ close }));

// RSI(14)를 50(적정 매집 구간, +8)으로 고정하는 15개 알터네이팅 시드 — 새 팩터(RS·거래대금)를
// 기존 RSI 델타와 분리해서 검증하기 위한 공용 픽스처.
const RSI_NEUTRAL_SEED = [100, 102, 100, 102, 100, 102, 100, 102, 100, 102, 100, 102, 100, 102, 100];

test('시세 데이터가 20일 미만이면 중립 50점', () => {
  const result = scoreMomentum(closesToRows([100, 101, 102, 103, 104]));
  assert.equal(result.score, 50);
  assert.match(result.reasons[0], /시세 데이터 부족 \(5일\)/);
  assert.match(result.reasons[0], /중립\(50점\)/);
});

test('20일치 상승 추세: 1개월 수익률 가점 + RSI 과매수 감점', () => {
  // idx0(최신)=121 ... idx18=103 (1씩 하락), idx19(최고령)=100 → 1개월 수익률만 계산됨
  const closes = [121, 120, 119, 118, 117, 116, 115, 114, 113, 112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 100];
  const result = scoreMomentum(closesToRows(closes));
  // 50 + 15(1개월 수익률 +21% → +15 상한) - 10(RSI 과매수) = 55
  assert.equal(result.score, 55);
  assert.ok(result.reasons.some((r) => r.includes('1개월')));
  assert.ok(result.reasons.some((r) => r.includes('과매수 주의')));
});

test('20일치 하락 추세: 1개월 수익률 감점 + RSI 과매도 감점', () => {
  const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 121];
  const result = scoreMomentum(closesToRows(closes));
  // 50 - 15(1개월 수익률 -17.4% → -15 하한) - 8(RSI 과매도) = 27
  assert.equal(result.score, 27);
  assert.ok(result.reasons.some((r) => r.includes('과매도')));
});

test('RSI가 40~65 구간이면 "적정 매집 구간" 가점(+8)', () => {
  // 최근 15일 종가가 100↔102를 오가며 gains=losses → RSI=50
  const rsiWindow = [100, 102, 100, 102, 100, 102, 100, 102, 100, 102, 100, 102, 100, 102, 100];
  const closes = [...rsiWindow, 100, 100, 100, 100, 100]; // idx19=100 → 1개월 수익률 0%
  const result = scoreMomentum(closesToRows(closes));
  // 50 + 0(1개월 수익률 0%) + 8(RSI 적정 매집 구간) = 58
  assert.equal(result.score, 58);
  assert.ok(result.reasons.some((r) => r.includes('적정 매집 구간')));
});

test('4개 기간 모두 극단적 상승 + RSI 중립이면 100점 상한에서 클램프된다', () => {
  const closes = new Array(260).fill(100);
  const rsiWindow = [100, 102, 100, 102, 100, 102, 100, 102, 100, 102, 100, 102, 100, 102, 100];
  for (let i = 0; i < rsiWindow.length; i++) closes[i] = rsiWindow[i];
  closes[21] = 80;   // 1개월 수익률 +25% → 상한 +15
  closes[63] = 70;   // 3개월 수익률 +42.9% → 상한 +15
  closes[126] = 60;  // 6개월 수익률 +66.7% → 상한 +10
  closes[252] = 50;  // 12개월 수익률 +100% → 상한 +10
  const result = scoreMomentum(closesToRows(closes));
  // 50 + (15+15+10+10) + 8(RSI 중립) = 108 → clamp 100
  assert.equal(result.score, 100);
});

test('4개 기간 모두 극단적 하락 + RSI 과매도면 0점 하한에서 클램프된다', () => {
  const closes = new Array(260).fill(100);
  for (let i = 0; i < 15; i++) closes[i] = 100 - i; // 단조 하락 → RSI 과매도
  closes[21] = 1000;   // 1개월 수익률 -90% → 하한 -15
  closes[63] = 2000;   // 3개월 수익률 -95% → 하한 -15
  closes[126] = 5000;  // 6개월 수익률 -98% → 하한 -10
  closes[252] = 10000; // 12개월 수익률 -99% → 하한 -10
  const result = scoreMomentum(closesToRows(closes));
  // 50 - (15+15+10+10) - 8(RSI 과매도) = -8 → clamp 0
  assert.equal(result.score, 0);
});

// --- v3: RS 백분위 편입 ------------------------------------------------------

test('rs_percentile ≥90이면 RS 상위 10% 가점(+15)', () => {
  const closes = [...RSI_NEUTRAL_SEED, ...new Array(25).fill(100)]; // 40일, 1M/3M 수익률 0%
  const indicators: MomentumIndicatorRow = { rs_percentile: 92, turnover_surge: null };
  const result = scoreMomentum(closesToRows(closes), indicators);
  // 50 + 0(1M) + 15(RS 상위10%) + 8(RSI) = 73
  assert.equal(result.score, 73);
  assert.ok(result.reasons.some((r) => r.includes('RS 백분위 92') && r.includes('상위 10%')));
});

test('rs_percentile ≥80이면 +10, ≥70이면 +5 가점', () => {
  const closes = [...RSI_NEUTRAL_SEED, ...new Array(25).fill(100)];
  const r80 = scoreMomentum(closesToRows(closes), { rs_percentile: 82, turnover_surge: null });
  const r70 = scoreMomentum(closesToRows(closes), { rs_percentile: 72, turnover_surge: null });
  assert.equal(r80.score, 68); // 50 + 0 + 10 + 8
  assert.equal(r70.score, 63); // 50 + 0 + 5 + 8
});

test('rs_percentile이 30 이하면 약세 페널티(-8), 31~69는 중립(0)', () => {
  const closes = [...RSI_NEUTRAL_SEED, ...new Array(25).fill(100)];
  const weak = scoreMomentum(closesToRows(closes), { rs_percentile: 20, turnover_surge: null });
  const neutral = scoreMomentum(closesToRows(closes), { rs_percentile: 50, turnover_surge: null });
  assert.equal(weak.score, 50); // 50 + 0 - 8 + 8
  assert.ok(weak.reasons.some((r) => r.includes('약세')));
  assert.equal(neutral.score, 58); // 50 + 0 + 0 + 8
  assert.ok(neutral.reasons.some((r) => r.includes('RS 백분위 50') && r.includes('중립')));
});

test('rs_percentile이 있으면 절대수익률 사다리가 1M/3M로 축소되고 6M/12M은 계산하지 않는다', () => {
  const closes = new Array(260).fill(100);
  for (let i = 0; i < 15; i++) closes[i] = RSI_NEUTRAL_SEED[i];
  closes[21] = 80;  // 1개월 +25% → v3 상한 +10
  closes[63] = 70;  // 3개월 +42.9% → v3 상한 +10
  closes[126] = 60; // v2에서는 6개월 반영 대상이었지만 v3는 6M 자체를 계산하지 않음
  closes[252] = 50; // 마찬가지로 12M 미계산
  const result = scoreMomentum(closesToRows(closes), { rs_percentile: 95, turnover_surge: null });
  // 50 + 10(1M) + 10(3M) + 15(RS 상위10%) + 8(RSI) = 93
  assert.equal(result.score, 93);
  assert.ok(!result.reasons.some((r) => r.includes('6개월')));
  assert.ok(!result.reasons.some((r) => r.includes('12개월')));
});

test('rs_percentile이 null이면(indicators 자체가 turnover만 있어도) v2 4구간 사다리로 폴백한다', () => {
  const closes = new Array(260).fill(100);
  for (let i = 0; i < 15; i++) closes[i] = RSI_NEUTRAL_SEED[i];
  closes[21] = 80; closes[63] = 70; closes[126] = 60; closes[252] = 50;
  const result = scoreMomentum(closesToRows(closes), { rs_percentile: null, turnover_surge: 4 });
  // v2 상한(15/15/10/10)까지 반영되어야 폴백 확인 가능 — 극단적 상승이라 전부 상한 클램프
  // 50 + 15(1M) + 15(3M) + 10(6M) + 10(12M) + 8(RSI) = 108 → clamp 100 (dataMissing 아님)
  assert.equal(result.score, 100);
  assert.equal(result.dataMissing, undefined);
  assert.ok(result.reasons.some((r) => r.includes('6개월')));
});

// --- v3: 거래대금급증 편입 ---------------------------------------------------

test('turnover_surge ≥3배 & 20일 전보다 종가 상승이면 +5', () => {
  const closes = new Array(40).fill(100);
  for (let i = 0; i < 15; i++) closes[i] = RSI_NEUTRAL_SEED[i];
  closes[20] = 90; // 20일 전 종가 < 오늘 종가(100)
  const result = scoreMomentum(closesToRows(closes), { rs_percentile: 50, turnover_surge: 4 });
  // 50 + 0(1M, RS있어 v3 사다리) + 0(RS 중립) + 5(거래대금급증) + 8(RSI) = 63
  assert.equal(result.score, 63);
  assert.ok(result.reasons.some((r) => r.includes('거래대금급증') && r.includes('4.0배')));
});

test('turnover_surge ≥3배여도 20일 전보다 종가가 낮으면 가점 없음', () => {
  const closes = new Array(40).fill(100);
  for (let i = 0; i < 15; i++) closes[i] = RSI_NEUTRAL_SEED[i];
  closes[20] = 110; // 20일 전 종가 > 오늘 종가(100) — 상승 조건 불충족
  const result = scoreMomentum(closesToRows(closes), { rs_percentile: 50, turnover_surge: 4 });
  assert.equal(result.score, 58); // 50 + 0 + 0 + 8, 거래대금 가점 없음
  assert.ok(!result.reasons.some((r) => r.includes('거래대금급증')));
});

test('turnover_surge가 3배 미만이면 상승 동반이어도 가점 없음', () => {
  const closes = new Array(40).fill(100);
  for (let i = 0; i < 15; i++) closes[i] = RSI_NEUTRAL_SEED[i];
  closes[20] = 90;
  const result = scoreMomentum(closesToRows(closes), { rs_percentile: 50, turnover_surge: 2 });
  assert.equal(result.score, 58);
  assert.ok(!result.reasons.some((r) => r.includes('거래대금급증')));
});
