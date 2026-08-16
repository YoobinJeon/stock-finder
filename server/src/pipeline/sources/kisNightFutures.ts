import { num } from '../http';
import { logger } from '../../utils/logger';
import type { FuturesQuote } from './naverFutures';
import {
  getKisCreds,
  getKisToken,
  kisGet,
  kisHeaders,
  warnMissingKisEnvOnce,
} from './kisAuth';

/**
 * 코스피200 **야간선물** — KIS `[국내선물옵션] 선물옵션 시세`(`inquire-price`).
 *
 * 에서 2026-07-12에 보류했던 항목이다. 당시 사유는 두 가지였고 둘 다 해소됐다:
 *  - "키움 REST에 선물·옵션 카테고리 자체가 없다" → KIS에는 `domestic-futureoption`이 있다
 *  - "트레이딩뷰 EUREX:K2NI에 시세 피드가 없다(웹소켓 전용 추정)" → KIS는 REST로 준다
 *
 * **야간 세션은 별도 심볼이 아니라 `FID_COND_MRKT_DIV_CODE=CM`으로 갈린다**(2026-07-26 실측).
 * 같은 종목코드·같은 만기인데 세션별로 값이 다르다:
 * ```
 *                        주간(F)     야간(CM)
 * futs_prpr  현재가       1063.50     1034.05
 * futs_prdy_vrss 등락      -69.00      -29.45
 * futs_prdy_clpr 전일종가  1132.50     1121.00
 * futs_sdpr      기준가    1132.50     1063.50   ← 야간은 당일 주간 종가가 기준
 * acml_vol       거래량    142,105      25,397   ← 주간의 18%, 야간 세션의 전형
 * hts_otst_stpl_qty 미결제 160,745     160,314   ← 같은 종목이라는 근거
 * ```
 *
 * **등락 기준이 세션마다 다르다**: 야간의 `futs_prdy_vrss`는 전일 야간 종가(1121.00)가 아니라
 * **기준가 = 당일 주간 종가(1063.50)** 대비다(1034.05 - 1063.50 = -29.45). 야간 티커로서는
 * 이게 맞는 의미라 그대로 노출한다 — 주간 마감 이후의 오버나이트 변동을 보여준다.
 *
 * **함정 2개**(둘 다 실측으로 확인 — 구현에서 반드시 지켜야 한다):
 *  1. 응답 컨테이너가 `output`이 아니라 **`output1`**이다. `output`만 읽으면 모든 코드가 빈 값으로
 *     보여 "미지원"으로 오판한다.
 *  2. **잘못된 종목코드도 `rt_cd=0`·HTTP 200을 반환한다.** 유효성은 `rt_cd`가 아니라 시세 필드
 *     존재로 판정해야 한다 — 키움 `ka10013`의 "조용한 실패"와 같은 함정.
 *
 * 야간 세션은 평일 18:00~05:00 KST다. 그 밖의 시간에는 **직전 야간 세션 마감치**가 내려온다
 * (2026-07-26 토요일 조회에서 금요일 야간 마감치 확인). 매크로 티커의 다른 24시간 상품과
 * 같은 취급이라 별도 게이팅은 두지 않는다.
 */

const FUTOPT_PRICE_PATH = '/uapi/domestic-futureoption/v1/quotations/inquire-price';
const TR_ID = 'FHMIF10000000';
/** 야간 세션 시장구분코드 — 주간은 'F' */
const NIGHT_MARKET_DIV_CODE = 'CM';

/**
 * 원시 응답 → `FuturesQuote`로 파싱하는 순수 함수.
 * 시세 필드(`futs_prpr`)가 없으면 **무효 종목코드**로 보고 null을 반환한다 — `rt_cd`는 믿지 않는다.
 */
export function parseKisFuturesQuote(raw: unknown, itemCode: string): FuturesQuote | null {
  const obj = raw as { rt_cd?: unknown; output1?: unknown } | null | undefined;
  if (!obj || String(obj.rt_cd) !== '0') return null;

  const o = obj.output1 as Record<string, unknown> | undefined;
  if (!o || typeof o !== 'object') return null;

  const price = num(o.futs_prpr);
  if (price == null || price <= 0) return null; // 시세 없음 = 무효 코드 또는 미거래

  const change = num(o.futs_prdy_vrss) ?? 0;
  return {
    itemCode,
    name: String(o.hts_kor_isnm ?? itemCode),
    price,
    change,
    changePct: num(o.futs_prdy_ctrt) ?? 0,
    up: change >= 0,
  };
}

/**
 * 야간선물 시세 조회. 환경변수 미설정·토큰 실패·조회 실패 시 예외 대신 null을 반환한다
 * (fail-soft) — 매크로 티커는 항목별로 독립 실패해야 하므로 전체를 깨뜨리지 않는다.
 */
export async function fetchKisNightFutures(itemCode: string): Promise<FuturesQuote | null> {
  const creds = getKisCreds();
  if (!creds) {
    warnMissingKisEnvOnce('야간선물 조회');
    return null;
  }

  const token = await getKisToken(creds);
  if (!token) return null;

  const data = await kisGet(
    FUTOPT_PRICE_PATH,
    {
      headers: kisHeaders(creds, token, TR_ID),
      params: {
        FID_COND_MRKT_DIV_CODE: NIGHT_MARKET_DIV_CODE,
        FID_INPUT_ISCD: itemCode,
      },
    },
    `야간선물 ${itemCode}`,
  );
  if (data == null) return null;

  const quote = parseKisFuturesQuote(data, itemCode);
  if (quote == null) logger.warn(`KIS 야간선물 시세 없음 (${itemCode}) — 종목코드 확인 필요`);
  return quote;
}
