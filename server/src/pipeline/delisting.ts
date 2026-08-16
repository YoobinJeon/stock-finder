import type { IngestScope } from './ingest';

/**
 * 상장폐지 자동 감지 — DB의 활성 종목 중 이번 전체 수집(scope=all) fetch 목록에 없는 종목을
 * 비활성화(is_active=FALSE) 대상으로 판정하는 순수 함수.
 *
 * top200/kospi는 부분 목록(시총 상위/코스피만)이라 "목록에 없다"가 상폐를 의미하지 않으므로
 * scope=all에서만 실행한다. 네이버 응답이 반쪽짜리로 오는 장애 시 전 종목이 상폐로 오판되는
 * 참사를 막기 위해 fetch 수량이 급감하면 건너뛰고, 정상적인 상폐는 하루 몇 건 수준이므로
 * 1회 실행 상한을 두어 대량 오폭을 방지한다.
 */

// fetch된 목록 수가 현재 활성 종목 수의 이 비율 미만이면 네이버 응답 이상으로 보고 상폐 처리를 건너뜀
export const DELIST_FETCH_RATIO_THRESHOLD = 0.97;
// 1회 실행에서 비활성화할 수 있는 최대 종목 수 (정상 상폐는 하루 몇 건 수준)
export const DELIST_MAX_PER_RUN = 30;

export type DelistSkipReason = 'not_all_scope' | 'fetch_count_drop' | 'cap_exceeded';

export interface DelistDecision {
  toDeactivate: string[];
  skipReason: DelistSkipReason | null;
}

/**
 * activeTickers(현재 DB의 is_active=TRUE 종목)와 fetchedTickers(이번 수집의 종목 목록)를 비교해
 * 비활성화 대상을 결정한다. scope가 all이 아니거나 안전 가드에 걸리면 빈 배열 + 사유를 반환한다.
 */
export function decideDelistings(
  scope: IngestScope,
  activeTickers: readonly string[],
  fetchedTickers: readonly string[],
): DelistDecision {
  if (scope !== 'all') {
    return { toDeactivate: [], skipReason: 'not_all_scope' };
  }

  if (fetchedTickers.length < activeTickers.length * DELIST_FETCH_RATIO_THRESHOLD) {
    return { toDeactivate: [], skipReason: 'fetch_count_drop' };
  }

  const fetchedSet = new Set(fetchedTickers);
  const candidates = activeTickers.filter((t) => !fetchedSet.has(t));

  if (candidates.length > DELIST_MAX_PER_RUN) {
    return { toDeactivate: [], skipReason: 'cap_exceeded' };
  }

  return { toDeactivate: candidates, skipReason: null };
}
