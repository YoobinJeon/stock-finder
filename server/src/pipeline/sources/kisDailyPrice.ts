import { num, sleep } from '../http';
import { logger } from '../../utils/logger';
import type { DailyPrice } from './yahooPrices';
import {
  getKisCreds,
  getKisToken,
  kisGet,
  kisHeaders,
  kisToday,
  kisYmdToIso,
  prevYmd,
  toKisYmd,
  warnMissingKisEnvOnce,
} from './kisAuth';

/**
 * 한국투자증권(KIS) OpenAPI `[국내주식-010] 국내주식기간별시세(일/주/월/년)` — 일봉 시세.
 *
 * Yahoo Finance 비공식 차트 API를 대체한다(2026-07-26 Phase 2). 근거는
 * `docs/superpowers/specs/2026-07-26-kis-source-migration-assessment.md` 와 이번 실측:
 *  - **Yahoo는 거래일을 통째로 빠뜨린다.** 6개 종목 전부에서 2025-09-19가 결측이었고 KIS에는 있다.
 *  - 종가는 242영업일 중 1~4일만 어긋나며(최대 편차 2%), 공식 원천인 KIS를 정본으로 삼는다.
 *
 * **`FID_ORG_ADJ_PRC`의 의미가 직관과 반대다(실측 확인).**
 *  - `'0'` → 수정주가. 005930 2018-04-20 종가 51,620원(= 원주가 2,581,000 ÷ 50), 거래량도 ×50 조정
 *  - `'1'` → 원주가. 같은 날 2,581,000원
 * 이 반전을 `KisPriceMode`로 이름 붙여 호출측이 헷갈리지 않게 한다.
 */

const CHART_PATH = '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
const TR_ID = 'FHKST03010100';
const MARKET_DIV_CODE = 'J'; // 주식

/** 봉 단위 — 일/주/월. 100행 상한이 봉 단위로 걸리므로 20년 조회는 월봉이라야 3콜에 들어온다. */
export type KisPeriod = 'D' | 'W' | 'M';

/** 1회 응답 최대 100행(실측: 1년 구간을 요청해도 100행에서 잘림). 1년치는 3페이지. */
const ROWS_PER_PAGE = 100;
const MAX_PAGES = 12; // 100행 × 12 ≈ 4.7년 — 무한 루프 방지용 상한
const PAGE_DELAY_MS = 120;

/** 수정주가(기업행위 소급 반영) / 원주가(당시 실제 호가) */
export type KisPriceMode = 'adjusted' | 'original';

const MODE_PARAM: Record<KisPriceMode, string> = { adjusted: '0', original: '1' };

/**
 * 원시 응답 `output2` → `DailyPrice[]`(과거→최신 오름차순)로 파싱하는 순수 함수.
 * `rt_cd !== '0'`, `output2` 부재/비배열, 개별 필드 누락을 모두 방어하며 예외를 던지지 않는다.
 * 종가가 없는 행은 시세로 쓸 수 없으므로 건너뛴다(Yahoo 파서와 동일 규칙).
 */
export function parseKisDailyPrices(raw: unknown): DailyPrice[] {
  const obj = raw as { rt_cd?: unknown; output2?: unknown } | null | undefined;
  if (!obj || String(obj.rt_cd) !== '0') return [];
  const rows = Array.isArray(obj.output2) ? obj.output2 : [];

  return rows
    .map((r: Record<string, unknown>) => ({
      trade_date: kisYmdToIso(r?.stck_bsop_date),
      open: num(r?.stck_oprc),
      high: num(r?.stck_hgpr),
      low: num(r?.stck_lwpr),
      close: num(r?.stck_clpr),
      volume: num(r?.acml_vol),
    }))
    .filter((r): r is DailyPrice => r.trade_date != null && r.close != null)
    .sort((a, b) => (a.trade_date < b.trade_date ? -1 : a.trade_date > b.trade_date ? 1 : 0));
}

async function fetchPage(
  creds: { appKey: string; appSecret: string },
  token: string,
  ticker: string,
  fromYmd: string,
  toYmd: string,
  mode: KisPriceMode,
  period: KisPeriod,
): Promise<DailyPrice[] | null> {
  const data = await kisGet(
    CHART_PATH,
    {
      headers: kisHeaders(creds, token, TR_ID),
      params: {
        FID_COND_MRKT_DIV_CODE: MARKET_DIV_CODE,
        FID_INPUT_ISCD: ticker,
        FID_INPUT_DATE_1: fromYmd,
        FID_INPUT_DATE_2: toYmd,
        FID_PERIOD_DIV_CODE: period,
        FID_ORG_ADJ_PRC: MODE_PARAM[mode],
      },
    },
    `시세 ${ticker} ${period}/${mode}`,
  );
  // 재시도까지 소진해 null이면 "조회 실패"다 — 빈 배열(데이터 없음)과 구분해 위로 전파한다.
  if (data == null) return null;
  return parseKisDailyPrices(data);
}

export interface KisDailyPriceOptions {
  /** 조회 시작일 'YYYYMMDD'. 생략 시 `days`로 역산 */
  fromYmd?: string;
  /** 조회 종료일 'YYYYMMDD'. 생략 시 오늘(KST) */
  toYmd?: string;
  /** fromYmd 미지정 시 오늘로부터 소급할 달력 일수 */
  days?: number;
  /** 기본 'adjusted'(수정주가) */
  mode?: KisPriceMode;
  /** 봉 단위. 기본 'D'(일봉) */
  period?: KisPeriod;
}

/** fromYmd 미지정 시 소급할 기본 달력 일수 — 1년 일봉(약 245영업일)을 여유 있게 덮는다. */
const DEFAULT_LOOKBACK_DAYS = 400;

function resolveRange(opts: KisDailyPriceOptions): { fromYmd: string; toYmd: string } {
  const toYmd = opts.toYmd ?? kisToday();
  if (opts.fromYmd) return { fromYmd: opts.fromYmd, toYmd };
  const from = new Date();
  from.setDate(from.getDate() - (opts.days ?? DEFAULT_LOOKBACK_DAYS));
  return { fromYmd: toKisYmd(from), toYmd };
}

/**
 * 종목의 일봉을 구간 전체에 대해 조회한다(과거→최신 오름차순).
 * 1회 100행 상한이 있어 종료일을 뒤로 밀며 페이징한다.
 *
 * 환경변수 미설정·토큰 실패·조회 실패 시 예외를 던지지 않고 **null**을 반환한다(fail-soft).
 * 빈 배열(`[]`)과 구분되는 값이라는 점이 중요하다 — 호출측은 null일 때만 Yahoo로 폴백하고,
 * 빈 배열은 "KIS가 정상 응답했으나 해당 구간에 데이터 없음"(신규 상장·상장폐지)으로 다룬다.
 */
export async function fetchKisDailyPrices(
  ticker: string,
  opts: KisDailyPriceOptions = {},
): Promise<DailyPrice[] | null> {
  const creds = getKisCreds();
  if (!creds) {
    warnMissingKisEnvOnce('일봉 시세 조회');
    return null;
  }

  const token = await getKisToken(creds);
  if (!token) return null;

  const mode = opts.mode ?? 'adjusted';
  const period = opts.period ?? 'D';
  const { fromYmd, toYmd } = resolveRange(opts);

  try {
    const byDate = new Map<string, DailyPrice>();
    let cursor = toYmd;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const rows = await fetchPage(creds, token, ticker, fromYmd, cursor, mode, period);
      // 페이지 하나라도 실패하면 구간이 뚫린 채 저장될 수 있다 — 부분 결과를 쓰느니
      // null로 알려 호출측이 폴백하게 한다.
      if (rows == null) return null;
      if (rows.length === 0) break;

      const before = byDate.size;
      for (const r of rows) byDate.set(r.trade_date, r);
      if (byDate.size === before) break; // 진전 없음 — 무한 루프 방지

      // rows는 오름차순 — 가장 과거 행이 다음 페이지의 기준점
      const oldest = rows[0].trade_date.replace(/-/g, '');
      if (oldest <= fromYmd || rows.length < ROWS_PER_PAGE) break;
      cursor = prevYmd(oldest);
      await sleep(PAGE_DELAY_MS);
    }

    return [...byDate.values()].sort((a, b) =>
      a.trade_date < b.trade_date ? -1 : a.trade_date > b.trade_date ? 1 : 0,
    );
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    logger.warn(`KIS 일봉 조회 오류 (${ticker})${status ? ` status=${status}` : ''}`);
    return null;
  }
}

export interface KisAdjustmentEvent {
  /** 조정이 적용된 첫 거래일 'YYYY-MM-DD' — 이 날부터 원주가와 수정주가가 같아진다 */
  date: string;
  /** 조정 배수(원주가 ÷ 수정주가). 액면분할 50:1이면 50, 액면병합 1:2면 0.5 */
  factor: number;
}

/** 두 계열의 종가가 사실상 같다고 볼 허용 오차 — 수정주가 반올림 때문에 완전 일치하지 않는다. */
const FACTOR_EQUAL_TOLERANCE = 0.02;

/**
 * 두 계열의 종가 비율이 바뀌는 지점을 뽑아내는 순수 함수.
 *
 * 스펙 는 `flng_cls_code`·`prtt_rate`가 기업행위를 알려줄 것으로 봤으나, 액면분할 3건
 * (삼성전자 50:1 / NAVER 5:1 / 카카오 5:1)을 실측한 결과 **모두 `00`·`0.00`으로 비어 있었다.**
 * 그래서 그 필드 대신 수정주가·원주가 두 계열의 종가 비율을 쓴다 — 이쪽은 실측으로 확인된다:
 *
 * ```
 * 005930  2018-04-25  원주가 2,650,000 / 수정주가 53,000 = 50.0   ← 조정 구간
 * 005930  2018-05-04  원주가    51,900 / 수정주가 51,900 =  1.0   ← 조정 완료 시점
 * ```
 *
 * 비율이 1.0에서 벗어난 구간이 곧 소급 조정 구간이고, 비율이 조정 배수다.
 * 추측이 아니라 원천이 주는 두 계열의 차이이므로 `priceRepair`의 ±30% 휴리스틱을 대체한다.
 *
 * 공통 거래일만 비교하며, 종가가 0 이하인 날은 비율 산출이 불가능하므로 건너뛴다.
 */
export function diffAdjustmentSeries(
  adjusted: readonly DailyPrice[],
  original: readonly DailyPrice[],
): KisAdjustmentEvent[] {
  const origByDate = new Map(original.map((r) => [r.trade_date, r]));

  const ratios: { date: string; ratio: number }[] = [];
  for (const a of adjusted) {
    const o = origByDate.get(a.trade_date);
    if (!o || a.close == null || o.close == null || a.close <= 0) continue;
    ratios.push({ date: a.trade_date, ratio: o.close / a.close });
  }
  if (ratios.length < 2) return [];

  const events: KisAdjustmentEvent[] = [];
  for (let i = 1; i < ratios.length; i += 1) {
    const prev = ratios[i - 1].ratio;
    const curr = ratios[i].ratio;
    // 비율이 유지되면 기업행위 없음. 바뀌는 순간이 조정이 끝나는 첫 거래일이다.
    if (Math.abs(curr - prev) <= FACTOR_EQUAL_TOLERANCE * Math.max(prev, curr)) continue;
    events.push({ date: ratios[i].date, factor: Number(prev.toFixed(4)) });
  }
  return events;
}

/**
 * 수정주가·원주가를 함께 조회해 **기업행위를 사실로 감지한다.**
 * 조회 실패 시 null(판정 불가), 기업행위가 없으면 빈 배열을 반환한다 — 둘을 구분해야
 * 호출측이 "확인 결과 없음"과 "확인 못 함"을 다르게 다룰 수 있다.
 */
export async function detectKisAdjustments(
  ticker: string,
  opts: KisDailyPriceOptions = {},
): Promise<KisAdjustmentEvent[] | null> {
  const [adjusted, original] = await Promise.all([
    fetchKisDailyPrices(ticker, { ...opts, mode: 'adjusted' }),
    fetchKisDailyPrices(ticker, { ...opts, mode: 'original' }),
  ]);
  if (!adjusted || !original) return null;

  return diffAdjustmentSeries(adjusted, original);
}
