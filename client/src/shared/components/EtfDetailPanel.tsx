import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useEscapeKey } from '../lib/useEscapeKey';
import { API } from '../api/endpoints';
import { PriceChartCore, type ChartRow } from './PriceChartCore';
import { MaLegend } from './MaLegend';
import { LiveBadge } from './LiveBadge';
import { isKstMarketOpen } from '../lib/isKstMarketOpen';

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MaFlags {
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  above20: boolean | null;
  above60: boolean | null;
  aligned: boolean | null;
  newHigh: boolean | null;
  high52w: number | null;
}

interface EtfDetail {
  ticker: string;
  name: string;
  asOf: string;
  intraday: boolean;
  quote: {
    price: number;
    changePct: number;
    nav: number | null;
    deviationPct: number | null;
    threeMonthReturn: number | null;
    amount: number;
    marketCap: number;
  } | null;
  info: {
    summary: string | null;
    issuer: string | null;
    baseIndex: string | null;
    listedDate: string | null;
    marketValue: string | null;
    totalFee: number | null;
    deviationPct: number | null;
    constituents: Array<{ ticker: string; name: string; weight: number | null }>;
    sectors: Array<{ name: string; weight: number }>;
  } | null;
  flags: MaFlags;
  candles: Candle[];
}

function FlagBadge({ ok, yes, no }: { ok: boolean | null; yes: string; no: string }) {
  if (ok == null) return <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">데이터 부족</span>;
  return (
    <span
      className={`text-xs font-semibold rounded-full px-2 py-0.5 border ${
        ok ? 'text-red-600 bg-red-50 border-red-100' : 'text-blue-600 bg-blue-50 border-blue-100'
      }`}
    >
      {ok ? yes : no}
    </span>
  );
}

function InfoCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className="text-sm font-medium text-gray-800">{value ?? '—'}</p>
    </div>
  );
}

/** ETF 상세 모달 — 차트(이평선 5종) + 기본정보 + 편입종목 비중 */
export function EtfDetailPanel({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  useEscapeKey(onClose);
  const { data, isLoading } = useQuery<EtfDetail>({
    queryKey: ['etf', 'detail', ticker],
    queryFn: () => apiClient.get(API.etf.detail(ticker)).then((r) => r.data),
    refetchInterval: () => (isKstMarketOpen() ? 60 * 1000 : false), // 장중에만 60초 폴링
    staleTime: 50 * 1000,
  });

  const rows: ChartRow[] = (data?.candles ?? []).map((c) => ({
    time: c.date,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));

  const q = data?.quote;
  const info = data?.info;
  const flags = data?.flags;
  const maxWeight = Math.max(1, ...(info?.constituents ?? []).map((c) => c.weight ?? 0));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-surface w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 bg-surface border-b border-gray-100 px-5 py-4 flex items-center gap-2 flex-wrap">
          <h3 className="text-lg font-bold text-gray-900">{data?.name ?? ticker}</h3>
          <span className="text-xs text-gray-400">{ticker}</span>
          {q && (
            <span className="ml-1 text-base font-semibold text-gray-900">
              {q.price.toLocaleString()}
              <span className={`ml-1.5 text-sm ${q.changePct >= 0 ? 'text-red-500' : 'text-blue-500'}`}>
                {q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%
              </span>
            </span>
          )}
          {flags && (
            <span className="flex gap-1.5 ml-1">
              {flags.newHigh && (
                <span className="text-xs font-bold text-white bg-red-500 rounded-full px-2 py-0.5">🚀 신고가</span>
              )}
              <FlagBadge ok={flags.aligned} yes="정배열" no="정배열 아님" />
              <FlagBadge ok={flags.above20} yes="20일선 위" no="20일선 아래" />
              <FlagBadge ok={flags.above60} yes="60일선 위" no="60일선 아래" />
            </span>
          )}
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">
          {isLoading && <p className="text-sm text-gray-400">불러오는 중…</p>}

          {/* 차트 + 이평선 범례 */}
          {rows.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <MaLegend />
                {data?.intraday && (
                  <span className="ml-auto">
                    <LiveBadge asOf={data.asOf} />
                  </span>
                )}
              </div>
              <PriceChartCore rows={rows} height={320} />
            </div>
          )}

          {/* 기본 정보 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 bg-gray-50 rounded-xl p-4">
            <InfoCell label="운용사" value={info?.issuer ?? null} />
            <InfoCell label="기초지수" value={info?.baseIndex ?? null} />
            <InfoCell label="상장일" value={info?.listedDate ?? null} />
            <InfoCell label="시가총액" value={info?.marketValue ?? null} />
            <InfoCell label="총보수" value={info?.totalFee != null ? `${info.totalFee}%` : null} />
            <InfoCell
              label="NAV 괴리율"
              value={
                (info?.deviationPct ?? q?.deviationPct) != null
                  ? `${(info?.deviationPct ?? q!.deviationPct!).toFixed(2)}%`
                  : null
              }
            />
            <InfoCell
              label="3개월 수익률"
              value={q?.threeMonthReturn != null ? `${q.threeMonthReturn >= 0 ? '+' : ''}${q.threeMonthReturn.toFixed(2)}%` : null}
            />
            <InfoCell
              label="20일선"
              value={flags?.ma20 != null ? Math.round(flags.ma20).toLocaleString() : null}
            />
            <InfoCell
              label="52주 고가"
              value={flags?.high52w != null ? flags.high52w.toLocaleString() : null}
            />
          </div>

          {/* 편입종목 top10 */}
          {info && info.constituents.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">편입종목 TOP{info.constituents.length}</h4>
              <div className="space-y-1.5">
                {info.constituents.map((c) => (
                  <div key={`${c.ticker}-${c.name}`} className="flex items-center gap-2 text-sm">
                    <span className="w-36 truncate text-gray-800">{c.name}</span>
                    <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-400 rounded-full"
                        style={{ width: `${((c.weight ?? 0) / maxWeight) * 100}%` }}
                      />
                    </div>
                    <span className="w-14 text-right text-gray-600 text-xs">
                      {c.weight != null ? `${c.weight.toFixed(2)}%` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 섹터 구성 */}
          {info && info.sectors.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">섹터 구성</h4>
              <div className="flex flex-wrap gap-1.5">
                {info.sectors.map((s) => (
                  <span key={s.name} className="text-xs bg-gray-50 border border-gray-200 text-gray-600 rounded px-2 py-0.5">
                    {s.name} {s.weight.toFixed(1)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 상품 설명 */}
          {info?.summary && (
            <p className="text-xs text-gray-500 whitespace-pre-line leading-relaxed border-t border-gray-100 pt-3">
              {info.summary}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
