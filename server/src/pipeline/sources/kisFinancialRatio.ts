import { num } from '../http';
import {
  getKisCreds,
  getKisToken,
  kisGet,
  kisHeaders,
  warnMissingKisEnvOnce,
} from './kisAuth';

/**
 * 한국투자증권(KIS) OpenAPI `[국내주식-080] 국내주식 재무비율` — 연간 EPS·BPS·ROE 장기 시계열.
 *
 * 밸류에이션 밴드(PER/PBR 밴드)의 분위수는 표본이 많을수록 안정된다. 자체 수집분은 최근
 * 5년뿐이라 분위수가 몇 개 연도에 휘둘렸는데, 이 API는 **22개 회계연도(2004.12~2025.12)** 를
 * 한 콜로 준다(실측: 005930·010120 동일).
 *
 * **`FID_DIV_CLS_CODE=0`(연간) 응답에 연간이 아닌 행이 섞인다.** 실측에서 두 종목 모두
 * 맨 앞에 `202603`(직전 분기 기준 TTM 추정) 행이 붙어 있었다:
 * ```
 * 005930  202603 202512 202412 202312 ... 200412   ← 첫 행만 3월, 나머지는 전부 12월
 * ```
 * 이 행을 회계연도 2026으로 적재하면 연간 EPS 계열에 TTM이 섞여 밴드가 통째로 어긋난다.
 * 그래서 **결산월이 다수인 행만 남긴다** — 12월 결산이 아닌 종목도 같은 규칙으로 걸러진다.
 */

const RATIO_PATH = '/uapi/domestic-stock/v1/finance/financial-ratio';
const TR_ID = 'FHKST66430300';
const DIV_CLS_ANNUAL = '0';
const MARKET_DIV_CODE = 'J';

export interface KisAnnualFinancial {
  fiscalYear: number;
  eps: number | null;
  bps: number | null;
  /** 자기자본이익률(%) */
  roe: number | null;
  /** 주당매출(원) */
  sps: number | null;
}

interface RawPeriodRow {
  yyyymm: string;
  eps: number | null;
  bps: number | null;
  roe: number | null;
  sps: number | null;
}

/** `YYYYMM` 6자리만 통과시킨다. */
function parsePeriod(v: unknown): string | null {
  const s = String(v ?? '');
  return /^\d{6}$/.test(s) ? s : null;
}

/**
 * 결산월이 다수인 행만 남기는 순수 함수 — TTM/분기 행 제거용.
 * 동률이면 먼저 만난 월을 택한다(실용적 결정론).
 */
export function keepAnnualPeriods(rows: readonly RawPeriodRow[]): RawPeriodRow[] {
  if (rows.length === 0) return [];

  const countByMonth = new Map<string, number>();
  for (const r of rows) {
    const m = r.yyyymm.slice(4, 6);
    countByMonth.set(m, (countByMonth.get(m) ?? 0) + 1);
  }

  let fiscalMonth = rows[0].yyyymm.slice(4, 6);
  let best = 0;
  for (const [m, c] of countByMonth) {
    if (c > best) {
      best = c;
      fiscalMonth = m;
    }
  }

  return rows.filter((r) => r.yyyymm.slice(4, 6) === fiscalMonth);
}

/**
 * 원시 응답 → 연간 재무 시계열(오름차순)로 파싱하는 순수 함수.
 * `rt_cd !== '0'`, `output` 부재/비배열, 개별 필드 누락을 모두 방어하며 예외를 던지지 않는다.
 */
export function parseKisAnnualFinancials(raw: unknown): KisAnnualFinancial[] {
  const obj = raw as { rt_cd?: unknown; output?: unknown } | null | undefined;
  if (!obj || String(obj.rt_cd) !== '0') return [];
  const rows = Array.isArray(obj.output) ? obj.output : [];

  const parsed: RawPeriodRow[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const yyyymm = parsePeriod(r?.stac_yymm);
    if (yyyymm == null) continue;
    parsed.push({
      yyyymm,
      eps: num(r?.eps),
      bps: num(r?.bps),
      roe: num(r?.roe_val),
      sps: num(r?.sps),
    });
  }

  return keepAnnualPeriods(parsed)
    .map((r) => ({
      fiscalYear: Number(r.yyyymm.slice(0, 4)),
      eps: r.eps,
      bps: r.bps,
      roe: r.roe,
      sps: r.sps,
    }))
    .sort((a, b) => a.fiscalYear - b.fiscalYear);
}

/**
 * 종목의 연간 재무비율 시계열(오름차순)을 조회한다.
 * 환경변수 미설정·토큰 실패·조회 실패 시 예외 대신 null을 반환한다(fail-soft) —
 * 호출측이 자체 수집분만으로 계속 진행하도록.
 */
export async function fetchKisAnnualFinancials(
  ticker: string,
): Promise<KisAnnualFinancial[] | null> {
  const creds = getKisCreds();
  if (!creds) {
    warnMissingKisEnvOnce('연간 재무비율 조회');
    return null;
  }

  const token = await getKisToken(creds);
  if (!token) return null;

  const data = await kisGet(
    RATIO_PATH,
    {
      headers: kisHeaders(creds, token, TR_ID),
      params: {
        FID_DIV_CLS_CODE: DIV_CLS_ANNUAL,
        fid_cond_mrkt_div_code: MARKET_DIV_CODE,
        fid_input_iscd: ticker,
      },
    },
    `재무비율 ${ticker}`,
  );
  if (data == null) return null;

  return parseKisAnnualFinancials(data);
}
