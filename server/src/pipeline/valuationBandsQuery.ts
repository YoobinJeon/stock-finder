import { getDb } from '../config/database';
import { fetchYahooChart } from './sources/yahooPrices';
import { fetchKisDailyPrices } from './sources/kisDailyPrice';
import { fetchKisAnnualFinancials } from './sources/kisFinancialRatio';
import { logger } from '../utils/logger';
import {
  computeQuantiles,
  computeRatioSeries,
  perShareInterpolated,
  computeForwardBandPoints,
  computePerBands,
  computePbrBands,
  computePbrRoePoints,
  type BandSeries,
  type PbrRoeResult,
  type PricePoint,
} from './valuationBands';

/**
 * 밸류에이션 밴드(PER/PBR/PBR-ROE 밴드) — stock_financials·Yahoo 가격을 조회해
 * valuationBands.ts의 순수 함수 입력을 조립하고 결과를 합친다. DB·네트워크 의존은 이 파일에만
 * 두고, 계산 로직 자체는 순수 함수 쪽(valuationBands.ts)에 남겨 단위 테스트가 가능하게 한다.
 */

// Yahoo 폴백용 — 5년치를 일봉으로 받으면 응답이 무겁고 밴드 표시엔 과함이라 주봉으로 절충.
const PRICE_RANGE = '5y';
const PRICE_INTERVAL = '1wk';

/**
 * KIS 정본 경로의 조회 구간 — 20년(Phase 4).
 * 분위수는 표본이 많을수록 안정되는데 기존 5년은 표본이 얇았다. KIS 재무비율이 22개
 * 회계연도를 주므로 가격도 같은 길이로 맞춘다. **100행 상한이 봉 단위로 걸리므로 월봉**이라야
 * 20년이 3콜에 들어온다(주봉이면 11콜).
 */
const KIS_BAND_YEARS = 20;
const KIS_BAND_PERIOD = 'M' as const;

export interface ValuationBandsResult {
  available: boolean;
  reason?: string;
  price?: PricePoint[];
  perBands?: BandSeries[];
  pbrBands?: BandSeries[];
  pbrRoe?: PbrRoeResult;
  /** 밴드가 컨센서스로 연장된 회계연도 목록(오름차순). 추정치가 없으면 빈 배열. */
  forwardYears?: number[];
  current?: { per: number | null; pbr: number | null; roe: number | null };
}

interface AnnualFinancialRow {
  fiscal_year: number;
  eps: string | number | null;
  bps: string | number | null;
  per: string | number | null;
  pbr: string | number | null;
  roe: string | number | null;
  is_estimate: boolean;
}

interface QuarterBpsRow {
  fiscal_year: number;
  bps: string | number | null;
}

function toNum(v: string | number | null | undefined): number | null {
  return v == null ? null : Number(v);
}

/** 연간 재무 + 분기(Q4) BPS 보강 조회 — DB에 없는 연간 BPS는 분기말(=연말) BPS로 채운다. */
async function loadAnnualFinancials(ticker: string): Promise<AnnualFinancialRow[]> {
  const { rows } = await getDb().query(
    `SELECT fiscal_year, eps, bps, per, pbr, roe, is_estimate
     FROM stock_financials WHERE ticker = $1 AND fiscal_quarter IS NULL
     ORDER BY fiscal_year ASC`,
    [ticker],
  );
  return rows;
}

async function loadQ4BpsFallback(ticker: string): Promise<QuarterBpsRow[]> {
  const { rows } = await getDb().query(
    `SELECT fiscal_year, bps FROM stock_financials
     WHERE ticker = $1 AND fiscal_quarter = 4 AND bps IS NOT NULL
     ORDER BY fiscal_year ASC`,
    [ticker],
  );
  return rows;
}

/**
 * 밴드용 가격 시계열 — KIS 월봉 20년이 정본, 실패 시 Yahoo 5년 주봉으로 폴백한다.
 * KIS가 빈 배열을 주면(신규 상장 등) 폴백하지 않고 그대로 반환한다 — "조회 실패"와
 * "해당 구간에 데이터 없음"은 다르기 때문(`fetchKisDailyPrices`는 전자만 null).
 */
async function loadBandPrices(ticker: string, market: string): Promise<PricePoint[]> {
  const from = new Date();
  from.setFullYear(from.getFullYear() - KIS_BAND_YEARS);
  const kisRows = await fetchKisDailyPrices(ticker, {
    fromYmd: from.toISOString().slice(0, 10).replace(/-/g, ''),
    period: KIS_BAND_PERIOD,
  });

  const rows = kisRows ?? (await fetchYahooChart(ticker, market, PRICE_RANGE, PRICE_INTERVAL));
  return rows
    .filter((r): r is typeof r & { close: number } => r.close != null)
    .map((r) => ({ date: r.trade_date, close: r.close }));
}

export async function loadValuationBands(ticker: string): Promise<ValuationBandsResult> {
  const { rows: stockRows } = await getDb().query('SELECT market FROM stocks WHERE ticker = $1', [ticker]);
  const market = stockRows[0]?.market;
  if (!market) return { available: false, reason: '종목 정보를 찾을 수 없습니다.' };

  const annualRows = await loadAnnualFinancials(ticker);
  if (annualRows.length === 0) {
    return { available: false, reason: '재무 데이터가 없습니다.' };
  }

  // 주가 ÷ 주당가치 = 현재 배수. 주당가치가 없거나 적자(≤0)면 배수가 성립하지 않아 null.
  const ratioOf = (price: number | null, perShare: number | null): number | null =>
    price == null || perShare == null || perShare <= 0
      ? null
      : Math.round((price / perShare) * 100) / 100;

  const epsByYear: Record<number, number | null> = {};
  const bpsByYear: Record<number, number | null> = {};
  // 추정 연도는 밴드 "기준값"에선 빼되(과거 구간 왜곡 방지) 미래 연장선에는 쓴다
  const estEpsByYear: Record<number, number | null> = {};
  const estBpsByYear: Record<number, number | null> = {};
  let latestActual: AnnualFinancialRow | undefined;

  for (const r of annualRows) {
    if (r.is_estimate) {
      estEpsByYear[r.fiscal_year] = toNum(r.eps);
      estBpsByYear[r.fiscal_year] = toNum(r.bps);
      // 보간 기준에도 컨센서스를 포함한다 — 당해 연도는 확정치가 없으므로 직전 확정연도와
      // 당해 컨센서스 사이를 이어야 시장이 반영 중인 이익 성장을 밴드가 따라간다.
      epsByYear[r.fiscal_year] = toNum(r.eps);
      bpsByYear[r.fiscal_year] = toNum(r.bps);
    }
    // 밴드 기준값(EPS·BPS)도 **확정 연도만** 담는다. 배수는 확정 실적 PER/PBR(트레일링)에서
    // 뽑는데 기준값에 추정치를 섞으면 단위가 어긋나 밴드가 통째로 이탈한다 —
    // 실측(2026-07-25): 삼성전자 2026E EPS 46,664원 × 트레일링 배수 → 최저 밴드 589,366원으로
    // 주가 249,500원의 2.4배. 확정 기준으로 통일해 바로잡음(valuationBands.ts perShareAsOf).
    if (!r.is_estimate) {
      epsByYear[r.fiscal_year] = toNum(r.eps);
      bpsByYear[r.fiscal_year] = toNum(r.bps);
      latestActual = r;
    }
  }

  // 연간 행에 BPS가 없는 연도만 분기(Q4) BPS로 보강 — 재무상태표 시점값이라 Q4 말 BPS는
  // 연말 BPS와 사실상 같다(ingest.ts 주석 참고).
  const q4Rows = await loadQ4BpsFallback(ticker);
  for (const r of q4Rows) {
    if (bpsByYear[r.fiscal_year] == null) bpsByYear[r.fiscal_year] = toNum(r.bps);
  }

  // KIS 22개 회계연도로 과거 구간을 **연장**한다. 자체 수집분(DB)이 있는 연도는 그대로 두고
  // 비어 있는 연도만 채우는 이유: DB 값은 컨센서스·분기 보강까지 거친 큐레이션 결과이고
  // 화면의 다른 재무 표시와 같은 원천이라, 여기서만 다른 숫자가 나오면 안 되기 때문.
  const kisAnnual = await fetchKisAnnualFinancials(ticker);
  let extendedYears = 0;
  if (kisAnnual) {
    for (const r of kisAnnual) {
      if (epsByYear[r.fiscalYear] == null && r.eps != null) {
        epsByYear[r.fiscalYear] = r.eps;
        extendedYears += 1;
      }
      if (bpsByYear[r.fiscalYear] == null && r.bps != null) bpsByYear[r.fiscalYear] = r.bps;
    }
  }

  // 가격 원천은 KIS 월봉 20년이 정본, Yahoo 5년 주봉이 폴백.
  // 조회 실패는 여기서 잡지 않고 그대로 던진다 — 호출측(라우트)의 ttlCache가 실패를
  // 캐시하지 않도록(다음 요청에서 즉시 재시도) creditCache와 동일한 fail-soft 관례.
  const prices = await loadBandPrices(ticker, market);

  if (prices.length === 0) {
    return { available: false, reason: '가격 데이터를 사용할 수 없습니다.' };
  }

  // 배수는 **밴드를 그리는 것과 같은 기준**(주가 ÷ 연간 확정 EPS/BPS)의 시계열에서 뽑는다.
  // stock_financials.per/pbr(수집 시점 주가 기준, 연 4~5개)을 쓰면 밴드와 기준이 어긋나
  // 주가선이 밴드 밖으로 벗어난다 — 실사용 피드백 "밴드랑 주가가 하나도 안 맞아"의 원인.
  const perMultiples = computeQuantiles(computeRatioSeries(prices, epsByYear));
  const pbrMultiples = computeQuantiles(computeRatioSeries(prices, bpsByYear));
  const latestClose = prices.length > 0 ? prices[prices.length - 1].close : null;
  const latestDate = prices.length > 0 ? prices[prices.length - 1].date : null;

  // 확정 구간 밴드 뒤에 컨센서스(추정) 연도 점을 이어 붙여 밴드를 미래로 연장한다 —
  // "2028년 컨센서스까지 있는데 왜 안 그리냐"는 피드백 반영. 추정 구간은 응답의
  // forwardFrom(첫 추정 연도말 날짜)으로 클라이언트가 구분 표시한다.
  const withForward = (
    bands: ReturnType<typeof computePerBands>,
    estByYear: Record<number, number | null>,
  ) => bands.map((b) => ({
    ...b,
    series: [...b.series, ...computeForwardBandPoints(estByYear, b.multiple)],
  }));

  const perBands = withForward(computePerBands(prices, epsByYear, perMultiples), estEpsByYear);
  const pbrBands = withForward(computePbrBands(prices, bpsByYear, pbrMultiples), estBpsByYear);
  const forwardYears = Object.keys(estEpsByYear).map(Number).filter((y) => Number.isFinite(y)).sort();
  const pbrRoe = computePbrRoePoints(
    annualRows.map((r) => ({
      fiscalYear: r.fiscal_year,
      roe: toNum(r.roe),
      pbr: toNum(r.pbr),
      isEstimate: r.is_estimate,
    })),
  );

  logger.debug(
    `밸류에이션 밴드 (${ticker}): PER배수 ${perMultiples.length}개, PBR배수 ${pbrMultiples.length}개, ` +
    `가격 ${prices.length}점, PBR-ROE 점 ${pbrRoe.points.length}개, ` +
    `KIS 재무 연장 ${kisAnnual == null ? '조회실패' : `${extendedYears}개 연도`}`,
  );

  return {
    available: true,
    price: prices,
    perBands,
    pbrBands,
    pbrRoe,
    // 현재 배수는 **최신 종가 ÷ 최신 확정 EPS/BPS**로 직접 계산한다. stock_financials의
    // per/pbr은 수집 시점 주가 기준이라 지금 주가와 어긋나고, 그러면 "현재 PER n배 —
    // 하위/상위 n% 구간" 요약이 차트에서 주가선이 놓인 위치와 모순된다.
    // 밴드가 컨센서스로 연장된 구간의 시작 연도(없으면 null) — 클라이언트 안내 문구용
    forwardYears,
    current: {
      // 밴드와 같은 보간 기준으로 계산해야 "현재 PER n배"가 차트상 주가 위치와 일치한다
      per: ratioOf(latestClose, latestDate ? perShareInterpolated(epsByYear, latestDate) : null),
      pbr: ratioOf(latestClose, latestDate ? perShareInterpolated(bpsByYear, latestDate) : null),
      roe: toNum(latestActual?.roe ?? null),
    },
  };
}
