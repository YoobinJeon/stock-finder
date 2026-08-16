/**
 * PER 밴드 / PBR 밴드 / PBR-ROE 밴드 계산 — 순수 함수 모음(DB·네트워크 의존 없음).
 * 라우트(API)가 stock_financials·주가 이력을 조회해 이 함수들의 입력을 조립하고,
 * 여기서는 계산만 담당한다.
 *
 * 밴드값 = 회계연도별 EPS(또는 BPS) × 분위수 배수. 분위수(10/25/50/75/90%)를 쓰는 이유는
 * 종목마다 밸류에이션 레벨이 달라(성장주 vs 가치주) 고정 배수(예: "PER 10배")가 부적절하기
 * 때문 — 해당 종목 자신의 과거 PER/PBR 분포를 기준으로 삼는다.
 */

export interface PricePoint {
  date: string; // 'YYYY-MM-DD'
  close: number;
}

export interface BandMultiple {
  label: string;   // 예: 'P10' — 하위 10% 분위수
  multiple: number;
}

export interface BandSeriesPoint {
  date: string;
  value: number;
}

export interface BandSeries {
  label: string;
  multiple: number;
  series: BandSeriesPoint[];
}

export interface PbrRoeInput {
  fiscalYear: number;
  roe: number | null;
  pbr: number | null;
  isEstimate: boolean;
}

export interface PbrRoePoint {
  fiscalYear: number;
  roe: number;
  pbr: number;
  isEstimate: boolean;
}

export interface RegressionLine {
  slope: number;
  intercept: number;
}

export interface PbrRoeResult {
  points: PbrRoePoint[];
  fitLine: RegressionLine | null;
}

// 밴드 다섯 선(하위~상위 분포) — 종목 상세 UI가 이 개수·순서를 그대로 사용
/**
 * 밴드 분위수 — 관측 구간의 **최저(0)~최고(100)** 를 양 끝으로 둔다.
 * P10~P90으로 자르면 정의상 관측치의 20%가 밴드 밖으로 나가 "주가가 밴드와 안 맞는" 것처럼
 * 보인다(실사용 피드백). 밴드는 그 종목이 실제로 거쳐온 밸류에이션 범위를 감싸는 것이 목적이므로
 * 전 구간을 포함시킨다.
 */
const DEFAULT_PERCENTILES = [0, 25, 50, 75, 100] as const;

// 회귀선(적정 PBR = a×ROE + b)을 계산하기에 통계적으로 의미 있는 최소 연도 수
const MIN_REGRESSION_POINTS = 3;

/** 배수 반올림 자릿수(소수 2자리 — PER/PBR 표기 관례) */
function roundMultiple(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * 국내 상장사는 대부분 12월 결산이므로 가격 시점의 캘린더 연도를 그대로 회계연도로 매칭한다.
 * (분기 결산 등 예외는 이 단순화로 커버하지 않음 — 종목 상세 밴드는 근사치 표시가 목적)
 */
function fiscalYearOf(dateIso: string): number {
  return new Date(dateIso).getFullYear();
}

/**
 * 선형보간(R-7) 방식 백분위수. 0 이하·유효하지 않은 값은 분포 계산에서 제외한다 — 적자 연도의
 * PER/PBR은 의미가 없거나 소스가 음수/이상치로 내려오므로("없으면 기입하지 않음" 관례 연장).
 * 값이 하나도 남지 않으면 빈 배열(호출측은 밴드 없음으로 처리).
 */
export function computeQuantiles(
  values: readonly (number | null)[],
  percentiles: readonly number[] = DEFAULT_PERCENTILES,
): BandMultiple[] {
  const sorted = values
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return [];

  return percentiles.map((p) => {
    const rank = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(rank);
    const upper = Math.ceil(rank);
    const weight = rank - lower;
    const value = sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
    return { label: `P${p}`, multiple: roundMultiple(value) };
  });
}

// 확정 실적을 거슬러 찾을 최대 연수 — 이보다 오래된 값은 밴드 기준으로 쓰기에 부적절
const MAX_BASIS_LOOKBACK_YEARS = 5;

/**
 * 가격 시점(회계연도 year)에 적용할 주당가치(EPS·BPS)를 고른다.
 *
 * 배수(분위수)를 **확정 실적 기준 PER/PBR**에서 뽑으므로 곱하는 주당가치도 같은 기준이어야
 * 한다. 당해 연도는 아직 확정 실적이 없으므로(이듬해 초 공시) 그 이전 확정 연도 중 가장
 * 최근 값을 쓴다 — 트레일링 PER 밴드의 통상적 정의. 추정치를 섞으면 배수는 트레일링,
 * 기준값은 포워드가 되어 밴드가 통째로 어긋난다(실측: 삼성전자 밴드가 주가의 2~6배로 이탈).
 *
 * 가장 가까운 확정 연도의 값이 적자(≤0)면 PER이 성립하지 않으므로 null을 반환해 해당
 * 구간을 비운다(더 과거로 거슬러 올라가 흑자 연도를 쓰지 않는다 — 왜곡 방지).
 */
function perShareAsOf(
  perShareByYear: Readonly<Record<number, number | null | undefined>>,
  year: number,
): number | null {
  for (let y = year; y >= year - MAX_BASIS_LOOKBACK_YEARS; y -= 1) {
    const v = perShareByYear[y];
    if (v == null) continue;      // 그 해 데이터 자체가 없음 → 더 과거로
    return v > 0 ? v : null;      // 값이 있으면 그것으로 확정(적자면 밴드 없음)
  }
  return null;
}

/** 'YYYY-MM-DD'가 그 해에서 지나온 비율(0~1). 1/1은 0, 12/31은 약 1. */
function yearFraction(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0;
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return Math.min(1, Math.max(0, (Date.UTC(y, m - 1, d) - start) / (end - start)));
}

/**
 * 가격 시점의 주당가치를 **직전 연도말과 당해 연도말 값 사이 선형보간**으로 구한다.
 *
 * 연간 확정치만 계단식으로 쓰면 시장이 이미 반영 중인 이익 성장이 밴드에 안 잡혀 주가와
 * 크게 어긋난다(실측 000660: 2025 확정 기준 중앙 밴드 392,640원 vs 주가 1,759,000원, 반면
 * 2026 컨센서스 기준은 2,092,585원 — 사이에 주가가 있음). 확정연도와 컨센서스 연도를 잇는
 * 보간을 쓰면 네이버가 쓰는 TTM(최근 4분기 연환산)과 비슷하게 실적 흐름을 따라가고,
 * 연말마다 값이 5배씩 튀는 불연속도 사라진다.
 *
 * 양쪽 앵커 중 하나라도 없으면 있는 쪽 값을 쓰고(구간 끝), 값이 0 이하(적자)면 null.
 */
export function perShareInterpolated(
  perShareByYear: Readonly<Record<number, number | null | undefined>>,
  date: string,
): number | null {
  const year = Number(date.slice(0, 4));
  if (!Number.isFinite(year)) return null;

  const prev = perShareByYear[year - 1] ?? null;  // 직전 연도말 값
  const curr = perShareByYear[year] ?? null;      // 당해 연도말 값

  if (prev == null && curr == null) return perShareAsOf(perShareByYear, year);
  if (prev == null) return curr != null && curr > 0 ? curr : null;
  if (curr == null) return prev > 0 ? prev : null;
  if (curr <= 0) return null;   // 당해가 적자면 배수가 성립하지 않음 → 밴드 없음
  if (prev <= 0) return curr;   // 적자→흑자 전환: 부호가 바뀌는 보간은 무의미하므로 당해 값 사용

  const t = yearFraction(date);
  return prev + (curr - prev) * t;
}

/**
 * 가격 시계열 각 시점의 배수(주가 ÷ 주당가치)를 만든다.
 *
 * 밴드 배수(분위수)는 **밴드를 그릴 때와 같은 기준**으로 계산해야 주가선이 밴드 안에 놓인다.
 * 예전에는 배수를 `stock_financials.per`(수집 시점 주가 기준)에서 뽑고 밴드는 다른 EPS로
 * 그려서 둘이 어긋났고, 연간 행 4~5개뿐이라 분위수 표본도 지나치게 작았다. 가격 시점마다
 * 배수를 산출하면 표본이 수백 개가 되어 분포도 안정적이다.
 */
export function computeRatioSeries(
  prices: readonly PricePoint[],
  perShareByYear: Readonly<Record<number, number | null | undefined>>,
): number[] {
  return prices.reduce<number[]>((acc, p) => {
    const perShare = perShareInterpolated(perShareByYear, p.date);
    if (perShare == null) return acc;
    return [...acc, p.close / perShare];
  }, []);
}

/** PER 밴드·PBR 밴드가 공유하는 계산 — 회계연도별 주당가치(EPS 또는 BPS) × 배수. */
function computeBands(
  prices: readonly PricePoint[],
  perShareByYear: Readonly<Record<number, number | null | undefined>>,
  multiples: readonly BandMultiple[],
): BandSeries[] {
  return multiples.map(({ label, multiple }) => ({
    label,
    multiple,
    series: prices.reduce<BandSeriesPoint[]>((acc, p) => {
      const perShare = perShareInterpolated(perShareByYear, p.date);
      if (perShare == null) return acc; // 없거나 적자 연도 → 해당 구간 건너뜀
      return [...acc, { date: p.date, value: Math.round(perShare * multiple) }];
    }, []),
  }));
}

// 추정 연도의 밴드 점을 찍을 기준일 — 회계연도 말(12월 결산 가정)
const FORWARD_POINT_MONTH_DAY = '-12-31';

/**
 * 컨센서스(추정) 연도까지 밴드를 미래로 연장한 점들을 만든다.
 *
 * 과거 구간은 확정 EPS로 그리고, 여기서 만든 점을 이어 붙이면 "컨센서스가 맞을 경우 과거
 * 밸류에이션 배수에서 주가가 어디쯤일지"가 보인다(애널리스트 목표주가 산정과 같은 방식).
 * 배수는 과거 실적 기준이므로 추정 EPS에 곱하는 것은 의도된 조합이며, 화면에 추정 구간임을
 * 표시해 확정 구간과 구분한다.
 */
export function computeForwardBandPoints(
  estimateByYear: Readonly<Record<number, number | null | undefined>>,
  multiple: number,
): BandSeriesPoint[] {
  return Object.keys(estimateByYear)
    .map(Number)
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => a - b)
    .reduce<BandSeriesPoint[]>((acc, year) => {
      const perShare = estimateByYear[year];
      if (perShare == null || perShare <= 0) return acc; // 적자 추정 → 밴드 없음
      return [...acc, { date: `${year}${FORWARD_POINT_MONTH_DAY}`, value: Math.round(perShare * multiple) }];
    }, []);
}

/** PER 밴드 = 회계연도별 EPS × 과거 PER 분위수 배수. */
export function computePerBands(
  prices: readonly PricePoint[],
  epsByYear: Readonly<Record<number, number | null | undefined>>,
  multiples: readonly BandMultiple[],
): BandSeries[] {
  return computeBands(prices, epsByYear, multiples);
}

/** PBR 밴드 = 회계연도별 BPS × 과거 PBR 분위수 배수. */
export function computePbrBands(
  prices: readonly PricePoint[],
  bpsByYear: Readonly<Record<number, number | null | undefined>>,
  multiples: readonly BandMultiple[],
): BandSeries[] {
  return computeBands(prices, bpsByYear, multiples);
}

/** 최소제곱 선형회귀 — y(pbr) = slope * x(roe) + intercept. */
function leastSquares(points: readonly { x: number; y: number }[]): RegressionLine | null {
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null; // ROE가 전부 동일(분산 0) — 기울기 정의 불가

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/**
 * PBR-ROE 산점도 데이터 + 적정 PBR 회귀선(PBR = a×ROE + b). ROE·PBR이 모두 있는 연도만
 * 점으로 남기고, 그 중 3개 미만이면 회귀선을 계산하지 않는다(통계적으로 무의미).
 */
export function computePbrRoePoints(financialsByYear: readonly PbrRoeInput[]): PbrRoeResult {
  const points: PbrRoePoint[] = financialsByYear
    .filter((f): f is PbrRoeInput & { roe: number; pbr: number } => f.roe != null && f.pbr != null)
    .map((f) => ({ fiscalYear: f.fiscalYear, roe: f.roe, pbr: f.pbr, isEstimate: f.isEstimate }))
    .sort((a, b) => a.fiscalYear - b.fiscalYear);

  const fitLine = points.length >= MIN_REGRESSION_POINTS
    ? leastSquares(points.map((p) => ({ x: p.roe, y: p.pbr })))
    : null;

  return { points, fitLine };
}
