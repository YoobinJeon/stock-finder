import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client';
import { API } from '../../shared/api/endpoints';
import { isKstMarketOpen } from '../../shared/lib/isKstMarketOpen';
import { PriceChartCore, type ChartRow } from '../../shared/components/PriceChartCore';

interface PriceRow {
  trade_date: string;
  open: number | string | null;
  high: number | string | null;
  low: number | string | null;
  close: number | string | null;
  volume: number | string | null;
}

const MINI_HEIGHT = 120;

/** 비교 테이블용 미니 캔들 차트 — 최근 3개월, 이평선 5종 (EtfBoard.BoardCard와 동일한 mini 모드). */
export function CompareMiniChart({ ticker }: { ticker: string }) {
  const { data: prices = [], isLoading } = useQuery<PriceRow[]>({
    queryKey: ['price', ticker, '3m'],
    queryFn: () => apiClient.get(`${API.stocks.price(ticker)}?period=3m`).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    refetchInterval: () => (isKstMarketOpen() ? 60_000 : false),
  });

  const rows: ChartRow[] = prices
    .filter((p) => p.close != null && p.open != null)
    .map((p) => ({
      time: p.trade_date,
      open: Number(p.open),
      high: Number(p.high ?? p.close),
      low: Number(p.low ?? p.close),
      close: Number(p.close),
      volume: p.volume != null ? Number(p.volume) : 0,
    }));

  if (isLoading) {
    return (
      <div style={{ height: MINI_HEIGHT }} className="flex items-center justify-center text-xs text-gray-400">
        불러오는 중…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div style={{ height: MINI_HEIGHT }} className="flex items-center justify-center text-xs text-gray-400">
        시세 없음
      </div>
    );
  }
  return <PriceChartCore rows={rows} height={MINI_HEIGHT} mini visibleBars={rows.length} />;
}
