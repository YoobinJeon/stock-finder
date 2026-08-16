import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { API } from '../api/endpoints';
import { ScrollFade } from './ScrollFade';

interface MacroItem {
  key: string;
  name: string;
  unit: 'pct' | null;
  price: number | null;
  change: number | null;
  changePct: number | null;
  up: boolean;
}

interface MacroResponse {
  asOf: number;
  items: MacroItem[];
}

function fmtPrice(item: MacroItem): string {
  if (item.price == null) return '—';
  if (item.unit === 'pct') return `${item.price.toFixed(2)}%`;
  const digits = item.price >= 1000 ? 0 : 2;
  return item.price.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 글로벌 매크로 지표 스트립 — 나스닥선물·VIX·환율·유가 등 (60초 갱신) */
export function MacroTicker() {
  const { data } = useQuery<MacroResponse>({
    queryKey: ['macro'],
    queryFn: () => apiClient.get(API.market.macro).then((r) => r.data),
    refetchInterval: 60 * 1000,
    staleTime: 50 * 1000,
  });

  if (!data || data.items.every((i) => i.price == null)) return null;

  return (
    <div className="bg-surface rounded-xl border border-gray-200 mb-2">
      <ScrollFade>
        <div className="flex items-center gap-6 px-4 py-2.5 min-w-max text-sm">
          <span className="shrink-0 text-[10px] font-semibold text-gray-400 tracking-wide border-r border-gray-100 pr-3">
            선물·거시
          </span>
          {data.items.map((item) => {
            const pct = item.changePct != null ? Math.abs(item.changePct).toFixed(2) : null;
            const sign = item.up ? '+' : '-';
            return (
              <div key={item.key} className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="text-gray-500">{item.name}</span>
                <span className="font-semibold text-gray-900">{fmtPrice(item)}</span>
                {pct != null && (
                  <span className={item.up ? 'text-red-500' : 'text-blue-500'}>
                    {sign}{pct}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </ScrollFade>
    </div>
  );
}
