import type { AnnualFinancial } from './sources/naverFinancials';
import type { ConsensusEstimate } from './sources/naverConsensus';

/**
 * naverFinancials(확정 실적 + 최대 1개 추정연도)와 naverConsensus(추정 최대 3개년)를 병합.
 *
 * 우선순위 결정(신규 소스 우선, 실패 시 기존 값 유지 — fail-soft):
 * - naverConsensus는 다년(최대 3개) + 순이익·ROE·EPS·BPS·PBR까지 갖춘 더 풍부한 소스이므로,
 *   컨센서스가 값을 제공하는 연도는 그 값으로 덮어쓴다(BPS·PBR도 동일 — 소스가 직접 제공하는
 *   값이 naverFinancials 쪽의 역산/부재 값보다 우선).
 * - naverConsensus가 다루지 않는 필드(부채비율·배당수익률·EPS 증가율)와, 컨센서스가 해당 연도에
 *   값을 못 내려준 BPS·PBR은 기존 naverFinancials 추정연도 값이 같은 연도에 있으면 보존한다.
 * - 컨센서스 수집이 실패했거나(네트워크 오류) 미커버 종목이라 빈 배열이면, 기존 추정치를
 *   그대로 반환 — 한쪽 소스 실패가 다른 쪽 데이터를 지우지 않는다.
 * - 확정(실적) 연도는 naverConsensus가 다루지 않으므로 항상 그대로 유지된다.
 */
export function mergeConsensusEstimates(
  base: readonly AnnualFinancial[],
  consensus: readonly ConsensusEstimate[],
): AnnualFinancial[] {
  if (consensus.length === 0) return [...base];

  const byYear = new Map<number, AnnualFinancial>(base.map((f) => [f.fiscalYear, f]));

  for (const c of consensus) {
    const existing = byYear.get(c.fiscalYear);
    byYear.set(c.fiscalYear, {
      fiscalYear: c.fiscalYear,
      isEstimate: true,
      revenue: c.revenue,
      operatingIncome: c.operatingIncome,
      netIncome: c.netIncome,
      eps: c.eps,
      bps: c.bps ?? existing?.bps ?? null,
      per: c.per,
      pbr: c.pbr ?? existing?.pbr ?? null,
      roe: c.roe,
      debtRatio: existing?.debtRatio ?? null,
      divYield: existing?.divYield ?? null,
      revenueGrowth: c.revenueGrowth,
      epsGrowth: existing?.epsGrowth ?? null,
    });
  }

  return [...byYear.values()].sort((a, b) => a.fiscalYear - b.fiscalYear);
}
