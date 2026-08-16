/**
 * 유상증자·CB(전환사채) 조달금액 파싱 + 시총 대비 비율 차등 감점 (정교화: 규모 반영).
 * DART 공시 원문(stripTags 평문)에서 "자금조달의 목적" 표 합계(유상증자) 또는
 * "권면(전자등록)총액"(CB) 단일 필드를 찾는다. 실제 공시 1~2건(주요사항보고서 유상증자결정·
 * 전환사채권발행결정)의 원문 구조를 확인해 패턴을 확정했다 — 두 유형 모두 "키워드 (원) 숫자"
 * 형태를 공유하지만, CB 쪽은 바로 뒤에 "정관상 잔여 발행한도 (원) N" 같은 더 큰 무관 숫자가
 * 이어지므로 윈도우 내 최댓값이 아니라 키워드 직후 첫 번째 숫자만 취한다.
 */
export type FundingKind = 'rights_issue' | 'cb'; // 유상증자 | 전환사채

// 키워드 뒤 이 길이(문자 수) 이내에서 금액을 탐색
const KEYWORD_WINDOW = 300;
// "(원)" 뒤의 숫자(콤마 포함) — 없으면(플레이스홀더 "-") 매치되지 않는다
const AMOUNT_AFTER_WON_RE = /\(원\)\s*([\d,]{7,})/g;

const RIGHTS_ISSUE_KEYWORD = '자금조달의 목적';
const CB_KEYWORD_RE = /권면\s*(?:\(전자등록\))?\s*총액/;

// 비상식 값 방어: 1천만 원 미만 또는 100조 초과는 오파싱으로 간주해 거부
const MIN_AMOUNT = 10_000_000;
const MAX_AMOUNT = 100_000_000_000_000;

function toAmount(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isPlausible(amount: number | null): amount is number {
  return amount !== null && amount >= MIN_AMOUNT && amount <= MAX_AMOUNT;
}

/** 유상증자: "자금조달의 목적" 표(시설자금·운영자금 등 항목별 "(원) 숫자")의 항목 합계 */
function parseRightsIssueAmount(text: string): number | null {
  const idx = text.indexOf(RIGHTS_ISSUE_KEYWORD);
  if (idx < 0) return null;
  const window = text.slice(idx + RIGHTS_ISSUE_KEYWORD.length, idx + RIGHTS_ISSUE_KEYWORD.length + KEYWORD_WINDOW);

  AMOUNT_AFTER_WON_RE.lastIndex = 0;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_AFTER_WON_RE.exec(window))) {
    const amount = toAmount(m[1]);
    if (amount === null) continue;
    total += amount;
    matched = true;
  }
  return matched ? total : null;
}

/** CB: "권면(전자등록)총액"(또는 "권면총액") 키워드 직후 첫 번째 "(원) 숫자" — 표가 아닌 단일 필드 */
function parseCbAmount(text: string): number | null {
  const kw = CB_KEYWORD_RE.exec(text);
  if (!kw) return null;
  const window = text.slice(kw.index + kw[0].length, kw.index + kw[0].length + KEYWORD_WINDOW);

  AMOUNT_AFTER_WON_RE.lastIndex = 0;
  const m = AMOUNT_AFTER_WON_RE.exec(window);
  return m ? toAmount(m[1]) : null;
}

/** 공시 원문 텍스트에서 조달 총액(원)을 찾는다 — 없거나 비상식 값이면 null */
export function parseFundingAmount(text: string, kind: FundingKind): number | null {
  const amount = kind === 'rights_issue' ? parseRightsIssueAmount(text) : parseCbAmount(text);
  return isPlausible(amount) ? amount : null;
}

/**
 * 공시 제목에서 금액 파싱 대상 이벤트 종류를 판별한다 — dartDisclosures.classifyDisclosure와
 * 동일한 키워드 기준([기재정정] 제외, 유상증자결정·전환사채권발행결정만 대상).
 */
export function fundingKindFromReportNm(reportNm: string): FundingKind | null {
  const nm = reportNm.replace(/\s/g, '');
  if (nm.includes('정정')) return null;
  if (nm.includes('유상증자결정')) return 'rights_issue';
  if (nm.includes('전환사채권발행결정')) return 'cb';
  return null;
}

export interface FundingDeltaResult {
  delta: number;
  ratioPct: number;
}

// 유상증자: 3% 미만 -2, 3~10% -5(기존 고정값), 10% 초과 -10
const RIGHTS_ISSUE_BANDS = { low: -2, mid: -5, high: -10 } as const;
// CB: 3% 미만 -2, 3~10% -3(기존 고정값), 10% 초과 -6
const CB_BANDS = { low: -2, mid: -3, high: -6 } as const;

const LOW_RATIO_PCT = 3;
const HIGH_RATIO_PCT = 10;

/** 시총 대비 조달금액 비율로 감점을 차등한다 — marketCap 없거나 0 이하면 null */
export function fundingDelta(
  kind: FundingKind,
  amount: number,
  marketCap: number | null | undefined,
): FundingDeltaResult | null {
  if (marketCap == null || marketCap <= 0) return null;

  const ratioPct = (amount / marketCap) * 100;
  const bands = kind === 'rights_issue' ? RIGHTS_ISSUE_BANDS : CB_BANDS;
  const delta = ratioPct > HIGH_RATIO_PCT ? bands.high : ratioPct >= LOW_RATIO_PCT ? bands.mid : bands.low;
  return { delta, ratioPct };
}

// ── 수주 계약 금액 차등 ──

/**
 * 「단일판매ㆍ공급계약체결」 공시의 **매출액 대비(%)**.
 *
 * 이 서식은 비율을 직접 담고 있어(`매출액 대비(%) 42.48`) 매출액을 따로 조회할 필요가 없다.
 * **금액이 비공개인 건이 실제로 있다** — 2026-07-24 쎄트렉아이(한국과학기술원 계약)는
 * `계약금액 총액(원) -` / `매출액 대비(%) -`로 내려온다. 그런 건은 null을 돌려주고
 * 호출측이 기존 고정 가점으로 폴백한다.
 *
 * `최근 매출액(원)`은 회사분과 계약상대방분 **두 번** 나오지만(상대방은 보통 `-`),
 * `매출액 대비(%)`는 회사 기준 한 번만 나오므로 이 필드만 쓴다(2026-07-26 표본 3건 실측).
 */
export function parseContractRatioPct(text: string): number | null {
  const m = text.match(/매출액\s*대비\s*\(%\)\s*([\d,]+\.?\d*)/);
  if (!m) return null;
  const pct = Number(m[1].replace(/,/g, ''));
  // 서식 오류·오파싱 방어 — 매출의 10배를 넘는 단일 계약은 신뢰하지 않는다
  if (!Number.isFinite(pct) || pct <= 0 || pct > 1000) return null;
  return pct;
}

// 매출액 대비 5% 미만 +2, 5~20% +5(기존 고정값), 20% 초과 +10
const CONTRACT_BANDS = { low: 2, mid: 5, high: 10 } as const;
const CONTRACT_LOW_PCT = 5;
const CONTRACT_HIGH_PCT = 20;

/** 매출액 대비 비율로 수주 가점을 차등한다 */
export function contractDelta(ratioPct: number): number {
  if (ratioPct > CONTRACT_HIGH_PCT) return CONTRACT_BANDS.high;
  if (ratioPct >= CONTRACT_LOW_PCT) return CONTRACT_BANDS.mid;
  return CONTRACT_BANDS.low;
}

// ── 최대주주 지분 변동 ──

export interface OwnershipChange {
  /** 「3. 보고의 개요」 증감 행의 합계 비율(%p). 감소는 음수 */
  netRatioPct: number;
  /** 「4. 개인별 세부변동사항」에 실제 매도 사유가 있는가 */
  hasSale: boolean;
}

/**
 * 「최대주주등소유주식변동신고서」의 순증감과 매도 여부.
 *
 * **개별 사유가 아니라 순증감을 본다** — 한 신고서에 `장내매수(+)`와 `장내매도(-)`가 함께
 * 들어있는 경우가 흔하고(2026-07-24 010040·005940 실측), 작은 매도를 큰 매수가 상쇄한 건을
 * 매각으로 잡으면 오탐이다. 감소는 평범한 마이너스로 표기된다(`증감 보통주식 -37,079 -0.04`).
 *
 * **매도 사유 존재를 함께 요구하는 이유**: `임원퇴임(-)`·상속처럼 실제로 판 게 아닌데
 * 보고 대상에서 빠져 지분이 줄어 보이는 사유가 있다. 순감소만으로 감점하면 그런 건을
 * 매각으로 오인한다.
 */
export function parseOwnershipChange(text: string): OwnershipChange | null {
  const m = text.match(/증감\s*보통주식\s*(-?[\d,]+)\s*(-?[\d.]+)/);
  if (!m) return null;
  const netRatioPct = Number(m[2]);
  if (!Number.isFinite(netRatioPct) || Math.abs(netRatioPct) > 100) return null;
  // 사유 표기는 `장내매도(-)`·`장외매도(-)`처럼 "매도"라는 말과 (-) 부호를 함께 단다
  const hasSale = /매도\s*\(-\)/.test(text);
  return { netRatioPct, hasSale };
}

// 순감소 1%p 미만 -2, 1~3%p -5, 3%p 초과 -8
const OWNERSHIP_BANDS = { low: -2, mid: -5, high: -8 } as const;
const OWNERSHIP_LOW_PCT = 1;
const OWNERSHIP_HIGH_PCT = 3;

/** 최대주주 지분 순감소 폭으로 감점한다. 증가·보합이거나 매도 사유가 없으면 0(감점 없음). */
export function ownershipDelta(change: OwnershipChange): number {
  if (!change.hasSale || change.netRatioPct >= 0) return 0;
  const drop = Math.abs(change.netRatioPct);
  if (drop > OWNERSHIP_HIGH_PCT) return OWNERSHIP_BANDS.high;
  if (drop >= OWNERSHIP_LOW_PCT) return OWNERSHIP_BANDS.mid;
  return OWNERSHIP_BANDS.low;
}

// ── 원문 조회로 정교화할 공시 종류 판정 ──

export type DocRefineKind = FundingKind | 'contract' | 'ownership';

/**
 * 제목만으로 "원문을 열어봐야 점수가 정해지는" 공시인지 가른다.
 * 유상증자·CB는 `fundingKindFromReportNm`이 이미 판정하므로 그대로 위임한다.
 */
export function docRefineKindFromReportNm(reportNm: string): DocRefineKind | null {
  const funding = fundingKindFromReportNm(reportNm);
  if (funding) return funding;
  const nm = reportNm.replace(/\s/g, '');
  if (nm.includes('단일판매') || nm.includes('공급계약체결')) return 'contract';
  if (nm.includes('최대주주등소유주식변동신고서')) return 'ownership';
  return null;
}
