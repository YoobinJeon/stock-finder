import axios from 'axios';
import { sleep } from '../http';
import { logger } from '../../utils/logger';

/**
 * DART OpenAPI 공시 목록 수집.
 * corp_code 매핑 없이 날짜 범위 조회(list.json)를 사용 — 응답의 stock_code(6자리)로
 * 상장사를 식별한다. 공시유형: B(주요사항보고) I(거래소공시) F(외부감사)는 이벤트 룰에 사용.
 * A(정기공시: 사업·반기·분기보고서)는 이벤트 룰 매칭 없이 정보성으로 저장되지만,
 * 실적 캘린더의 정기보고서(periodic) 카테고리 표시용으로 수집한다.
 */
const LIST_URL = 'https://opendart.fss.or.kr/api/list.json';
const PAGE_COUNT = 100;
const MAX_PAGES = 30; // 유형·시장당 최대 3,000건 안전장치

export interface DartDisclosure {
  rceptNo: string;
  ticker: string;
  date: string; // YYYY-MM-DD
  reportNm: string;
}

export interface DisclosureClassification {
  type: 'exclusion' | 'penalty' | 'bonus';
  delta: number;
  label: string;
}

/**
 * 공시 제목 기반 이벤트 분류 (ARCHITECTURE.md 「공시 이벤트 룰」 참고).
 * [기재정정]은 원본과 접수번호가 달라 중복 반영되므로 정보성으로만 저장.
 */
export function classifyDisclosure(reportNm: string): DisclosureClassification | null {
  const nm = reportNm.replace(/\s/g, '');
  if (nm.includes('정정')) return null;

  // 🚫 제외 (점수 캡)
  if (nm.includes('횡령') || nm.includes('배임')) return { type: 'exclusion', delta: 0, label: '횡령·배임 공시' };
  if (nm.includes('관리종목')) return { type: 'exclusion', delta: 0, label: '관리종목 관련' };
  if (nm.includes('상장폐지')) return { type: 'exclusion', delta: 0, label: '상장폐지 관련' };
  if (nm.includes('의견거절')) return { type: 'exclusion', delta: 0, label: '감사의견 거절' };

  // ⚠️ 감점
  if (nm.includes('유상증자결정')) return { type: 'penalty', delta: -5, label: '유상증자 결정' };
  if (nm.includes('감자결정')) return { type: 'penalty', delta: -8, label: '감자 결정' };
  if (nm.includes('전환사채권발행결정')) return { type: 'penalty', delta: -3, label: '전환사채(CB) 발행' };
  // 최대주주 지분이 담보로 잡힘 — 반대매매 시 경영권이 넘어갈 수 있는 부실 신호.
  // 해제 공시(`…담보제공계약해제ㆍ취소등`)는 이 문자열을 포함하지 않아 걸리지 않는다.
  if (nm.includes('담보제공계약체결')) {
    return { type: 'penalty', delta: -5, label: '최대주주 지분 담보제공' };
  }
  // 제목만으로는 매수/매도를 알 수 없다 — delta 0으로 적재해두고 원문 파싱이 확정한다.
  if (nm.includes('최대주주등소유주식변동신고서')) {
    return { type: 'penalty', delta: 0, label: '최대주주 지분 변동' };
  }

  // ✅ 가점
  if (nm.includes('자기주식취득') && !nm.includes('처분')) {
    return nm.includes('신탁')
      ? { type: 'bonus', delta: 5, label: '자사주 취득 신탁계약' }
      : { type: 'bonus', delta: 10, label: '자사주 매입 결정' };
  }
  if (nm.includes('단일판매') || nm.includes('공급계약체결')) {
    return { type: 'bonus', delta: 5, label: '판매·공급계약 체결' };
  }

  return null; // 정보성 공시
}

async function fetchPage(params: Record<string, string>, page: number) {
  const { data } = await axios.get(LIST_URL, {
    params: { ...params, page_no: String(page), page_count: String(PAGE_COUNT) },
    timeout: 15000,
  });
  return data;
}

/** bgnDe~endDe(YYYYMMDD) 기간의 상장사 공시 목록 (A·B·I·F 유형, KOSPI·KOSDAQ) */
export async function fetchDisclosures(apiKey: string, bgnDe: string, endDe: string): Promise<DartDisclosure[]> {
  const results: DartDisclosure[] = [];
  const seen = new Set<string>();

  for (const corpCls of ['Y', 'K']) {
    for (const pblntfTy of ['A', 'B', 'I', 'F']) {
      const params = { crtfc_key: apiKey, bgn_de: bgnDe, end_de: endDe, corp_cls: corpCls, pblntf_ty: pblntfTy };
      for (let page = 1; page <= MAX_PAGES; page++) {
        const data = await fetchPage(params, page);
        if (data.status === '013') break; // 조회 데이터 없음
        if (data.status !== '000') {
          logger.warn(`DART 응답 오류 (${corpCls}/${pblntfTy}): ${data.status} ${data.message}`);
          break;
        }
        for (const r of data.list ?? []) {
          const ticker = (r.stock_code ?? '').trim();
          if (!/^\d{6}$/.test(ticker) || seen.has(r.rcept_no)) continue;
          seen.add(r.rcept_no);
          const d = String(r.rcept_dt); // YYYYMMDD
          results.push({
            rceptNo: r.rcept_no,
            ticker,
            date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
            reportNm: String(r.report_nm ?? '').trim(),
          });
        }
        if (page >= Number(data.total_page ?? 1)) break;
        await sleep(150);
      }
    }
  }
  return results;
}
