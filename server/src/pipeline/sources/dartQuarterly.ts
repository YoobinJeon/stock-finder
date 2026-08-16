import { http } from '../http';
import { logger } from '../../utils/logger';

/**
 * DART 다중회사 주요계정(`fnlttMultiAcnt`)으로 분기 실적 이력을 받는다.
 *
 * 왜 DART인가: 네이버·와이즈리포트는 분기 창이 4~5개로 고정이라 이력을 늘릴 수 없다
 * (`size`·`page` 파라미터 무시, `sDT` 무효 — 실측). DART는 보고서 단위 조회라 연도를
 * 거슬러 올라갈 수 있고, **한 호출에 종목 100개**를 함께 받아 2,700여 종목도 감당된다.
 *
 * 두 가지 함정:
 * 1. **4분기 단독 실적이 없다.** 사업보고서(11011)의 `thstrm_amount`는 **연간 누적**이다
 *    (삼성전자 2024 = 300.87조). 그래서 Q4는 `연간 − (Q1+Q2+Q3)`로 유도한다.
 *    실측 검증: 삼성전자 2024Q4 매출 75.79조·영업이익 6.49조 = 실제 발표치와 일치.
 * 2. **금융업은 매출액 계정이 없다.** 금융지주·보험은 주요계정에 `이자수익`·`순이자손익`만
 *    있어 매출이 `null`이 된다(실측 59종목 중 7건). 매출 증가를 요구하는 판정 규칙상
 *    그 분기는 판정 불가로 남는다 — 대체 계정을 억지로 매핑하지 않는다.
 */

/** 분기 → DART 보고서 코드. 4분기는 단독 보고서가 없어 사업보고서(연간)에서 유도한다. */
export const REPRT_CODE_BY_QUARTER: Record<1 | 2 | 3, string> = {
  1: '11013', // 1분기보고서
  2: '11012', // 반기보고서
  3: '11014', // 3분기보고서
};
export const REPRT_CODE_ANNUAL = '11011'; // 사업보고서

/** 한 호출에 넣을 수 있는 종목 수 (실측: 100개 정상 응답) */
export const CORP_BATCH_SIZE = 100;

export interface AccountAmounts {
  revenue: number | null;
  operatingIncome: number | null;
}

/**
 * 매출액 계정명 변형. 일반 기업은 `매출액`, 일부는 `수익(매출액)`·`영업수익`으로 보고한다.
 * 금융지주처럼 어느 것도 없는 경우는 매출을 비운다(위 함정 2 참고).
 */
const REVENUE_ACCOUNTS = /^(매출액|수익\(매출액\)|영업수익)$/;
const OPERATING_INCOME_ACCOUNTS = /^영업이익(\(손실\))?$/;

/** "300,870,903,000,000" → 300870903000000. 부호·공백 방어. */
function parseAmount(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[,\s]/g, '');
  if (!s || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

interface MultiAcntRow {
  corp_code?: unknown;
  fs_div?: unknown;      // CFS=연결, OFS=별도
  account_nm?: unknown;
  thstrm_amount?: unknown;
}

/**
 * `fnlttMultiAcnt` 응답 → corp_code별 금액 (순수 함수).
 *
 * **연결(CFS) 우선, 없으면 별도(OFS)**. 지배기업 실적을 보는 게 목적이고 연결이 없는
 * 회사(지주 아닌 단일 법인)만 별도로 떨어진다. 두 값이 다 있으면 연결이 이긴다.
 */
export function parseMultiAcnt(payload: unknown): Map<string, AccountAmounts> {
  const rows = (payload as { list?: unknown[] })?.list;
  const cfs = new Map<string, AccountAmounts>();
  const ofs = new Map<string, AccountAmounts>();
  if (!Array.isArray(rows)) return cfs;

  for (const raw of rows) {
    const row = raw as MultiAcntRow;
    const corpCode = row.corp_code == null ? '' : String(row.corp_code);
    const fsDiv = String(row.fs_div ?? '');
    const accountName = String(row.account_nm ?? '').trim();
    if (!corpCode) continue;

    const isRevenue = REVENUE_ACCOUNTS.test(accountName);
    const isOperatingIncome = OPERATING_INCOME_ACCOUNTS.test(accountName);
    if (!isRevenue && !isOperatingIncome) continue;

    const target = fsDiv === 'CFS' ? cfs : fsDiv === 'OFS' ? ofs : null;
    if (!target) continue;

    const amount = parseAmount(row.thstrm_amount);
    const entry = target.get(corpCode) ?? { revenue: null, operatingIncome: null };
    // 같은 계정이 여러 번 오면 첫 값을 유지한다(보고서 재작성분이 뒤에 붙는 경우 방어).
    if (isRevenue && entry.revenue == null) entry.revenue = amount;
    if (isOperatingIncome && entry.operatingIncome == null) entry.operatingIncome = amount;
    target.set(corpCode, entry);
  }

  const merged = new Map<string, AccountAmounts>();
  for (const corpCode of new Set([...cfs.keys(), ...ofs.keys()])) {
    const c = cfs.get(corpCode);
    const o = ofs.get(corpCode);
    merged.set(corpCode, {
      revenue: c?.revenue ?? o?.revenue ?? null,
      operatingIncome: c?.operatingIncome ?? o?.operatingIncome ?? null,
    });
  }
  return merged;
}

/**
 * 4분기 단독 실적 유도 — `연간 − (Q1+Q2+Q3)` (순수 함수).
 * 네 값 중 하나라도 없으면 유도하지 않는다(`null`) — 빠진 분기를 0으로 보면 Q4가 부풀려진다.
 */
export function deriveQ4(
  q1: number | null,
  q2: number | null,
  q3: number | null,
  annual: number | null,
): number | null {
  if (q1 == null || q2 == null || q3 == null || annual == null) return null;
  return annual - (q1 + q2 + q3);
}

const MULTI_ACNT_URL = 'https://opendart.fss.or.kr/api/fnlttMultiAcnt.json';

/**
 * 종목 배치의 한 보고서 조회. 실패·무데이터는 **빈 맵**(fail-soft) — 특정 연도·분기가
 * 비는 것은 정상(신규 상장 등)이고, 한 배치 실패가 백필 전체를 멈춰선 안 된다.
 */
export async function fetchQuarterAmounts(
  apiKey: string,
  corpCodes: readonly string[],
  year: number,
  reprtCode: string,
): Promise<Map<string, AccountAmounts>> {
  if (corpCodes.length === 0) return new Map();
  try {
    const { data } = await http.get(MULTI_ACNT_URL, {
      params: {
        crtfc_key: apiKey,
        corp_code: corpCodes.join(','),
        bsns_year: String(year),
        reprt_code: reprtCode,
      },
      timeout: 30000,
    });
    // status 013 = 조회된 데이터 없음(정상 상황). 그 외 오류만 로그를 남긴다.
    const status = (data as { status?: string })?.status;
    if (status && status !== '000' && status !== '013') {
      logger.warn(
        `DART 분기 조회 비정상 (${year} ${reprtCode}): status=${status} ` +
        `${(data as { message?: string })?.message ?? ''}`,
      );
      return new Map();
    }
    return parseMultiAcnt(data);
  } catch (e: unknown) {
    logger.warn(
      `DART 분기 조회 실패, 건너뜀 (${year} ${reprtCode}, ${corpCodes.length}종목): ` +
      `${e instanceof Error ? e.message : String(e)}`,
    );
    return new Map();
  }
}
