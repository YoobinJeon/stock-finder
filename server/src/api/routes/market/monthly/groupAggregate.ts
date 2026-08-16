/**
 * 월간 상승률 — 묶음 하나의 한 달을 **멤버 종목 수익률에서 대표값으로** 압축한다.
 *
 * 묶음은 테마일 수도, 산업(섹터)일 수도 있다 — 압축 방식은 같다(산업 축).
 */

/**
 * 대표값을 **중앙값**으로 두는 이유.
 *
 * 멤버 수가 2~146종목으로 편차가 크고, 잡주 한 종목이 +300% 뛰면 동일가중 평균은 통째로
 * 끌려간다("이 묶음이 올랐나"가 아니라 "그 한 종목이 올랐나"를 보게 된다). 중앙값은 그 흔들림에
 * 견디고 묶음 전반의 움직임을 말한다. 평균과 상승 종목 비율을 함께 내려보내 교차 확인할 수 있게
 * 한다 — 중앙값과 평균이 크게 벌어지면 그 자체가 "쏠림이 있다"는 신호다.
 */

import { median } from '../../../../utils/stats';

export { median };

/** 중앙값을 내려면 최소 몇 종목의 값이 필요한가 — 1종목은 대표값이 아니라 그 종목 자체다. */
export const MIN_MEMBERS_FOR_CELL = 2;

export interface GroupCell {
  /** 멤버 수익률의 중앙값(소수). 정렬 기준. */
  median: number;
  /** 동일가중 평균(소수). 중앙값과 벌어지면 쏠림 신호. */
  mean: number;
  /** 오른 종목 비율(0~1). */
  upRatio: number;
  /** 그 달 수익률을 가진 멤버 수 — 분모가 몇인지 밝힌다. */
  count: number;
}

/**
 * 한 묶음·한 달. 값을 가진 멤버가 `MIN_MEMBERS_FOR_CELL`에 못 미치면 null — 빈 칸으로 둔다.
 */
export function aggregateGroup(returns: readonly number[]): GroupCell | null {
  if (returns.length < MIN_MEMBERS_FOR_CELL) return null;
  const mid = median(returns);
  if (mid == null) return null;
  const sum = returns.reduce((a, b) => a + b, 0);
  const up = returns.filter((r) => r > 0).length;
  return {
    median: mid,
    mean: sum / returns.length,
    upRatio: up / returns.length,
    count: returns.length,
  };
}
