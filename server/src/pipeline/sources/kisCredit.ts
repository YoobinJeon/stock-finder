import { num, sleep } from '../http';
import { logger } from '../../utils/logger';
import { nullifyInteriorZeroRuns, type CreditTrendPoint } from './creditTrend';
import {
  getKisCreds,
  getKisToken,
  kisGet,
  kisHeaders,
  kisToday,
  kisYmdToIso,
  prevYmd,
  warnMissingKisEnvOnce,
} from './kisAuth';

/**
 * 한국투자증권(KIS) OpenAPI `[국내주식-110] 국내주식 신용잔고 일별추이` — 종목별 신용거래융자
 * 잔고 추이. HTS(eFriend Plus) [0476] 화면의 API판.
 *
 * 키움 `ka10013`을 대체한다(2026-07-26 전환). 근거는
 * `docs/superpowers/specs/2026-07-26-kis-source-migration-assessment.md`:
 *  - 키움이 간헐적으로 특정 구간 전체를 0으로 반환하던 결함 구간을 KIS는 정상값으로 반환
 *  - 키움 `dt`는 결제일(T+2)뿐이지만 KIS는 거래일·결제일을 모두 제공 → 차트 x축을 거래일로 정정
 *  - 대주(공매도) 잔고를 같은 응답에 포함
 *
 * 전 종목 배치는 하지 않는다 — 종목 상세를 열 때 온디맨드 조회하고 라우트가 TTL 캐시로 감싼다.
 */

const CREDIT_PATH = '/uapi/domestic-stock/v1/quotations/daily-credit-balance';
const TR_ID = 'FHPST04760000';
const SCR_DIV_CODE = '20476'; // 화면 분류 코드(고정)
const MARKET_DIV_CODE = 'J';  // 주식

// 1회 응답 최대 30건(공식 문서 명시). 3년치(약 735영업일)는 25페이지면 채워진다.
const ROWS_PER_PAGE = 30;
const MAX_PAGES = 26;

/**
 * 페이지 간 대기. 250ms였을 때 콜드 조회가 **7.3초**였고 그중 6.0초(82%)가 이 sleep이었다
 * (2026-07-26 실측: KIS 왕복 25회는 합쳐서 약 1.3초, 호출당 ~52ms).
 * kisAuth.kisGet이 이미 레이트리밋(EGW00201·HTTP 500)에 지수 백오프로 대응하므로 고정 지연은
 * 1차 완충이면 충분하다 — 100ms(≈10 req/s)로 낮춰 총 대기를 2.4초로 줄였다.
 * 초과가 실제로 발생하면 이 값을 되올리기 전에 백오프 로그(`KIS 요청 재시도 소진`)를 먼저 본다.
 */
const PAGE_DELAY_MS = 100;

/** KIS 잔고금액 단위 판정 — 만원. 키움 amt(백만원) × 100과 정확히 일치함을 실측 교차확인 */
const AMT_UNIT_KRW = 10_000;

/**
 * KIS 신용잔고 원시 응답 → 거래일 기준 최신일 우선 배열로 파싱하는 순수 함수.
 * `rt_cd !== '0'`, `output` 부재/비배열, 개별 필드 누락을 모두 방어하며 예외를 던지지 않는다.
 * `deal_date`가 없거나 형식이 어긋난 행은 건너뛴다.
 */
export function parseKisCreditTrend(raw: unknown): CreditTrendPoint[] {
  const obj = raw as { rt_cd?: unknown; output?: unknown } | null | undefined;
  if (!obj || String(obj.rt_cd) !== '0') return [];
  const rows = Array.isArray(obj.output) ? obj.output : [];

  return rows
    .map((r: Record<string, unknown>) => {
      const newQty = num(r?.whol_loan_new_stcn);
      const repaidQty = num(r?.whol_loan_rdmp_stcn);
      const amt = num(r?.whol_loan_rmnd_amt);
      return {
        date: kisYmdToIso(r?.deal_date),
        settlementDate: kisYmdToIso(r?.stlm_date),
        currentPrice: num(r?.stck_prpr),
        priceChange: num(r?.prdy_vrss),
        volume: num(r?.acml_vol),
        newQty,
        repaidQty,
        remainQty: num(r?.whol_loan_rmnd_stcn),
        remainAmt: amt == null ? null : Math.round(amt * AMT_UNIT_KRW),
        // KIS는 잔고 전일대비를 직접 주지 않는다 — 신규·상환 차이로 산출(둘 중 하나라도 없으면 null)
        changeQty: newQty == null || repaidQty == null ? null : newQty - repaidQty,
        shareRatio: num(r?.whol_loan_gvrt),
        remainRatio: num(r?.whol_loan_rmnd_rate),
        shortRemainQty: num(r?.whol_stln_rmnd_stcn),
        shortRemainRatio: num(r?.whol_stln_rmnd_rate),
      };
    })
    .filter((r): r is CreditTrendPoint => r.date != null)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * 종목의 신용거래융자 잔고 추이(최근 N영업일, **거래일** 최신순)를 조회한다.
 * 환경변수 미설정·토큰 실패·조회 실패 시 예외를 던지지 않고 null을 반환한다(fail-soft) —
 * 호출측(API 라우트)이 `available:false`로 응답하도록.
 */
export async function fetchKisCreditTrend(
  ticker: string,
  days: number,
): Promise<CreditTrendPoint[] | null> {
  const creds = getKisCreds();
  if (!creds) {
    warnMissingKisEnvOnce('신용잔고 조회');
    return null;
  }

  const token = await getKisToken(creds);
  if (!token) return null;

  try {
    const collected: CreditTrendPoint[] = [];
    const seen = new Set<string>();
    let anchor = kisToday();

    for (let page = 0; page < MAX_PAGES && collected.length < days; page += 1) {
      const data = await kisGet(
        CREDIT_PATH,
        {
          headers: kisHeaders(creds, token, TR_ID),
          params: {
            fid_cond_mrkt_div_code: MARKET_DIV_CODE,
            fid_cond_scr_div_code: SCR_DIV_CODE,
            fid_input_iscd: ticker,
            fid_input_date_1: anchor,
          },
        },
        `신용잔고 ${ticker}`,
      );
      if (data == null) break; // 재시도 소진 — 모은 만큼만 반환한다

      const parsed = parseKisCreditTrend(data);
      if (parsed.length === 0) break; // 더 과거 데이터 없음(또는 조회 실패) — 모은 만큼 반환

      // 페이지 경계에서 같은 날짜가 겹칠 수 있어 중복을 제거한다(anchor 포함 조회)
      let added = 0;
      for (const p of parsed) {
        if (seen.has(p.date)) continue;
        seen.add(p.date);
        collected.push(p);
        added += 1;
      }
      if (added === 0) break; // 진전이 없으면 무한 루프 방지

      // fid_input_date_1은 **결제일자** 파라미터다 — 거래일로 앵커를 잡으면 페이지 경계마다
      // T+2만큼 건너뛰어 날짜가 빠진다(2026-07-26 실측: 2026-06-09 누락). 결제일로 앵커링한다.
      const oldestRow = parsed[parsed.length - 1];
      const oldestSettlement = (oldestRow.settlementDate ?? oldestRow.date).replace(/-/g, '');
      anchor = prevYmd(oldestSettlement);
      if (parsed.length < ROWS_PER_PAGE) break; // 마지막 페이지
      await sleep(PAGE_DELAY_MS);
    }

    if (collected.length === 0) return null;
    // 원천이 무엇이든 "구간 통째로 0" 결함 방어는 유지한다(미검증 항목)
    return nullifyInteriorZeroRuns(collected.slice(0, days));
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    logger.warn(`KIS 신용잔고 조회 오류 (${ticker})${status ? ` status=${status}` : ''}`);
    return null;
  }
}
