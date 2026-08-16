/**
 * 종목 칩 목록 — 테마 구성종목·산업 구성종목이 **같은 모양**으로 보이게 하는 공용 컴포넌트.
 *
 * 테마 레이더에만 있던 마크업을 뽑아낸 것이다. 산업 레이더·거래대금 화면이 같은 걸 쓰므로
 * 한쪽만 손대서 모양이 갈리는 일이 없다.
 */

/** 테마 상세(`/themes/:no`)와 산업 구성종목(`/market/sectors/:sector/stocks`)이 공유하는 응답 모양. */
export interface StockChip {
  ticker: string;
  name: string | null;
  market: string | null;
  sector: string | null;
  marketCap: number | null;
  totalScore: number | null;
  lastClose: number | null;
  dayChange: number | null;
  livePrice: number | null;
  liveChgPct: number | null;
}

function fmtPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

interface Props {
  items: StockChip[];
  onSelect: (item: StockChip) => void;
  /** 목록이 비었을 때 보여줄 문구 — 화면마다 대상이 달라 호출부가 정한다. */
  emptyText?: string;
}

export function StockChipList({ items, onSelect, emptyText = '구성종목 없음' }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((m) => {
        const chg = m.liveChgPct ?? m.dayChange;
        return (
          <button
            key={m.ticker}
            onClick={() => onSelect(m)}
            disabled={m.name == null}
            title={m.totalScore != null ? `종합 ${m.totalScore}점` : '수집 범위 밖 종목'}
            className={`text-xs rounded px-2 py-1 border ${
              m.name == null
                ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-default'
                : 'bg-surface border-gray-200 text-gray-800 hover:bg-blue-50 hover:border-blue-200'
            }`}
          >
            {m.name ?? m.ticker}
            {m.totalScore != null && <span className="ml-1 text-blue-500">{m.totalScore}</span>}
            {chg != null && (
              <span className={`ml-1 ${chg >= 0 ? 'text-red-500' : 'text-blue-500'}`}>{fmtPct(chg)}</span>
            )}
          </button>
        );
      })}
      {items.length === 0 && <span className="text-sm text-gray-400">{emptyText}</span>}
    </div>
  );
}
