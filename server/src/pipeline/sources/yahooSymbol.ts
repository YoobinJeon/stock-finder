/**
 * 임의 Yahoo 심볼의 일봉 종가 — 기준선(섹터 지수·ETF) 시계열 수집용.
 *
 * `yahooPrices.ts`의 `fetchYahooChart`는 국내 종목 전용이라 `.KS`/`.KQ` 접미사를 강제로 붙인다.
 * 기준선은 `^SOX`(지수)·`228790.KS`(ETF)처럼 **접미사가 이미 포함되거나 아예 없는** 심볼이라
 * 그 함수를 재사용할 수 없어 별도로 둔다.
 */
import { getJson } from '../http';
import { logger } from '../../utils/logger';

export interface SymbolBar {
  trade_date: string; // YYYY-MM-DD (거래소 현지 기준)
  close: number;
}

/**
 * 심볼의 일봉 종가 시계열(과거→최신). 조회 실패·데이터 없음이면 빈 배열(fail-soft).
 * range 기본 2y — 60일선·252일 진폭 계산에 여유를 둔다.
 */
export async function fetchSymbolCloses(symbol: string, range = '2y'): Promise<SymbolBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;

  try {
    const data = await getJson(url);
    const result = data?.chart?.result?.[0];
    if (!result) {
      logger.warn(`기준선 시세 없음 (${symbol})`);
      return [];
    }

    const timestamps: number[] = result.timestamp ?? [];
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];

    return timestamps
      .map((ts, i) => ({
        trade_date: new Date(ts * 1000).toISOString().slice(0, 10),
        close: closes[i],
      }))
      .filter((b): b is SymbolBar => b.close != null && Number.isFinite(b.close));
  } catch (e: any) {
    logger.warn(`기준선 시세 조회 실패 (${symbol}): ${e?.message}`);
    return [];
  }
}

/**
 * 룩어헤드 방지 절단 (스펙 L0 🚨).
 *
 * SOX 같은 해외 지수는 한국 장중에 "오늘 종가"가 아직 존재하지 않는다. 그런데도 그 값을 쓰면
 * **미래 정보**가 된다 — 2026-08-02 레드팀에서 이 버그로 백테스트가 연 +52.7%로 부풀려졌고,
 * 전일 확정 종가로 정정하니 +35.9%였다(KOSPI 대비 우위 +19%p → +3.5%p).
 *
 * 그래서 해외 기준선은 **판정 기준일(한국 거래일)보다 앞선 마지막 봉**만 쓴다.
 * 국내 기준선(ETF)은 같은 장에서 같이 마감하므로 당일 종가를 그대로 쓴다.
 */
export function clipForLookahead(
  bars: SymbolBar[],
  asOfKstDate: string,
  isForeign: boolean,
): SymbolBar[] {
  if (!isForeign) return bars.filter((b) => b.trade_date <= asOfKstDate);
  return bars.filter((b) => b.trade_date < asOfKstDate);
}
