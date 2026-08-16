import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { API } from '../api/endpoints';
import { PriceChartCore, type ChartRow } from './PriceChartCore';
import { MaLegend } from './MaLegend';

interface SymbolCandle {
  trade_date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

interface SymbolChartData {
  symbol: string;
  name: string;
  currency: string;
  price: number | null;
  changePct: number | null;
  high52w: number | null;
  low52w: number | null;
  exchange: string | null;
  candles: SymbolCandle[];
}

/** 소수점 자릿수 — 엔화·원화는 정수, 그 외 통화는 소수 둘째자리까지 (PeersPage와 동일 규칙) */
function fmtPrice(price: number | null, currency: string): string {
  if (price == null) return '—';
  const digits = currency === 'JPY' || currency === 'KRW' ? 0 : 2;
  return price.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function InfoCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className="text-sm font-medium text-gray-800">{value ?? '—'}</p>
    </div>
  );
}

/**
 * 해외 기업·지수 심볼 차트 패널 — EtfDetailPanel과 동일한 모달 패턴.
 * 글로벌 피어 보드의 해외 종목 행, 대시보드 지수 카드(코스피·코스닥 포함) 클릭으로 연다.
 */
export function SymbolChartPanel({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery<SymbolChartData>({
    queryKey: ['market', 'symbolChart', symbol],
    queryFn: () => apiClient.get(API.market.symbolChart, { params: { symbol } }).then((r) => r.data),
    staleTime: 4 * 60 * 1000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows: ChartRow[] = (data?.candles ?? [])
    .filter((c) => c.close != null && c.open != null)
    .map((c) => ({
      time: c.trade_date,
      open: c.open!,
      high: c.high ?? c.close!,
      low: c.low ?? c.close!,
      close: c.close!,
      volume: 0, // 심볼 차트 API는 거래량을 제공하지 않음 — 히스토그램은 축 숨김이라 0이어도 무해
    }));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-surface w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 bg-surface border-b border-gray-100 px-5 py-4 flex items-center gap-2 flex-wrap">
          <h3 className="text-lg font-bold text-gray-900">{data?.name ?? symbol}</h3>
          <span className="text-xs text-gray-400">{decodeURIComponent(symbol)}</span>
          {data?.price != null && (
            <span className="ml-1 text-base font-semibold text-gray-900">
              {fmtPrice(data.price, data.currency)}
              {data.changePct != null && (
                <span className={`ml-1.5 text-sm ${data.changePct >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                  {data.changePct >= 0 ? '+' : ''}{data.changePct.toFixed(2)}%
                </span>
              )}
            </span>
          )}
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">
          {isLoading && <p className="text-sm text-gray-400">불러오는 중…</p>}
          {isError && <p className="text-sm text-red-500">차트 데이터를 불러오지 못했습니다.</p>}

          {/* 차트 + 이평선 범례 */}
          {rows.length > 0 && (
            <div>
              <MaLegend className="mb-1" />
              <PriceChartCore rows={rows} height={320} />
            </div>
          )}

          {/* 기본 정보 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 bg-gray-50 rounded-xl p-4">
            <InfoCell label="거래소" value={data?.exchange ?? null} />
            <InfoCell label="통화" value={data?.currency ?? null} />
            <InfoCell label="52주 고가" value={data?.high52w != null ? fmtPrice(data.high52w, data.currency) : null} />
            <InfoCell label="52주 저가" value={data?.low52w != null ? fmtPrice(data.low52w, data.currency) : null} />
          </div>
        </div>
      </div>
    </div>
  );
}
