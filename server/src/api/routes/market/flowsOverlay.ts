import type { Quote } from './shared';

/**
 * 수급 순위(flows-ranking) 랭킹 행에 장중 실시간 시세를 오버레이하는 순수 헬퍼.
 * regimeFlows.routes.ts의 기본/세부 모드가 공유 — 부수효과 없음, 원본 배열·객체 불변.
 */

/** flows-ranking 랭킹 행 중 오버레이에 필요한 최소 필드 (나머지 필드는 제네릭으로 통과) */
export interface OverlayableRow {
  ticker: string;
  estAvgPrice: number | null;
  currentPrice: number | null;
  returnPct: number | null;
}

export interface FlowGroup<T> {
  key: string;
  label: string;
  buy: T[];
  sell: T[];
}

/** 그룹 전체 buy/sell에서 중복 제거한 티커 목록 (fetchStockQuotes 1회 일괄 호출용) */
export function collectFlowsTickers<T extends OverlayableRow>(groups: readonly FlowGroup<T>[]): string[] {
  const tickers = new Set<string>();
  for (const g of groups) {
    for (const r of g.buy) tickers.add(r.ticker);
    for (const r of g.sell) tickers.add(r.ticker);
  }
  return [...tickers];
}

/** 행 하나에 실시간 시세 반영 — 시세 없으면 원본 그대로(같은 참조) 반환 */
function overlayRow<T extends OverlayableRow>(row: T, quotes: ReadonlyMap<string, Quote>): T {
  const quote = quotes.get(row.ticker);
  if (!quote) return row;
  const livePrice = quote.price;
  const returnPct = row.estAvgPrice ? ((livePrice - row.estAvgPrice) / row.estAvgPrice) * 100 : null;
  return { ...row, currentPrice: livePrice, returnPct };
}

/** 장중 실시간 시세로 currentPrice·returnPct 재계산 (불변; 시세 없는 종목은 원본 그대로) */
export function overlayFlowsQuotes<T extends OverlayableRow>(
  groups: readonly FlowGroup<T>[],
  quotes: ReadonlyMap<string, Quote>,
): FlowGroup<T>[] {
  return groups.map((g) => ({
    ...g,
    buy: g.buy.map((r) => overlayRow(r, quotes)),
    sell: g.sell.map((r) => overlayRow(r, quotes)),
  }));
}
