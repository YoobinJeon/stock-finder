import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeConsensusEstimates } from './financialsMerge';
import type { AnnualFinancial } from './sources/naverFinancials';
import type { ConsensusEstimate } from './sources/naverConsensus';

function actual(year: number): AnnualFinancial {
  return {
    fiscalYear: year,
    isEstimate: false,
    revenue: 100,
    operatingIncome: 10,
    netIncome: 5,
    eps: 100,
    bps: 2000,
    per: 10,
    pbr: 1,
    roe: 0.05,
    debtRatio: 0.5,
    divYield: 0.02,
    revenueGrowth: 0.1,
    epsGrowth: 0.1,
  };
}

function oldEstimate(year: number): AnnualFinancial {
  return {
    fiscalYear: year,
    isEstimate: true,
    revenue: 200,
    operatingIncome: 20,
    netIncome: null, // naverFinancials 단일 추정연도는 순이익을 안 채움(사전조사 기록)
    eps: null,
    bps: null,
    per: 9,
    pbr: 1.2,
    roe: null,
    debtRatio: 0.4,
    divYield: 0.03,
    revenueGrowth: null,
    epsGrowth: null,
  };
}

// pbr/bps는 기본적으로 null(컨센서스가 값을 안 내려준 경우 = 보존 테스트용) — 필요 시 override로 덮어씀.
function consensusYear(year: number, override: Partial<ConsensusEstimate> = {}): ConsensusEstimate {
  return {
    fiscalYear: year,
    revenue: 300,
    operatingIncome: 30,
    netIncome: 15,
    eps: 150,
    bps: null,
    per: 8,
    pbr: null,
    roe: 0.15,
    revenueGrowth: 0.3,
    ...override,
  };
}

test('컨센서스가 없으면(빈 배열) 기존 값을 그대로 반환한다(fail-soft)', () => {
  const base = [actual(2025), oldEstimate(2026)];
  const result = mergeConsensusEstimates(base, []);
  assert.deepEqual(result, base);
});

test('겹치는 연도는 컨센서스 값(매출·영업이익·순이익·EPS·fPER·ROE·증가율)으로 덮어쓴다', () => {
  const base = [actual(2025), oldEstimate(2026)];
  const [, merged2026] = mergeConsensusEstimates(base, [consensusYear(2026)]);

  assert.equal(merged2026.fiscalYear, 2026);
  assert.equal(merged2026.isEstimate, true);
  assert.equal(merged2026.revenue, 300);
  assert.equal(merged2026.operatingIncome, 30);
  assert.equal(merged2026.netIncome, 15);
  assert.equal(merged2026.eps, 150);
  assert.equal(merged2026.per, 8);
  assert.equal(merged2026.roe, 0.15);
  assert.equal(merged2026.revenueGrowth, 0.3);
});

test('컨센서스가 BPS·PBR을 안 내려준 연도는 기존 추정치를 보존한다', () => {
  const base = [actual(2025), oldEstimate(2026)];
  const [, merged2026] = mergeConsensusEstimates(base, [consensusYear(2026)]);

  assert.equal(merged2026.bps, null); // oldEstimate(2026)도 bps가 없어 보존할 값 자체가 없음
  assert.equal(merged2026.pbr, 1.2);
});

test('컨센서스가 다루지 않는 필드(부채비율·배당수익률·EPS증가율)는 기존 추정치를 보존한다', () => {
  const base = [actual(2025), oldEstimate(2026)];
  const [, merged2026] = mergeConsensusEstimates(base, [consensusYear(2026)]);

  assert.equal(merged2026.debtRatio, 0.4);
  assert.equal(merged2026.divYield, 0.03);
  assert.equal(merged2026.epsGrowth, null);
});

test('컨센서스가 BPS·PBR을 직접 제공하면(값이 있으면) 기존 추정치를 덮어쓴다', () => {
  const base = [actual(2025), oldEstimate(2026)];
  const [, merged2026] = mergeConsensusEstimates(
    base,
    [consensusYear(2026, { bps: 5000, pbr: 3.5 })],
  );

  assert.equal(merged2026.bps, 5000);
  assert.equal(merged2026.pbr, 3.5);
});

test('확정(실적) 연도는 컨센서스가 없어도 그대로 유지된다', () => {
  const base = [actual(2025), oldEstimate(2026)];
  const [merged2025] = mergeConsensusEstimates(base, [consensusYear(2026)]);
  assert.deepEqual(merged2025, actual(2025));
});

test('기존에 없던 새 연도(2027, 2028)를 추가하고 연도 오름차순으로 정렬한다', () => {
  const base = [actual(2025), oldEstimate(2026)];
  const result = mergeConsensusEstimates(base, [
    consensusYear(2028),
    consensusYear(2026),
    consensusYear(2027),
  ]);

  assert.equal(result.length, 4);
  assert.deepEqual(
    result.map((r) => r.fiscalYear),
    [2025, 2026, 2027, 2028],
  );
  assert.equal(result[2].pbr, null); // 2027은 기존 추정치가 없었으므로 보존할 값도 없음
});
