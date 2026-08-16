interface LiveBadgeProps {
  /** 서버 응답의 오버레이 시각(HH:MM) — 없으면 시각 없이 표시 */
  asOf?: string | null;
}

/** 장중 실시간 배지 — 표시 여부는 호출부가 결정(서버 intraday 플래그 우선, 플래그 없는 API만 isKstMarketOpen()) */
export function LiveBadge({ asOf }: LiveBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 border border-red-100 rounded-full px-2 py-0.5">
      {asOf ? `● 장중 ${asOf} 실시간` : '● 실시간'}
    </span>
  );
}
