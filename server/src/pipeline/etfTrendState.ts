import { Candle } from './sources/naverEtfDetail';

/**
 * ETF 국면(수급 정렬 상태) 4단계.
 * - entered: 오늘 정배열(ma5>ma20>ma60) 진입, 연속일수 5일 이하 (신규진입)
 * - aligned: 오늘 정배열, 연속일수 5일 초과 (정배열 지속)
 * - neutral: 정배열은 아니지만 20일선 근방·위 (걸침)
 * - exited: 정배열 아니고 20일선을 1.5% 이상 하회 (이탈)
 */
export type TrendState = 'entered' | 'aligned' | 'neutral' | 'exited';

export interface TrendStateResult {
  state: TrendState;
  alignedStreak: number;
  /** 오늘 이탈이고, 5거래일 전엔 정배열(entered/aligned)이었던 "급전환" 이탈인지 여부 */
  recentExit: boolean;
}

/** calcTrendState 내부 재사용용 — 국면·연속일수만 담은 코어 판정 결과 */
interface CoreTrendState {
  state: TrendState;
  alignedStreak: number;
}

// 국면 판정 최소 봉 수 — MA60 계산에 필요
const MIN_CANDLES = 60;
// 정배열 연속일수 판정에 살펴볼 최근 최대 일수
const STREAK_LOOKBACK_DAYS = 30;
// 신규진입/정배열 지속 경계 — streak가 이 값 이하면 신규진입
const ENTERED_STREAK_MAX = 5;
// 이탈 판정 버퍼 — 20일선을 이 비율 이상 하회해야 이탈 (노이즈 흡수)
const EXITED_MA20_BUFFER = 0.985;
// 최근 이탈 판정 — 며칠 전 시점과 비교할지 (거래일 기준)
const RECENT_EXIT_LOOKBACK_DAYS = 5;

/** index(0-based, 포함)까지의 종가로 period 기간 이동평균 계산. 데이터 부족 시 null. */
function maAt(closes: number[], index: number, period: number): number | null {
  if (index - period + 1 < 0) return null;
  const slice = closes.slice(index - period + 1, index + 1);
  return slice.reduce((s, v) => s + v, 0) / period;
}

/** index 시점의 정배열(ma5 > ma20 > ma60) 여부. 데이터 부족 시 false. */
function isAlignedAt(closes: number[], index: number): boolean {
  const ma5 = maAt(closes, index, 5);
  const ma20 = maAt(closes, index, 20);
  const ma60 = maAt(closes, index, 60);
  if (ma5 == null || ma20 == null || ma60 == null) return false;
  return ma5 > ma20 && ma20 > ma60;
}

/**
 * ETF 국면 판정 코어 로직 (순수 함수). candles는 날짜 오름차순(과거→최신) 가정.
 * 60개 미만이면 국면 판정 불가로 neutral·streak 0.
 * calcTrendState와 "5거래일 전 시점" 재판정에서 공용으로 재사용한다.
 */
function calcCoreTrendState(candles: Candle[]): CoreTrendState {
  if (candles.length < MIN_CANDLES) {
    return { state: 'neutral', alignedStreak: 0 };
  }

  const closes = candles.map((c) => c.close);
  const lastIndex = closes.length - 1;
  // MA60이 계산 가능한 가장 이른 인덱스(59) 이전으로는 판정 대상에서 제외
  const windowStart = Math.max(59, lastIndex - STREAK_LOOKBACK_DAYS + 1);

  let alignedStreak = 0;
  for (let i = lastIndex; i >= windowStart; i -= 1) {
    if (!isAlignedAt(closes, i)) break;
    alignedStreak += 1;
  }

  const todayAligned = isAlignedAt(closes, lastIndex);
  const lastClose = closes[lastIndex];
  const ma20Today = maAt(closes, lastIndex, 20);

  if (todayAligned) {
    return {
      state: alignedStreak <= ENTERED_STREAK_MAX ? 'entered' : 'aligned',
      alignedStreak,
    };
  }

  if (ma20Today != null && lastClose < ma20Today * EXITED_MA20_BUFFER) {
    return { state: 'exited', alignedStreak };
  }

  return { state: 'neutral', alignedStreak };
}

/**
 * "5거래일 전 시점"의 국면 — 최근 5개 봉을 제거한 뒤 동일 로직으로 재판정.
 * 그 시점이 정배열(entered/aligned)이었는지만 필요하므로 CoreTrendState를 그대로 반환.
 */
function calcStateBeforeRecentExit(candles: Candle[]): CoreTrendState {
  const trimmed = candles.slice(0, candles.length - RECENT_EXIT_LOOKBACK_DAYS);
  return calcCoreTrendState(trimmed);
}

/**
 * ETF 국면 판정 (순수 함수). candles는 날짜 오름차순(과거→최신) 가정.
 * 60개 미만이면 국면 판정 불가로 neutral·streak 0·recentExit false.
 */
export function calcTrendState(candles: Candle[]): TrendStateResult {
  const core = calcCoreTrendState(candles);

  let recentExit = false;
  if (core.state === 'exited') {
    const before = calcStateBeforeRecentExit(candles);
    recentExit = before.state === 'aligned' || before.state === 'entered';
  }

  return { ...core, recentExit };
}
