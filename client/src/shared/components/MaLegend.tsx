import { MA_LINES } from './PriceChartCore';

/**
 * 이평선 범례 — 색·굵기를 차트와 동일하게 보여준다.
 * CandleChart·SymbolChartPanel·EtfDetailPanel이 같은 마크업을 각자 갖고 있던 것을 공용화했다.
 * MA60은 차트에서 굵게 그리므로 범례 색칩도 같은 굵기·강조 라벨로 맞춘다.
 */
export function MaLegend({ className = '' }: { className?: string }) {
  // 여백은 호출부가 정한다 — 범례 옆에 다른 요소(LiveBadge 등)를 나란히 두는 화면이 있어서.
  return (
    <div className={`flex items-center gap-3 flex-wrap ${className}`}>
      {MA_LINES.map(({ label, color, width }) => {
        const isEmphasized = width > 1;
        return (
          <span
            key={label}
            className={`flex items-center gap-1 text-[11px] ${
              isEmphasized ? 'text-gray-700 font-semibold' : 'text-gray-500'
            }`}
          >
            <span
              className="inline-block w-3 rounded"
              style={{ backgroundColor: color, height: width }}
            />
            {label}
          </span>
        );
      })}
    </div>
  );
}
