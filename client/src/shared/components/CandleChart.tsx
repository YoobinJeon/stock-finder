import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { API } from '../api/endpoints';
import { isKstMarketOpen } from '../lib/isKstMarketOpen';
import { PriceChartCore, type ChartRow } from './PriceChartCore';
import { MaLegend } from './MaLegend';
import { LiveBadge } from './LiveBadge';

interface PriceRow {
  trade_date: string;
  open: number | string | null;
  high: number | string | null;
  low: number | string | null;
  close: number | string | null;
  volume: number | string | null;
}

/**
 * TradingView 오픈소스 라이브러리(lightweight-charts) 기반 캔들 차트.
 * 자체 DB의 일봉 데이터를 사용 (크로스헤어/줌/팬 지원). 렌더링은 PriceChartCore 공용.
 */
export function CandleChart({ ticker, height = 360 }: { ticker: string; height?: number }) {
  const { data: prices = [], isLoading, isError } = useQuery<PriceRow[]>({
    queryKey: ['price', ticker, '1y'],
    queryFn: () => apiClient.get(`${API.stocks.price(ticker)}?period=1y`).then((r) => r.data),
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

  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const dayChange = last && prev && prev.close !== 0
    ? ((last.close - prev.close) / prev.close) * 100
    : null;

  return (
    <div>
      {last != null && (
        <div className="flex items-end justify-between gap-2 px-2 pb-2 flex-wrap">
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold text-gray-900">{last.close.toLocaleString('ko-KR')}원</span>
            {isKstMarketOpen() && <LiveBadge />}
            {dayChange != null && (
              <span className={`text-sm font-medium mb-0.5 ${dayChange >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                {dayChange >= 0 ? '▲' : '▼'} {Math.abs(dayChange).toFixed(2)}%
                <span className="text-gray-400 font-normal ml-1">({last.time})</span>
              </span>
            )}
          </div>
          <MaLegend className="mb-1" />
        </div>
      )}
      {isLoading ? (
        <div style={{ height }} className="flex items-center justify-center text-sm text-gray-400">
          차트 불러오는 중…
        </div>
      ) : isError ? (
        <div style={{ height }} className="flex items-center justify-center text-sm text-red-500">
          차트 데이터를 불러오지 못했습니다.
        </div>
      ) : rows.length === 0 ? (
        <div style={{ height }} className="flex items-center justify-center text-sm text-gray-400">
          시세 데이터가 없습니다. [데이터] 메뉴에서 수집을 실행하세요.
        </div>
      ) : (
        <PriceChartCore rows={rows} height={height} />
      )}
    </div>
  );
}
