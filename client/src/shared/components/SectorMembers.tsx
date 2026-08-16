import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { API } from '../api/endpoints';
import { isKstMarketOpen } from '../lib/isKstMarketOpen';
import { StockChipList, type StockChip } from './StockChipList';

interface SectorDetail {
  sector: string;
  intraday: boolean;
  asOf: string | null;
  members: StockChip[];
}

/**
 * 산업 구성종목 확장 행 — 산업 레이더·거래대금 화면이 함께 쓴다.
 * 테마 레이더에서 테마를 눌렀을 때와 **같은 모양**이 되도록 `StockChipList`를 공유한다.
 */
export function SectorMembers({ sector, onSelect }: {
  sector: string;
  onSelect: (m: StockChip) => void;
}) {
  const { data, isLoading } = useQuery<SectorDetail>({
    queryKey: ['market', 'sectorStocks', sector],
    queryFn: () => apiClient.get(API.market.sectorStocks(sector)).then((r) => r.data),
    refetchInterval: () => (isKstMarketOpen() ? 60 * 1000 : false), // 장중에만 60초 폴링
  });

  if (isLoading) return <p className="px-6 py-3 text-sm text-gray-400">구성종목 불러오는 중…</p>;

  const members = data?.members ?? [];
  return (
    <div className="px-6 py-3 bg-gray-50/60">
      <p className="mb-2 text-xs text-gray-400">
        {sector} · {members.length}종목 (종합점수 높은 순)
        {data?.asOf && <span className="ml-1">· 실시간 {data.asOf}</span>}
      </p>
      <StockChipList items={members} onSelect={onSelect} emptyText="해당 산업 종목 없음" />
    </div>
  );
}
