import axios from 'axios';
import { logger } from '../../utils/logger';

/**
 * 한국투자증권(KIS) OpenAPI 공용 인증·요청 계층.
 *
 * 토큰 캐시를 모듈 단위로 공유하는 것이 이 파일의 존재 이유다 — KIS는 접근토큰 발급을
 * **1분당 1회**로 제한한다(초과 시 403 `EGW00133`). 수집원마다 캐시를 따로 두면 두 번째
 * 수집원이 뜨는 순간 발급이 막히고, 그 뒤로는 서로의 쿨다운에 계속 걸린다.
 * 신용잔고(`kisCredit`)·일별시세(`kisDailyPrice`)가 모두 여기를 거친다.
 */

export const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';
const TOKEN_PATH = '/oauth2/tokenP';

export const KIS_TIMEOUT_MS = 15000;

const TOKEN_ISSUE_COOLDOWN_MS = 70 * 1000;
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000; // 만료 10분 전 미리 갱신
const DEFAULT_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 만료 파싱 실패 시 보수적 폴백

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface KisCreds {
  appKey: string;
  appSecret: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;
let lastIssueAttemptAt = 0;
let warnedMissingEnv = false;

export function getKisCreds(): KisCreds | null {
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  return appKey && appSecret ? { appKey, appSecret } : null;
}

/** 환경변수 미설정 경고를 프로세스당 1회만 남긴다 — 전 종목 루프에서 로그가 범람하지 않도록. */
export function warnMissingKisEnvOnce(context: string): void {
  if (warnedMissingEnv) return;
  warnedMissingEnv = true;
  logger.warn(`KIS_APP_KEY/KIS_APP_SECRET 미설정 — ${context}를 건너뜁니다.`);
}

/** 'YYYY-MM-DD HH:mm:ss'(KST) → epoch ms. 형식이 어긋나면 null(호출측이 기본 TTL로 폴백) */
export function parseKisExpiry(v: unknown): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(v ?? ''));
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - KST_OFFSET_MS;
}

/**
 * 캐시된 접근토큰을 반환하고, 없거나 만료가 임박하면 발급한다.
 * 발급 쿨다운(70초) 안에서는 아예 시도하지 않는다 — 실패 직후 재시도가 제한을 더 오래 끌기 때문.
 * 발급 실패 시 예외 대신 null을 반환한다(fail-soft): 호출측이 조회를 건너뛰도록.
 */
export async function getKisToken(creds: KisCreds): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken.value;
  }
  if (Date.now() - lastIssueAttemptAt < TOKEN_ISSUE_COOLDOWN_MS) {
    // 쿨다운 중 — 만료 임박한 토큰이라도 있으면 그걸 쓰고, 없으면 조회를 포기한다.
    return cachedToken?.value ?? null;
  }
  lastIssueAttemptAt = Date.now();

  try {
    const { data } = await axios.post(
      `${KIS_BASE_URL}${TOKEN_PATH}`,
      { grant_type: 'client_credentials', appkey: creds.appKey, appsecret: creds.appSecret },
      { headers: { 'Content-Type': 'application/json' }, timeout: KIS_TIMEOUT_MS },
    );
    if (!data?.access_token) {
      logger.warn('KIS 토큰 발급 응답에 access_token 없음');
      return null;
    }
    const expiresAt =
      parseKisExpiry(data.access_token_token_expired) ?? Date.now() + DEFAULT_TOKEN_TTL_MS;
    cachedToken = { value: data.access_token, expiresAt };
    return cachedToken.value;
  } catch (e: unknown) {
    // 토큰·시크릿은 어떤 경우에도 로그에 남기지 않는다 — 에러 코드만 기록
    const code = (e as { response?: { data?: { error_code?: string } } })?.response?.data
      ?.error_code;
    logger.warn(`KIS 토큰 발급 실패${code ? ` (${code})` : ''} — 다음 요청에서 재시도`);
    return null;
  }
}

/** 인증 헤더 조립 — 호출측이 tr_id만 넘기면 되도록. */
export function kisHeaders(creds: KisCreds, token: string, trId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    authorization: `Bearer ${token}`,
    appkey: creds.appKey,
    appsecret: creds.appSecret,
    tr_id: trId,
    custtype: 'P',
  };
}

/**
 * 레이트리밋·일시 장애로 재시도할 가치가 있는 응답인지 판정한다.
 * KIS는 초당 거래건수 초과를 `EGW00201`로 알리지만, 실측(2026-07-26)에서는 연속 조회 중
 * **HTTP 500**으로 떨어지는 경우도 확인됐다. 그래서 상태코드와 메시지코드를 함께 본다.
 */
export function isRetryableKisError(status: number | undefined, msgCd: string | undefined): boolean {
  if (msgCd === 'EGW00201') return true;
  if (status == null) return true; // 네트워크 오류·타임아웃
  return status === 429 || status >= 500;
}

const RETRY_MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 600;

/** 지수 백오프 대기 시간 — 시도 회차(0-based)에 따라 600ms → 1.2s → 2.4s */
export function kisRetryDelayMs(attempt: number): number {
  return RETRY_BASE_DELAY_MS * 2 ** attempt;
}

/**
 * KIS GET 요청 + 지수 백오프 재시도. 성공 시 응답 본문을, 재시도를 모두 소진하면 null을 반환한다.
 *
 * 스펙 이 요구한 백오프다 — 전 종목 배치(2,766종목 × 3콜 ≈ 8,300콜)에서 재시도가 없으면
 * 레이트리밋 한 번에 해당 종목이 통째로 결측이 된다.
 * 재시도 불가 오류(400·401 등)는 즉시 포기한다 — 반복해도 결과가 같고 한도만 소모하기 때문.
 */
export async function kisGet(
  path: string,
  config: { headers: Record<string, string>; params: Record<string, unknown> },
  label: string,
): Promise<unknown | null> {
  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt += 1) {
    let status: number | undefined;
    let msgCd: string | undefined;

    try {
      const { data } = await axios.get(`${KIS_BASE_URL}${path}`, {
        ...config,
        timeout: KIS_TIMEOUT_MS,
      });
      msgCd = (data as { msg_cd?: string })?.msg_cd;
      if (String((data as { rt_cd?: unknown })?.rt_cd) === '0') return data;
      // rt_cd가 0이 아닌데 재시도 가치가 없으면(잘못된 종목코드 등) 그대로 돌려준다 —
      // 호출측 파서가 빈 배열로 처리하도록.
      if (!isRetryableKisError(undefined, msgCd)) return data;
    } catch (e: unknown) {
      const res = (e as { response?: { status?: number; data?: { msg_cd?: string } } })?.response;
      status = res?.status;
      msgCd = res?.data?.msg_cd;
      if (!isRetryableKisError(status, msgCd)) {
        logger.warn(`KIS 요청 실패 (${label}) status=${status ?? '-'} msg_cd=${msgCd ?? '-'}`);
        return null;
      }
    }

    if (attempt < RETRY_MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, kisRetryDelayMs(attempt)));
    } else {
      logger.warn(
        `KIS 요청 재시도 소진 (${label}) status=${status ?? '-'} msg_cd=${msgCd ?? '-'}`,
      );
    }
  }
  return null;
}

/** 'YYYYMMDD' → 'YYYY-MM-DD'. 형식 불량이면 null */
export function kisYmdToIso(v: unknown): string | null {
  const s = String(v ?? '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

/** Date → 'YYYYMMDD'(KST 기준) */
export function toKisYmd(d: Date): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, '');
}

export function kisToday(): string {
  return toKisYmd(new Date());
}

/** 'YYYYMMDD'에서 하루 뺀 'YYYYMMDD' — 다음 페이지 기준일 계산용 */
export function prevYmd(ymd: string): string {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/** 테스트 전용 — 모듈 상태(토큰 캐시·쿨다운·경고 플래그)를 초기화한다. */
export function __resetKisAuthForTest(): void {
  cachedToken = null;
  lastIssueAttemptAt = 0;
  warnedMissingEnv = false;
}
