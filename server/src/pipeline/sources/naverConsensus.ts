import axios from 'axios';
import { num, frac } from '../http';
import { logger } from '../../utils/logger';

export interface ConsensusEstimate {
  fiscalYear: number;
  revenue: number | null;          // 원
  operatingIncome: number | null;  // 원
  netIncome: number | null;        // 원
  eps: number | null;              // 원
  bps: number | null;              // 원 — 주당순자산(밸류에이션 밴드용)
  per: number | null;              // 추정연도 fPER
  pbr: number | null;              // 추정연도 fPBR
  roe: number | null;              // 소수 (0.15 = 15%)
  revenueGrowth: number | null;    // YoY 소수 — 소스의 YOY 그대로
}

/** 분기 컨센서스 1건 — 연간과 달리 확정(A)·추정(E) 분기를 모두 포함한다(분기 추이 표시 목적). */
export interface QuarterlyConsensusEstimate {
  fiscalYear: number;
  fiscalQuarter: number;           // 1~4 (분기 말월 03/06/09/12 → 1/2/3/4)
  isEstimate: boolean;             // YYMM의 (A)/(E) 표기
  revenue: number | null;          // 원
  operatingIncome: number | null;  // 원
  netIncome: number | null;        // 원
  eps: number | null;              // 원
  bps: number | null;              // 원 — 분기 응답에는 필드 자체가 없는 경우가 많아 null이 흔함
  per: number | null;
  pbr: number | null;
  roe: number | null;              // 소수 — 추정 분기는 소스가 빈 문자열을 내려 null
  revenueGrowth: number | null;    // 소스 YOY(전년 동기 대비) 소수 그대로
}

// 네이버 컴퍼니(와이즈리포트) 연간 재무 표기도 naverFinancials.ts와 동일하게 억원 단위.
const EOK = 1e8;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

/** frq=0(연간)/1(분기) — 두 조회 모두 이 엔드포인트를 공유한다(실측: 사용자 제공 분기 응답 샘플). */
const ANNUAL_FRQ = 0;
const QUARTERLY_FRQ = 1;

const consensusUrl = (cmpCd: string, sDT: string, frq: number) =>
  `https://navercomp.wisereport.co.kr/company/ajax/c1050001_data.aspx?flag=2&cmp_cd=${cmpCd}&finGubun=MAIN&frq=${frq}&sDT=${sDT}&chartType=svg`;

const refererUrl = (cmpCd: string) =>
  `https://navercomp.wisereport.co.kr/v2/company/c1050001.aspx?cmp_cd=${cmpCd}`;

function todayYYYYMMDD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** DECIMAL(8,2) 등 컬럼 범위를 벗어나는 이상치는 버림 (naverFinancials.ts clamp()와 동일 관례) */
function clamp(v: number | null, max = 99999): number | null {
  return v != null && Math.abs(v) <= max ? v : null;
}

function scale(v: number | null, factor: number): number | null {
  return v == null ? null : Math.round(v * factor);
}

/**
 * 와이즈리포트 c1050001_data.aspx 원시 응답(JSON 문자열)에서 JsonData 행 배열을 꺼내는 공통
 * 헬퍼. 응답 Content-Type이 text/html이라 axios가 자동 파싱하지 않으므로 여기서 직접
 * JSON.parse — 형식이 깨져 있거나(JSON 파싱 실패) JsonData가 없어도 예외를 던지지 않고
 * 빈 배열을 반환한다(연간·분기 파서 공용, 호출측은 fail-soft로 소비).
 */
function extractJsonRows(raw: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const rows = Array.isArray((parsed as { JsonData?: unknown })?.JsonData)
    ? ((parsed as { JsonData: unknown[] }).JsonData)
    : [];
  return rows as Record<string, unknown>[];
}

/**
 * 금액·비율 필드 파싱 — 연간·분기 파서가 공유(개별 필드가 빈 문자열이어도 null로 방어).
 * BPS는 EPS와 같은 원 단위 그대로(스케일 없음), PBR은 PER과 동일하게 clamp만 적용 —
 * 밸류에이션 밴드(PBR 밴드·PBR-ROE 산점도) 계산에 필요해 추가(PER/PBR/PBR-ROE 밴드).
 */
function parseAmountFields(r: Record<string, unknown>) {
  return {
    revenue: scale(num(r.SALES), EOK),
    operatingIncome: scale(num(r.OP), EOK),
    netIncome: scale(num(r.NP), EOK),
    eps: num(r.EPS),
    bps: num(r.BPS),
    per: clamp(num(r.PER)),
    pbr: clamp(num(r.PBR)),
    roe: frac(clamp(num(r.ROE))),
    revenueGrowth: frac(num(r.YOY)),
  };
}

/**
 * "추정" 연도(YYMM이 "YYYY.MM(E)") 행만 골라 파싱하는 순수 함수. 확정(A) 연도는 이 소스에서
 * 다루지 않음 — naverFinancials.ts가 담당.
 */
export function parseConsensusRows(raw: string): ConsensusEstimate[] {
  const results: ConsensusEstimate[] = [];
  for (const r of extractJsonRows(raw)) {
    const yymm = String(r.YYMM ?? '');
    const match = /^(\d{4})\.\d{2}\(E\)$/.exec(yymm);
    if (!match) continue;

    results.push({ fiscalYear: Number(match[1]), ...parseAmountFields(r) });
  }

  return results.sort((a, b) => a.fiscalYear - b.fiscalYear);
}

/** YYMM의 분기 말월(03/06/09/12) → 분기 번호. 그 외 월(예: .07)은 방어적으로 매핑하지 않는다. */
const QUARTER_BY_END_MONTH: Record<string, number> = { '03': 1, '06': 2, '09': 3, '12': 4 };

/**
 * frq=1 응답에서 분기 행(확정·추정 모두)을 파싱하는 순수 함수. 연간과 달리 확정(A) 분기도
 * 필요하므로(분기 추이 표시) (A)/(E) 둘 다 포함하고 isEstimate로 구분한다. 분기 말월이
 * 03/06/09/12가 아닌 행은 형식 이상으로 간주해 건너뛴다.
 */
export function parseQuarterlyConsensusRows(raw: string): QuarterlyConsensusEstimate[] {
  const results: QuarterlyConsensusEstimate[] = [];
  for (const r of extractJsonRows(raw)) {
    const yymm = String(r.YYMM ?? '');
    const match = /^(\d{4})\.(\d{2})\((A|E)\)$/.exec(yymm);
    if (!match) continue;

    const fiscalQuarter = QUARTER_BY_END_MONTH[match[2]];
    if (!fiscalQuarter) continue; // 분기 말월이 아닌 이상치 방어

    results.push({
      fiscalYear: Number(match[1]),
      fiscalQuarter,
      isEstimate: match[3] === 'E',
      ...parseAmountFields(r),
    });
  }

  return results.sort((a, b) => a.fiscalYear - b.fiscalYear || a.fiscalQuarter - b.fiscalQuarter);
}

/** 연간·분기 조회가 공유하는 raw 요청 — frq만 다르고 나머지 파라미터·헤더는 동일. */
async function fetchConsensusRaw(ticker: string, frq: number): Promise<string> {
  const { data } = await axios.get(consensusUrl(ticker, todayYYYYMMDD(), frq), {
    headers: { 'User-Agent': UA, Referer: refererUrl(ticker) },
    timeout: 15000,
    responseType: 'text',
    transformResponse: (d) => d, // 문자열 그대로 받아 파서에서 직접 JSON.parse
  });
  return String(data);
}

/**
 * 종목의 향후 최대 3개년 애널리스트 컨센서스(매출·영업이익·순이익·EPS·fPER·ROE·증가율) 수집.
 * 미커버 종목은 필드가 빈 문자열로 내려와 자연히 null 처리됨. 요청 실패 시 빈 배열(fail-soft) —
 * 호출측(ingest.ts)이 기존 naverFinancials 1개년 추정치로 폴백한다.
 */
export async function fetchConsensus(ticker: string): Promise<ConsensusEstimate[]> {
  try {
    return parseConsensusRows(await fetchConsensusRaw(ticker, ANNUAL_FRQ));
  } catch (e: unknown) {
    logger.warn(`컨센서스 수집 (${ticker}) 실패, 건너뜀: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/**
 * 종목의 분기별 실적·컨센서스(확정 분기 + 추정 분기) 수집. 연간과 달리 확정분도 포함한다
 * (분기 추이를 보려면 과거 분기가 필요). 요청 실패 시 빈 배열(fail-soft) — 호출측이 분기
 * 데이터 없이 계속 진행한다.
 */
export async function fetchQuarterlyConsensus(ticker: string): Promise<QuarterlyConsensusEstimate[]> {
  try {
    return parseQuarterlyConsensusRows(await fetchConsensusRaw(ticker, QUARTERLY_FRQ));
  } catch (e: unknown) {
    logger.warn(`분기 컨센서스 수집 (${ticker}) 실패, 건너뜀: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}
