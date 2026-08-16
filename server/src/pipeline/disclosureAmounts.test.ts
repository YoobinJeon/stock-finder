import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFundingAmount,
  fundingDelta,
  fundingKindFromReportNm,
  parseContractRatioPct,
  contractDelta,
  parseOwnershipChange,
  ownershipDelta,
  docRefineKindFromReportNm,
} from './disclosureAmounts';
import { classifyDisclosure } from './sources/dartDisclosures';

// 아래 픽스처는 실제 DART 주요사항보고서(유상증자결정·전환사채권발행결정) 원문 구조를
// 축약·재현한 것 (stripTags 이후 평문, 공백 정규화됨).

const RIGHTS_ISSUE_TEXT =
  '1. 신주의 종류와 수 보통주식 (주) 560,852 2. 1주당 액면가액 (원) 500 3. 증자전 발행주식총수 (주) ' +
  '보통주식 (주) 15,188,750 기타주식 (주) 8 4. 자금조달의 목적 시설자금 (원) - 영업양수자금 (원) - ' +
  '운영자금 (원) 999,999,116 채무상환자금 (원) - 타법인 증권취득자금 (원) - 기타자금 (원) - ' +
  '5. 증자방식 제3자배정증자';

const CB_TEXT =
  '1. 사채의 종류 회차 12 종류 무기명식 이권부 무보증 사모 전환사채 2. 사채의 권면(전자등록)총액 (원) ' +
  '30,000,000,000 2-1. 정관상 잔여 발행한도 (원) 57,250,000,000 2-2. (해외발행) 권면(전자등록)총액(통화단위) - ' +
  '- 기준환율등 - 발행지역 - 3. 자금조달의 목적 시설자금 (원) - 영업양수자금 (원) 20,000,000,000 ' +
  '운영자금 (원) 10,000,000,000 채무상환자금 (원) -';

test('유상증자 원문에서 자금조달의 목적 표 항목 금액을 파싱한다', () => {
  // Arrange & Act
  const result = parseFundingAmount(RIGHTS_ISSUE_TEXT, 'rights_issue');

  // Assert
  assert.equal(result, 999_999_116);
});

test('유상증자 표에 항목이 여러 개 populated면 합계를 반환한다', () => {
  // Arrange
  const text =
    '4. 자금조달의 목적 시설자금 (원) 500,000,000 영업양수자금 (원) - 운영자금 (원) 300,000,000 ' +
    '채무상환자금 (원) - 기타자금 (원) -';

  // Act
  const result = parseFundingAmount(text, 'rights_issue');

  // Assert
  assert.equal(result, 800_000_000);
});

test('유상증자: "자금조달의 목적" 키워드가 없으면 null이다', () => {
  // Arrange
  const text = '무관한 공시 원문입니다. 금액 정보가 없습니다.';

  // Act
  const result = parseFundingAmount(text, 'rights_issue');

  // Assert
  assert.equal(result, null);
});

test('CB 원문에서 권면(전자등록)총액을 파싱한다 — 뒤에 더 큰 무관 숫자(잔여 발행한도)가 있어도 오염되지 않는다', () => {
  // Arrange & Act
  const result = parseFundingAmount(CB_TEXT, 'cb');

  // Assert
  assert.equal(result, 30_000_000_000);
});

test('CB: "권면총액"(전자등록 표기 없이)도 파싱된다', () => {
  // Arrange
  const text = '2. 사채의 권면총액 (원) 5,000,000,000 3. 사채의 이율 표면이자율 (%) 0';

  // Act
  const result = parseFundingAmount(text, 'cb');

  // Assert
  assert.equal(result, 5_000_000_000);
});

test('CB: 키워드가 없으면 null이다', () => {
  // Arrange
  const text = '무관한 공시 원문입니다.';

  // Act
  const result = parseFundingAmount(text, 'cb');

  // Assert
  assert.equal(result, null);
});

test('1천만 원 미만 값은 비상식 값으로 거부(null)된다', () => {
  // Arrange
  const text = '2. 사채의 권면총액 (원) 9,999,999 3. 사채의 이율 표면이자율 (%) 0';

  // Act
  const result = parseFundingAmount(text, 'cb');

  // Assert
  assert.equal(result, null);
});

test('100조 초과 값은 비상식 값으로 거부(null)된다', () => {
  // Arrange
  const text = '2. 사채의 권면총액 (원) 200,000,000,000,000 3. 사채의 이율 표면이자율 (%) 0';

  // Act
  const result = parseFundingAmount(text, 'cb');

  // Assert
  assert.equal(result, null);
});

test('값이 전부 "-"(플레이스홀더)면 null이다', () => {
  // Arrange
  const text = '4. 자금조달의 목적 시설자금 (원) - 영업양수자금 (원) - 운영자금 (원) -';

  // Act
  const result = parseFundingAmount(text, 'rights_issue');

  // Assert
  assert.equal(result, null);
});

// --- fundingDelta ---

test('유상증자: 시총 대비 3% 미만이면 -2', () => {
  // Arrange & Act
  const result = fundingDelta('rights_issue', 25_000_000_000, 1_000_000_000_000); // 2.5%

  // Assert
  assert.deepEqual(result, { delta: -2, ratioPct: 2.5 });
});

test('유상증자: 시총 대비 정확히 3%면 -5 구간(경계)', () => {
  // Arrange & Act
  const result = fundingDelta('rights_issue', 30_000_000_000, 1_000_000_000_000); // 3%

  // Assert
  assert.equal(result?.delta, -5);
  assert.equal(result?.ratioPct, 3);
});

test('유상증자: 시총 대비 정확히 10%면 -5 구간(경계, 초과가 아니므로)', () => {
  // Arrange & Act
  const result = fundingDelta('rights_issue', 100_000_000_000, 1_000_000_000_000); // 10%

  // Assert
  assert.equal(result?.delta, -5);
  assert.equal(result?.ratioPct, 10);
});

test('유상증자: 시총 대비 10% 초과면 -10', () => {
  // Arrange & Act
  const result = fundingDelta('rights_issue', 150_000_000_000, 1_000_000_000_000); // 15%

  // Assert
  assert.equal(result?.delta, -10);
  assert.equal(result?.ratioPct, 15);
});

test('CB: 시총 대비 3% 미만이면 -2', () => {
  // Arrange & Act
  const result = fundingDelta('cb', 20_000_000_000, 1_000_000_000_000); // 2%

  // Assert
  assert.equal(result?.delta, -2);
});

test('CB: 시총 대비 3~10% 구간이면 -3(기존값 유지)', () => {
  // Arrange & Act
  const result = fundingDelta('cb', 50_000_000_000, 1_000_000_000_000); // 5%

  // Assert
  assert.equal(result?.delta, -3);
});

test('CB: 시총 대비 10% 초과면 -6', () => {
  // Arrange & Act
  const result = fundingDelta('cb', 200_000_000_000, 1_000_000_000_000); // 20%

  // Assert
  assert.equal(result?.delta, -6);
});

test('marketCap이 null이면 null을 반환한다', () => {
  // Arrange & Act
  const result = fundingDelta('rights_issue', 30_000_000_000, null);

  // Assert
  assert.equal(result, null);
});

test('marketCap이 0이면 null을 반환한다', () => {
  // Arrange & Act
  const result = fundingDelta('rights_issue', 30_000_000_000, 0);

  // Assert
  assert.equal(result, null);
});

// --- fundingKindFromReportNm ---

test('유상증자결정 공시는 rights_issue로 판별된다', () => {
  // Arrange & Act
  const result = fundingKindFromReportNm('주요사항보고서(유상증자결정)');

  // Assert
  assert.equal(result, 'rights_issue');
});

test('전환사채권발행결정 공시는 cb로 판별된다', () => {
  // Arrange & Act
  const result = fundingKindFromReportNm('주요사항보고서(전환사채권발행결정)');

  // Assert
  assert.equal(result, 'cb');
});

test('[기재정정] 프리픽스가 붙으면 원본과 중복이므로 null이다', () => {
  // Arrange & Act
  const result = fundingKindFromReportNm('[기재정정]주요사항보고서(유상증자결정)');

  // Assert
  assert.equal(result, null);
});

test('무관한 공시는 null이다', () => {
  // Arrange & Act
  const result = fundingKindFromReportNm('감자결정');

  // Assert
  assert.equal(result, null);
});

// ── 수주 계약 금액 차등 ──
// 픽스처는 2026-07-24 실제 공시 원문에서 관측한 표기를 그대로 옮긴 것.

/** 기가비스 — 계약금액 공개 건 */
const CONTRACT_DISCLOSED =
  '2. 계약내역 조건부 계약여부 미해당 확정 계약금액 22,276,104,000 조건부 계약금액 - ' +
  '계약금액 총액(원) 22,276,104,000 최근 매출액(원) 52,434,995,936 매출액 대비(%) 42.48 ' +
  '3. 계약상대방 대만 반도체 기판 제조회사 - 최근 매출액(원) - - 주요사업 - -';

/** 쎄트렉아이 — 국가기관 계약이라 금액이 통째로 비공개인 건 */
const CONTRACT_WITHHELD =
  '2. 계약내역 조건부 계약여부 미해당 확정 계약금액 - 조건부 계약금액 - ' +
  '계약금액 총액(원) - 최근 매출액(원) 206,916,796,302 매출액 대비(%) - ' +
  '3. 계약상대방 한국과학기술원 - 최근 매출액(원) - -';

test('공급계약 원문에서 매출액 대비(%)를 뽑는다', () => {
  assert.equal(parseContractRatioPct(CONTRACT_DISCLOSED), 42.48);
});

test('금액이 비공개(-)면 null — 호출측이 고정 가점으로 폴백해야 한다', () => {
  assert.equal(parseContractRatioPct(CONTRACT_WITHHELD), null);
});

test('계약상대방의 최근 매출액에 낚이지 않는다 — 회사 기준 비율만 쓴다', () => {
  // 상대방 섹션에도 "최근 매출액(원)"이 나오지만 매출액 대비(%)는 회사 것 하나뿐
  assert.equal(parseContractRatioPct(CONTRACT_DISCLOSED), 42.48);
  assert.equal(parseContractRatioPct('최근 매출액(원) 52,434,995,936'), null);
});

test('비현실적인 비율은 오파싱으로 보고 버린다', () => {
  assert.equal(parseContractRatioPct('매출액 대비(%) 1200.0'), null);
  assert.equal(parseContractRatioPct('매출액 대비(%) 0'), null);
});

test('수주 가점은 매출액 대비 비율로 차등된다', () => {
  assert.equal(contractDelta(2.0), 2);    // 소액
  assert.equal(contractDelta(5.0), 5);    // 경계 — 기존 고정값 유지
  assert.equal(contractDelta(20.0), 5);   // 상단 경계는 아직 mid
  assert.equal(contractDelta(42.48), 10); // 대형 수주
});

// ── 최대주주 지분 변동 ──

/** 에이치디씨 — 순증가(장내매수만) */
const OWNERSHIP_BUY =
  '3. 보고의 개요 직전보고서제출일 2026-07-21 보통주식 25,692,957 43.01 ' +
  '이번보고서제출일 2026-07-24 보통주식 25,706,946 43.03 증감 보통주식 13,989 0.02 ' +
  '4. 개인별 세부변동사항 변경일 변경원인 2026-07-24 장내매수(+) 보통주식';

/** 078930 — 매수·매도가 섞였고 순감소 */
const OWNERSHIP_NET_SELL =
  '3. 보고의 개요 증감 보통주식 -37,079 -0.04 ' +
  '4. 개인별 세부변동사항 장내매도(-) 보통주식 장내매수(+) 보통주식';

/** 010040 — 매도가 섞였지만 순증가(큰 매수가 상쇄) */
const OWNERSHIP_MIXED_NET_BUY =
  '3. 보고의 개요 증감 보통주식 51,024 0.12 ' +
  '4. 개인별 세부변동사항 장내매수(+) 보통주식 장내매도(-) 보통주식';

/** 실제 매도가 아닌데 지분이 줄어 보이는 사유 */
const OWNERSHIP_RETIRE_ONLY =
  '3. 보고의 개요 증감 보통주식 -1,200,000 -2.10 ' +
  '4. 개인별 세부변동사항 임원퇴임(-) 보통주식';

test('순증감과 매도 여부를 함께 뽑는다', () => {
  assert.deepEqual(parseOwnershipChange(OWNERSHIP_BUY), { netRatioPct: 0.02, hasSale: false });
  assert.deepEqual(parseOwnershipChange(OWNERSHIP_NET_SELL), { netRatioPct: -0.04, hasSale: true });
});

test('증감 행이 없으면 null', () => {
  assert.equal(parseOwnershipChange('3. 보고의 개요 직전보고서제출일 2026-07-21'), null);
});

test('순증가면 감점하지 않는다', () => {
  assert.equal(ownershipDelta(parseOwnershipChange(OWNERSHIP_BUY)!), 0);
});

test('매도가 섞여도 순증가면 감점하지 않는다 — 개별 사유로 판정하면 오탐', () => {
  const change = parseOwnershipChange(OWNERSHIP_MIXED_NET_BUY)!;
  assert.equal(change.hasSale, true);
  assert.equal(ownershipDelta(change), 0);
});

test('임원퇴임처럼 실제 매도가 아니면 순감소여도 감점하지 않는다', () => {
  const change = parseOwnershipChange(OWNERSHIP_RETIRE_ONLY)!;
  assert.equal(change.hasSale, false);
  assert.equal(ownershipDelta(change), 0);
});

test('실제 매각은 순감소 폭으로 차등 감점된다', () => {
  assert.equal(ownershipDelta({ netRatioPct: -0.04, hasSale: true }), -2);
  assert.equal(ownershipDelta({ netRatioPct: -1.0, hasSale: true }), -5); // 경계
  assert.equal(ownershipDelta({ netRatioPct: -3.0, hasSale: true }), -5); // 상단 경계는 아직 mid
  assert.equal(ownershipDelta({ netRatioPct: -8.5, hasSale: true }), -8);
});

// ── 원문 조회 대상 판정 ──

test('원문을 열어야 하는 공시 종류를 가른다', () => {
  assert.equal(docRefineKindFromReportNm('유상증자결정'), 'rights_issue');
  assert.equal(docRefineKindFromReportNm('전환사채권발행결정'), 'cb');
  assert.equal(docRefineKindFromReportNm('단일판매ㆍ공급계약체결'), 'contract');
  assert.equal(docRefineKindFromReportNm('최대주주등소유주식변동신고서'), 'ownership');
  assert.equal(docRefineKindFromReportNm('자기주식취득결정'), null);
});

// ── 제목 기준 분류 (신규 룰) ──

test('최대주주 지분 담보제공은 감점 신호다', () => {
  const c = classifyDisclosure('최대주주변경을수반하는주식담보제공계약체결');
  assert.equal(c?.type, 'penalty');
  assert.equal(c?.delta, -5);
});

test('담보 해제ㆍ취소는 감점하지 않는다 — 체결과 문자열이 겹쳐 실수하기 쉬운 자리', () => {
  assert.equal(classifyDisclosure('최대주주변경을수반하는주식담보제공계약해제ㆍ취소등'), null);
});

test('최대주주 지분 변동은 delta 0으로 적재해 원문 파싱이 확정하게 둔다', () => {
  const c = classifyDisclosure('최대주주등소유주식변동신고서');
  assert.equal(c?.type, 'penalty');
  assert.equal(c?.delta, 0);
});

test('[기재정정]은 여전히 정보성 — 원본과 중복 반영되면 안 된다', () => {
  assert.equal(classifyDisclosure('[기재정정]최대주주변경을수반하는주식담보제공계약체결'), null);
});
