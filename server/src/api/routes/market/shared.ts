import axios from 'axios';
import { logger } from '../../../utils/logger';

/**
 * market/ 라우트 모듈 전반에서 재사용하는 공유 상수·헬퍼(심볼 테이블·캐시·포맷터).
 * market.routes.ts 949줄 분리(순수 기계적 이동) 과정에서 추출 — 로직 변경 없음.
 */

/** 현재 KST가 장중(평일 09:00~15:40)인지 + "HH:MM" (movers/sectors/etf/themes 라우트에서 재사용) */
export function kstMarket(): { open: boolean; hhmm: string } {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const dow = kst.getUTCDay(); // 0=일 6=토
  const mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return {
    open: dow >= 1 && dow <= 5 && mins >= 9 * 60 && mins <= 15 * 60 + 40,
    hhmm: kst.toISOString().slice(11, 16),
  };
}

// 종목 실시간 시세 (네이버 폴링 API 일괄 조회) — 종목당 30초 캐시
export interface Quote { price: number; change: number; changePct: number; up: boolean }
const quoteCache = new Map<string, Quote & { at: number }>();
const QUOTE_TTL = 30 * 1000;

/** 티커 배열 → 실시간 시세 맵. 미캐시·만료분만 100개씩 일괄 조회 (30초 캐시). sectors/movers/globalPeers/themes 라우트에서 재사용. */
export async function fetchStockQuotes(tickers: string[]): Promise<Map<string, Quote>> {
  const now = Date.now();
  const stale = tickers.filter((t) => !quoteCache.has(t) || now - quoteCache.get(t)!.at > QUOTE_TTL);

  for (let i = 0; i < stale.length; i += 100) {
    const batch = stale.slice(i, i + 100);
    try {
      const { data } = await axios.get(
        `https://polling.finance.naver.com/api/realtime/domestic/stock/${batch.map(encodeURIComponent).join(',')}`,
        { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.naver.com/' }, timeout: 8000 },
      );
      const datas = data?.datas ?? data?.result?.areas?.[0]?.datas ?? [];
      const n = (s: string | undefined) => (s == null ? null : Number(String(s).replace(/,/g, '')));
      for (const s of datas) {
        const ticker = String(s.itemCode ?? '');
        const price = n(s.closePrice);
        if (price == null) continue;
        const change = n(s.compareToPreviousClosePrice) ?? 0;
        const changePct = n(s.fluctuationsRatio) ?? 0;
        quoteCache.set(ticker, { price, change, changePct, up: change >= 0, at: now });
      }
    } catch (e) { logger.warn('시세 배치 조회 실패 — 캐시 유지', e); }
  }

  const out = new Map<string, Quote>();
  for (const t of tickers) {
    const c = quoteCache.get(t);
    if (c) out.set(t, { price: c.price, change: c.change, changePct: c.changePct, up: c.up });
  }
  return out;
}

export const INDICES = [
  { key: 'kospi',  symbol: '%5EKS11', name: '코스피'  },
  { key: 'kosdaq', symbol: '%5EKQ11', name: '코스닥'  },
  { key: 'snp500', symbol: '%5EGSPC', name: 'S&P 500' },
  // — 글로벌 지수 4종 (2026-07-12)
  { key: 'nasdaq', symbol: '%5EIXIC', name: '나스닥'   },
  { key: 'dow',    symbol: '%5EDJI',  name: '다우'     },
  { key: 'nikkei', symbol: '%5EN225', name: '닛케이225' },
  { key: 'twse',   symbol: '%5ETWII', name: '대만 가권' },
];

/** 야후 파이낸스 차트 API에서 심볼 하나의 현재가·전일비를 조회 (지수/매크로/글로벌피어 라우트 공용). */
export async function fetchQuote(symbol: string) {
  const { data } = await axios.get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`,
    {
      // 5d로 넉넉히 받아 직전 거래일 종가를 안정적으로 확보 (주말·휴일 걸쳐도 2봉 이상)
      params: { interval: '1d', range: '5d' },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000,
    },
  );
  const result = data?.chart?.result?.[0];
  if (!result) return null;

  const meta = result.meta ?? {};
  const closes: number[] = (result.indicators?.quote?.[0]?.close ?? []).filter((c: number) => c != null);

  // 현재가: 실시간 체결가(regularMarketPrice) 우선 — 장중 1분 폴링에 바로 반응.
  // 없으면 최신 일봉 종가로 폴백.
  const current = meta.regularMarketPrice ?? closes[closes.length - 1];
  if (current == null) return null;

  // 전일 종가: 오늘 진행 중인 일봉을 제외한 직전 거래일 종가.
  // (meta.chartPreviousClose는 지수에서 종종 며칠 밀린 값이 와서 쓰지 않음)
  const prev = closes.length >= 2 ? closes[closes.length - 2] : (meta.chartPreviousClose ?? current);
  const change = current - prev;
  const changePct = prev !== 0 ? (change / prev) * 100 : 0;

  return {
    price:     current,
    change:    change,
    changePct: changePct,
    up:        change >= 0,
    asOf:      meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
    // 글로벌 피어 보드용 — 응답 통화. 지수·매크로 티커는 사용하지 않음(옵셔널 필드로 무해).
    currency:  typeof meta.currency === 'string' ? meta.currency : null,
  };
}

// ── 매크로 티커 (글로벌 지표 — 대부분 24시간 거래라 장중 게이팅 없음) ──

export const MACRO_ITEMS: Array<{ key: string; symbol: string; name: string; unit: 'pct' | null; scale: number }> = [
  { key: 'nasdaqFut', symbol: 'NQ%3DF',  name: '나스닥선물', unit: null,  scale: 1 },
  { key: 'snpFut',    symbol: 'ES%3DF',  name: 'S&P500선물', unit: null,  scale: 1 },
  { key: 'vix',       symbol: '%5EVIX',  name: 'VIX',        unit: null,  scale: 1 },
  { key: 'usdkrw',    symbol: 'KRW%3DX', name: '달러/원',    unit: null,  scale: 1 },
  { key: 'wti',       symbol: 'CL%3DF',  name: 'WTI',        unit: null,  scale: 1 },
  { key: 'gold',      symbol: 'GC%3DF',  name: '금',         unit: null,  scale: 1 },
  // 국채 수익률 3종 — chart API가 %단위 수익률을 그대로 주므로 보정 불필요(2026-07 ^TNX 4.54 실측).
  // ⚠️ 2년물은 야후에 **현물 지수가 없다**(^UST2YR 등 미존재, 2026-08-04 확인). CBOT 2년 수익률
  // 선물(2YY=F, 근월 연결)이 유일한 경로라 이걸 쓴다 — 현물과 미세한 차이가 있을 수 있다.
  { key: 'us2y',      symbol: '2YY%3DF', name: '美2년물',    unit: 'pct', scale: 1 },
  { key: 'us10y',     symbol: '%5ETNX',  name: '美10년물',   unit: 'pct', scale: 1 },
  { key: 'us30y',     symbol: '%5ETYX',  name: '美30년물',   unit: 'pct', scale: 1 },
  { key: 'sox',       symbol: '%5ESOX',  name: '필라델피아반도체', unit: null, scale: 1 },
];

// 국내 선물 — 야후 미제공이라 네이버 실시간 폴링으로 별도 조회 (2026-07-12).
// 코스피200 야간선물(EUREX)은 트레이딩뷰에 심볼은 있으나 시세 피드가 없어(웹소켓 전용 추정) 확보 실패 —
// 소스가 확보되면 확장 가능.
export const MACRO_FUTURES_ITEMS: Array<{ key: string; itemCode: string; name: string }> = [
  { key: 'k200Fut', itemCode: 'FUT', name: 'K200선물' },
];

// 코스닥150 선물 — 네이버 소비자 API에 상품이 없어 트레이딩뷰 scanner API로 별도 조회 (2026-07-12).
export const MACRO_TV_FUTURES_ITEMS: Array<{ key: string; ticker: string; name: string }> = [
  { key: 'kosdaqFut', ticker: 'KRX:KQI1!', name: '코스닥선물' },
];

/**
 * 코스피200 야간선물 — KIS `inquire-price`의 야간 세션 구분코드(`CM`)로 조회 (잔여 해소, 2026-07-26).
 * 네이버 소비자 API·트레이딩뷰 scanner 어느 쪽에도 시세 피드가 없어 보류돼 있던 항목이다.
 * `iscd`는 근월물 연결 코드 — 실측에서 `F 202609`(최종거래일 20260910)를 반환했다.
 */
export const MACRO_KIS_FUTURES_ITEMS: Array<{ key: string; iscd: string; name: string }> = [
  { key: 'k200NightFut', iscd: '10100000', name: 'K200야간' },
];

/** 오늘 봉(장중 실시간 OHLCV) — mergeTodayBar 주입용. Candle과 동일 shape. */
export interface TodayBar { date: string; open: number; high: number; low: number; close: number; volume: number }

const kstDateStr = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** 네이버 realtime 단일 종목 datas 원소 → 오늘 봉. 순수함수(테스트용 export). OHL 누락 시 close 폴백. */
export function parseTodayBar(s: any): TodayBar | null {
  const n = (v: any) => (v == null ? null : Number(String(v).replace(/,/g, '')));
  const close = n(s.closePrice);
  if (close == null) return null;
  const date = s.localTradedAt ? String(s.localTradedAt).slice(0, 10) : kstDateStr();
  return {
    date,
    open: n(s.openPrice) ?? close,
    high: n(s.highPrice) ?? close,
    low: n(s.lowPrice) ?? close,
    close,
    volume: n(s.accumulatedTradingVolume) ?? 0,
  };
}

// fetchStockQuotes와 별도 캐시(그 함수 동작을 건드리지 않기 위함) — 같은 네이버 엔드포인트, 30초.
const todayBarCache = new Map<string, TodayBar & { at: number }>();

/** 티커 배열 → 오늘 봉 맵. 미캐시·만료분만 100개씩 일괄 조회(30초 캐시). 실패 배치는 fail-soft. */
export async function fetchTodayBar(tickers: string[]): Promise<Map<string, TodayBar>> {
  const now = Date.now();
  const stale = tickers.filter((t) => !todayBarCache.has(t) || now - todayBarCache.get(t)!.at > QUOTE_TTL);

  for (let i = 0; i < stale.length; i += 100) {
    const batch = stale.slice(i, i + 100);
    try {
      const { data } = await axios.get(
        `https://polling.finance.naver.com/api/realtime/domestic/stock/${batch.map(encodeURIComponent).join(',')}`,
        { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.naver.com/' }, timeout: 8000 },
      );
      const datas = data?.datas ?? data?.result?.areas?.[0]?.datas ?? [];
      for (const s of datas) {
        const ticker = String(s.itemCode ?? '');
        const bar = parseTodayBar(s);
        if (ticker && bar) todayBarCache.set(ticker, { ...bar, at: now });
      }
    } catch (e) { logger.warn('당일봉 배치 조회 실패 — 캐시 유지', e); }
  }

  const out = new Map<string, TodayBar>();
  for (const t of tickers) {
    const c = todayBarCache.get(t);
    if (c) out.set(t, { date: c.date, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
  }
  return out;
}
