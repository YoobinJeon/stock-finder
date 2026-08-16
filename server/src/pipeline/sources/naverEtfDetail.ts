import axios from 'axios';
import iconv from 'iconv-lite';

/**
 * ETF 상세 데이터 소스 (네이버 비공식 API 2종).
 * - 일봉: fchart.stock.naver.com XML — ETF는 자체 DB에 없어 라이브로 조회 (당일 진행봉 포함)
 * - 분석: m.stock.naver.com etfAnalysis JSON — 운용사·보수·NAV·편입종목 top10·섹터 구성
 */

const FCHART_URL = 'https://fchart.stock.naver.com/sise.nhn';
const ANALYSIS_URL = (ticker: string) => `https://m.stock.naver.com/api/stock/${ticker}/etfAnalysis`;

const CANDLE_TTL = 2 * 60 * 1000;    // 일봉: 장중 당일봉 갱신 고려 2분
const ANALYSIS_TTL = 10 * 60 * 1000; // 편입종목·정보: 천천히 변함 10분

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

export interface Candle {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** fchart XML → 일봉 배열 (순수 함수). item data="YYYYMMDD|시|고|저|종|거래량" */
export function parseFchart(xml: string): Candle[] {
  const re = /<item data="(\d{8})\|([\d.]+)\|([\d.]+)\|([\d.]+)\|([\d.]+)\|(\d+)"/g;
  const out: Candle[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push({
      date: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`,
      open: Number(m[2]),
      high: Number(m[3]),
      low: Number(m[4]),
      close: Number(m[5]),
      volume: Number(m[6]),
    });
  }
  return out;
}

const candleCache = new Map<string, { candles: Candle[]; at: number }>();

/** 일봉 조회 (기본 280개 — MA120 계산에 충분). 2분 캐시, fail-soft. */
export async function fetchEtfCandles(ticker: string, count = 280): Promise<Candle[]> {
  const key = `${ticker}:${count}`;
  const cached = candleCache.get(key);
  if (cached && Date.now() - cached.at < CANDLE_TTL) return cached.candles;
  try {
    const res = await axios.get(FCHART_URL, {
      params: { symbol: ticker, timeframe: 'day', count, requestType: 0 },
      headers: UA,
      responseType: 'arraybuffer',
      timeout: 10000,
    });
    const candles = parseFchart(iconv.decode(Buffer.from(res.data), 'euc-kr'));
    if (candles.length > 0) candleCache.set(key, { candles, at: Date.now() });
    return candles;
  } catch {
    return cached?.candles ?? [];
  }
}

export interface EtfConstituent {
  ticker: string;
  name: string;
  weight: number | null; // %
}

export interface EtfAnalysis {
  summary: string | null;
  issuer: string | null;
  baseIndex: string | null;
  listedDate: string | null;   // YYYY-MM-DD
  marketValue: string | null;  // "26조 2,075억" (네이버 표기 그대로)
  totalNav: string | null;
  nav: number | null;
  totalFee: number | null;     // 총보수 (%)
  deviationPct: number | null; // 괴리율 (%)
  constituents: EtfConstituent[];
  sectors: Array<{ name: string; weight: number }>;
}

/** etfAnalysis JSON → 요약 구조 (순수 함수, 방어적 파싱) */
export function parseEtfAnalysis(json: unknown): EtfAnalysis {
  const d = (json ?? {}) as Record<string, any>;
  const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

  const listedRaw = typeof d.listedDate === 'string' && /^\d{8}$/.test(d.listedDate) ? d.listedDate : null;
  const deviation = num(d.deviationRate);

  return {
    summary: typeof d.etfSummary === 'string' ? d.etfSummary.replace(/<br\s*\/?>/g, '\n') : null,
    issuer: d.issuerName ?? null,
    baseIndex: d.etfBaseIndex ?? null,
    listedDate: listedRaw ? `${listedRaw.slice(0, 4)}-${listedRaw.slice(4, 6)}-${listedRaw.slice(6, 8)}` : null,
    marketValue: d.marketValue ?? null,
    totalNav: d.totalNav ?? null,
    nav: num(d.nav),
    totalFee: num(d.totalFee),
    deviationPct: deviation != null ? (d.deviationSign === '-' ? -deviation : deviation) : null,
    constituents: Array.isArray(d.etfTop10MajorConstituentAssets)
      ? d.etfTop10MajorConstituentAssets.map((c: any) => {
          // Number('')=0 이므로 빈 비중은 명시적으로 null 처리
          const w = String(c?.etfWeight ?? '').replace('%', '').trim();
          return {
            ticker: String(c?.itemCode ?? ''),
            name: String(c?.itemName ?? ''),
            weight: w === '' || w === 'null' ? null : num(w),
          };
        })
      : [],
    sectors: Array.isArray(d.sectorPortfolioList)
      ? d.sectorPortfolioList
          .map((s: any) => ({ name: String(s?.detailTypeCode ?? ''), weight: num(s?.weight) ?? 0 }))
          .filter((s: { weight: number }) => s.weight > 0)
      : [],
  };
}

const analysisCache = new Map<string, { data: EtfAnalysis; at: number }>();

/** ETF 분석(정보·편입종목) 조회. 10분 캐시, 실패 시 이전 캐시 또는 null. */
export async function fetchEtfAnalysis(ticker: string): Promise<EtfAnalysis | null> {
  const cached = analysisCache.get(ticker);
  if (cached && Date.now() - cached.at < ANALYSIS_TTL) return cached.data;
  try {
    const res = await axios.get(ANALYSIS_URL(ticker), { headers: UA, timeout: 10000 });
    const data = parseEtfAnalysis(res.data);
    analysisCache.set(ticker, { data, at: Date.now() });
    return data;
  } catch {
    return cached?.data ?? null;
  }
}

export interface MaFlags {
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  above20: boolean | null;  // 현재가가 20일선 위인가
  above60: boolean | null;  // 현재가가 60일선 위인가 — 중기 추세 생존 여부
  aligned: boolean | null;  // 정배열 (5 > 10 > 20 > 60 > 120)
  newHigh: boolean | null;  // 신고가 돌파 — 보유 구간(최대 252봉) 직전 고가 이상
  high52w: number | null;   // 직전 고가 (오늘 제외, 최대 252봉)
}

// 신고가 판정에 필요한 최소 봉 수 — 이보다 짧으면 "신고가"가 무의미 (신규상장 등)
const NEW_HIGH_MIN_BARS = 60;

/** 최신 종가 기준 이동평균·정배열/20일선·신고가 플래그 (순수 함수). 데이터 부족 구간은 null. */
export function calcMaFlags(candles: Candle[]): MaFlags {
  const closes = candles.map((c) => c.close);
  const ma = (period: number): number | null => {
    if (closes.length < period) return null;
    const slice = closes.slice(-period);
    return slice.reduce((s, v) => s + v, 0) / period;
  };
  const ma5 = ma(5);
  const ma10 = ma(10);
  const ma20 = ma(20);
  const ma60 = ma(60);
  const ma120 = ma(120);
  const last = closes.length > 0 ? closes[closes.length - 1] : null;

  // 신고가: 오늘 종가가 직전(오늘 제외, 최대 252봉) 고가 이상
  let newHigh: boolean | null = null;
  let high52w: number | null = null;
  if (candles.length >= NEW_HIGH_MIN_BARS && last != null) {
    const prevHighs = candles.slice(0, -1).slice(-252).map((c) => c.high);
    high52w = Math.max(...prevHighs);
    newHigh = last >= high52w;
  }

  return {
    ma5, ma10, ma20, ma60, ma120,
    above20: last != null && ma20 != null ? last > ma20 : null,
    above60: last != null && ma60 != null ? last > ma60 : null,
    aligned:
      ma5 != null && ma10 != null && ma20 != null && ma60 != null && ma120 != null
        ? ma5 > ma10 && ma10 > ma20 && ma20 > ma60 && ma60 > ma120
        : null,
    newHigh,
    high52w,
  };
}
