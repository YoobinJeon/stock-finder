import { getJson, num, frac } from '../http';
import { growthRate } from '../growthRate';

export interface AnnualFinancial {
  fiscalYear: number;
  isEstimate: boolean;             // TRUE = 애널리스트 컨센서스(전망치)
  revenue: number | null;          // 원
  operatingIncome: number | null;  // 원
  netIncome: number | null;        // 원
  eps: number | null;              // 원
  bps: number | null;              // 원 — 이 소스는 BPS를 직접 제공하지 않아 EPS/ROE로 역산(밸류에이션 밴드용)
  per: number | null;              // 추정연도의 per = 현재가 기준 fPER
  pbr: number | null;
  roe: number | null;              // 소수 (0.15 = 15%)
  debtRatio: number | null;        // 소수 (1.0 = 100%)
  divYield: number | null;         // 소수 (0.03 = 3%)
  revenueGrowth: number | null;    // YoY 소수 (확정 연도만)
  epsGrowth: number | null;        // YoY 소수 (확정 연도만)
}

const EOK = 1e8; // 네이버 연간 재무는 억원 단위

const integrationUrl = (t: string) => `https://m.stock.naver.com/api/stock/${t}/integration`;
const annualUrl = (t: string) => `https://m.stock.naver.com/api/stock/${t}/finance/annual`;

/**
 * 네이버 모바일 API에서 연간 재무 + 현재 밸류에이션 지표 수집.
 * - finance/annual: 확정 연도(실적) + 컨센서스 연도(전망: fPER·가이던스용)
 * - integration: 현재가 기준 PER/PBR/배당수익률 → 최신 확정 연도 행에 병합
 */
export async function fetchFinancials(ticker: string): Promise<AnnualFinancial[]> {
  const [integration, annual] = await Promise.all([
    getJson(integrationUrl(ticker)).catch(() => null),
    getJson(annualUrl(ticker)).catch(() => null),
  ]);

  const years: Array<{ key: string; year: number; isEstimate: boolean }> =
    (annual?.financeInfo?.trTitleList ?? [])
      .filter((t: any) => t?.key)
      .map((t: any) => ({
        key: String(t.key),
        year: Number(String(t.key).slice(0, 4)),
        isEstimate: t.isConsensus === 'Y',
      }))
      .filter((t: { year: number }) => Number.isFinite(t.year) && t.year > 1990)
      .sort((a: { year: number }, b: { year: number }) => a.year - b.year);

  const rowMap = new Map<string, Record<string, any>>();
  for (const row of annual?.financeInfo?.rowList ?? []) {
    if (row?.title) rowMap.set(row.title, row.columns ?? {});
  }
  const val = (title: string, key: string) => num(rowMap.get(title)?.[key]?.value);

  const results: AnnualFinancial[] = years.map(({ key, year, isEstimate }) => ({
    fiscalYear: year,
    isEstimate,
    revenue: scale(val('매출액', key), EOK),
    operatingIncome: scale(val('영업이익', key), EOK),
    netIncome: scale(val('당기순이익', key), EOK),
    eps: val('EPS', key),
    bps: deriveBps(val('EPS', key), frac(val('ROE', key))),
    per: clamp(val('PER', key)),
    pbr: clamp(val('PBR', key)),
    roe: frac(val('ROE', key)),
    debtRatio: frac(val('부채비율', key)),
    divYield: null,
    revenueGrowth: null,
    epsGrowth: null,
  }));

  // YoY 성장률 — 확정 연도끼리만 비교
  const actuals = results.filter((r) => !r.isEstimate);
  for (let i = 1; i < actuals.length; i++) {
    actuals[i].revenueGrowth = growthRate(actuals[i].revenue, actuals[i - 1].revenue);
    actuals[i].epsGrowth = growthRate(actuals[i].eps, actuals[i - 1].eps);
  }

  // 최신 확정 연도에 현재 시세 기준 지표 병합 (tPER)
  const latest = actuals[actuals.length - 1];
  if (latest) {
    const infos: any[] = integration?.totalInfos ?? [];
    const info = (code: string) => num(infos.find((i) => i?.code === code)?.value);
    latest.per = clamp(info('per')) ?? latest.per;
    latest.pbr = clamp(info('pbr')) ?? latest.pbr;
    latest.divYield = frac(info('dividendYieldRatio'));
  }

  // 추정 연도 fPER 보강: annual에 없으면 integration의 추정PER(cnsPer) 사용
  const firstEstimate = results.find((r) => r.isEstimate);
  if (firstEstimate && firstEstimate.per == null) {
    const infos: any[] = integration?.totalInfos ?? [];
    firstEstimate.per = clamp(num(infos.find((i) => i?.code === 'cnsPer')?.value));
  }

  return results;
}

function scale(v: number | null, factor: number): number | null {
  return v == null ? null : Math.round(v * factor);
}


/** DECIMAL(8,2) 컬럼 범위를 벗어나는 이상치는 버림 */
function clamp(v: number | null, max = 99999): number | null {
  return v != null && Math.abs(v) <= max ? v : null;
}

/**
 * BPS(주당순자산) 역산 — 이 소스는 BPS를 직접 제공하지 않지만, ROE = 순이익/자기자본 =
 * EPS/BPS(발행주식수가 동일하다는 전제) 항등식이 성립하므로 EPS/ROE로 근사할 수 있다.
 * PBR 밴드(밸류에이션 밴드)에 필요 — naverConsensus의 추정연도 BPS(직접 제공)와 달리
 * 확정연도는 이 역산값을 쓴다. ROE가 0이거나 없으면(적자 등) 계산하지 않음("없으면 기입하지 않음").
 */
export function deriveBps(eps: number | null, roe: number | null): number | null {
  if (eps == null || roe == null || roe === 0) return null;
  return Math.round(eps / roe);
}
