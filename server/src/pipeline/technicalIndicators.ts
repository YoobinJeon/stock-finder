/**
 * 기술 지표 순수 계산 함수 — MACD·볼린저밴드·ATR·OBV·거래대금 급증.
 * DB I/O 없음. ingest.ts의 computeIndicators()가 종목별로 호출해 stock_indicators에 반영한다.
 * 입력 배열은 trendIndicators와 동일하게 **최신순([0]=최신)** 을 가정하고, 내부에서 필요 시 뒤집는다.
 * 봉 수가 부족하면 null (상장 초기 종목 등).
 * (기술 지표 확장 — ARCHITECTURE.md 참고)
 */

/** 지수이동평균(EMA) 시리즈 — 입력은 오래된→최신(오름차순), 초기값은 첫 period의 SMA로 시드. */
function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period; // SMA 시드
  out.push(ema);
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * MACD(12/26/9) — macd=EMA12−EMA26, signal=macd의 EMA9, histogram=macd−signal.
 * 최소 26+9=35봉 필요. EMA 시드는 각 구간 첫 period의 SMA.
 */
export function calcMACD(closes: number[]): MacdResult | null {
  if (closes.length < 35) return null;
  const asc = [...closes].reverse(); // 오래된→최신
  const ema12 = emaSeries(asc, 12);
  const ema26 = emaSeries(asc, 26);
  // ema12가 ema26보다 길다(시작 시점 차이) — 뒤에서부터 정렬해 macd 라인 계산
  const offset = ema12.length - ema26.length;
  const macdLine: number[] = ema26.map((v, i) => ema12[i + offset] - v);
  const signalLine = emaSeries(macdLine, 9);
  if (signalLine.length === 0) return null;
  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return { macd, signal, histogram: macd - signal };
}

export interface BollingerResult {
  upper: number;
  mid: number;
  lower: number;
  pctB: number;  // (현재가−하단)/(상단−하단), 밴드폭 0이면 0.5
  bandwidth: number; // (상단−하단)/중심
}

/**
 * 볼린저밴드(기본 20, 2σ) — 최신 period 종가로 SMA·모표준편차 계산.
 * pctB는 현재가(closes[0])의 밴드 내 위치(0~1 근처), bandwidth는 밴드 폭 비율.
 */
export function calcBollinger(closes: number[], period = 20, mult = 2): BollingerResult | null {
  if (closes.length < period) return null;
  const window = closes.slice(0, period);
  const mid = window.reduce((s, v) => s + v, 0) / period;
  const variance = window.reduce((s, v) => s + (v - mid) ** 2, 0) / period; // 모분산
  const sd = Math.sqrt(variance);
  const upper = mid + mult * sd;
  const lower = mid - mult * sd;
  const price = closes[0];
  const width = upper - lower;
  const pctB = width > 0 ? (price - lower) / width : 0.5; // 밴드폭 0(무변동) → 중앙 0.5
  const bandwidth = mid !== 0 ? width / mid : 0;
  return { upper, mid, lower, pctB, bandwidth };
}

export interface AtrResult {
  atr: number;
  atrPct: number; // ATR을 현재가 대비 %로
}

/**
 * ATR(기본 14) — True Range = max(고−저, |고−전일종가|, |저−전일종가|)의 단순평균(SMA 방식, Wilder 아님).
 * highs/lows/closes는 최신순·동일 길이. atrPct는 현재가(closes[0]) 대비 %.
 */
export function calcATR(highs: number[], lows: number[], closes: number[], period = 14): AtrResult | null {
  const n = closes.length;
  if (n < period + 1 || highs.length !== n || lows.length !== n) return null;
  // 최신순이므로 i일의 전일종가는 closes[i+1]. TR은 전일이 있는 0..n-2 구간에서만 정의.
  const trs: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const prevClose = closes[i + 1];
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - prevClose),
      Math.abs(lows[i] - prevClose),
    );
    trs.push(tr);
  }
  const atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period; // 최신 period개 TR 평균
  const price = closes[0];
  const atrPct = price > 0 ? (atr / price) * 100 : 0;
  return { atr, atrPct };
}

export interface ObvResult {
  obv: number;
  trend: -1 | 0 | 1; // 최근 ~10봉 OBV 기울기 부호
}

/**
 * OBV(On-Balance Volume) — 종가 상승일 +거래량, 하락일 −거래량 누적.
 * trend는 현재 OBV와 약 10봉 전 OBV 비교 부호. closes/volumes는 최신순·동일 길이.
 */
export function calcOBV(closes: number[], volumes: number[]): ObvResult | null {
  const n = closes.length;
  if (n < 2 || volumes.length !== n) return null;
  const asc = [...closes].reverse();
  const vAsc = [...volumes].reverse();
  const obvSeries: number[] = [0];
  let obv = 0;
  for (let i = 1; i < asc.length; i++) {
    if (asc[i] > asc[i - 1]) obv += vAsc[i];
    else if (asc[i] < asc[i - 1]) obv -= vAsc[i];
    obvSeries.push(obv);
  }
  const last = obvSeries[obvSeries.length - 1];
  const backIdx = Math.max(0, obvSeries.length - 1 - 10);
  const prev = obvSeries[backIdx];
  const diff = last - prev;
  const trend: -1 | 0 | 1 = diff > 0 ? 1 : diff < 0 ? -1 : 0;
  return { obv: last, trend };
}

/**
 * 거래대금 급증 배수 — 당일 거래대금(종가×거래량) ÷ 직전 window(기본 20)일 평균 거래대금.
 * closes/volumes는 최신순·동일 길이. 당일 제외 직전 window봉으로 평균.
 */
export function calcTurnoverSurge(closes: number[], volumes: number[], window = 20): number | null {
  const n = closes.length;
  if (n < window + 1 || volumes.length !== n) return null;
  const today = closes[0] * volumes[0];
  let sum = 0;
  for (let i = 1; i <= window; i++) sum += closes[i] * volumes[i];
  const avg = sum / window;
  if (avg <= 0) return null;
  return today / avg;
}
