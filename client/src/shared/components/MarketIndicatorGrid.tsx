import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { API } from '../api/endpoints';

/**
 * 시장 지표 한눈 보기 — 지수·금리·원자재·선물을 **한 화면에 격자로** 펼친다.
 *
 * 이전에는 가로 스크롤 스트립 두 줄(지수 / 선물·거시)이라 항목이 늘수록 화면 밖으로 밀려
 * "한눈에" 볼 수 없었다. 격자로 바꿔 스크롤 없이 전부 보이게 하고, 타일을 누르면 차트가 열린다.
 *
 * 클릭 대상은 Yahoo 심볼이 있는 항목뿐이다 — 국내 선물(K200·코스닥)은 네이버·KIS 경로라
 * 심볼 차트를 만들 수 없어 정보만 표시한다.
 */

interface IndexQuote {
  key: string;
  name: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  up: boolean;
}

interface MacroItem {
  key: string;
  symbol?: string | null;
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

/** 지수 키 → Yahoo 심볼 (차트 조회용). */
const INDEX_SYMBOLS: Record<string, string> = {
  kospi: '%5EKS11',
  kosdaq: '%5EKQ11',
  snp500: '%5EGSPC',
  nasdaq: '%5EIXIC',
  dow: '%5EDJI',
  nikkei: '%5EN225',
  twse: '%5ETWII',
};

/**
 * 소수점 둘째자리까지 표시하는 지수 — 나머지는 정수 반올림.
 * 대시보드가 쓰던 규칙을 그대로 옮긴 것이다(원지수 그대로 보는 게 익숙한 해외 지수들).
 */
const DECIMAL_INDEX_KEYS = new Set(['snp500', 'nasdaq', 'dow']);

interface Tile {
  key: string;
  name: string;
  value: string;
  changePct: number | null;
  up: boolean;
  /** Yahoo 심볼 — 없으면 클릭 불가(국내 선물 등). */
  symbol: string | null;
}

function fmtIndex(q: IndexQuote): string {
  if (q.price == null) return '—';
  return DECIMAL_INDEX_KEYS.has(q.key)
    ? q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Math.round(q.price).toLocaleString('ko-KR');
}

function fmtMacro(m: MacroItem): string {
  if (m.price == null) return '—';
  if (m.unit === 'pct') return `${m.price.toFixed(2)}%`;
  const digits = m.price >= 1000 ? 0 : 2;
  return m.price.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 금리는 방향의 의미가 주가와 달라 따로 묶는다. 그 외는 성격별로 나눈다. */
const YIELD_KEYS = new Set(['us2y', 'us10y', 'us30y']);
const FUTURES_KEYS = new Set(['nasdaqFut', 'snpFut', 'k200Fut', 'kosdaqFut', 'k200NightFut']);

const INDEX_ORDER = ['kospi', 'kosdaq', 'snp500', 'nasdaq', 'dow', 'nikkei', 'twse'];

export function MarketIndicatorGrid({ onSelectSymbol }: { onSelectSymbol: (symbol: string) => void }) {
  const { data: indices } = useQuery<Record<string, IndexQuote>>({
    queryKey: ['market', 'indices'],
    queryFn: () => apiClient.get(API.market.indices).then((r) => r.data),
    refetchInterval: 60 * 1000,
    staleTime: 50 * 1000,
  });

  const { data: macro } = useQuery<MacroResponse>({
    queryKey: ['macro'],
    queryFn: () => apiClient.get(API.market.macro).then((r) => r.data),
    refetchInterval: 60 * 1000,
    staleTime: 50 * 1000,
  });

  const macroItems = macro?.items ?? [];
  const byKey = (keys: Set<string>) => macroItems.filter((m) => keys.has(m.key));

  const macroTile = (m: MacroItem): Tile => ({
    key: m.key,
    name: m.name,
    value: fmtMacro(m),
    changePct: m.changePct,
    up: m.up,
    symbol: m.symbol ?? null,
  });

  const indexTiles: Tile[] = INDEX_ORDER
    .map((k) => indices?.[k])
    .filter((q): q is IndexQuote => q != null)
    .map((q) => ({
      key: q.key,
      name: q.name,
      value: fmtIndex(q),
      changePct: q.changePct,
      up: q.up,
      symbol: INDEX_SYMBOLS[q.key] ?? null,
    }));

  const groups: Array<{ label: string; tiles: Tile[] }> = [
    { label: '지수', tiles: indexTiles },
    { label: '선물', tiles: byKey(FUTURES_KEYS).map(macroTile) },
    { label: '미국 국채 금리', tiles: byKey(YIELD_KEYS).map(macroTile) },
    {
      label: '거시·원자재',
      tiles: macroItems
        .filter((m) => !YIELD_KEYS.has(m.key) && !FUTURES_KEYS.has(m.key))
        .map(macroTile),
    },
  ].filter((g) => g.tiles.length > 0);

  if (groups.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-gray-200 p-4 animate-pulse">
        <div className="h-16 bg-gray-100 rounded" />
      </div>
    );
  }

  return (
    <section className="bg-surface rounded-xl border border-gray-200 p-4 space-y-4">
      {groups.map((g) => (
        <div key={g.label}>
          <h3 className="text-[10px] font-semibold text-gray-400 tracking-wide mb-1.5">{g.label}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 gap-2">
            {g.tiles.map((t) => (
              <IndicatorTile key={t.key} tile={t} onSelect={onSelectSymbol} />
            ))}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-gray-400">
        타일을 누르면 차트가 열립니다. 국내 선물은 차트 소스가 없어 수치만 표시합니다. 60초 갱신.
      </p>
    </section>
  );
}

function IndicatorTile({ tile, onSelect }: { tile: Tile; onSelect: (symbol: string) => void }) {
  const pct = tile.changePct != null ? `${tile.up ? '+' : '-'}${Math.abs(tile.changePct).toFixed(2)}%` : null;
  const clickable = tile.symbol != null;

  const body = (
    <>
      <span className="block text-[11px] text-gray-500 truncate">{tile.name}</span>
      <span className="block text-sm font-semibold text-gray-900 tabular-nums truncate">{tile.value}</span>
      {pct != null && (
        <span className={`block text-[11px] tabular-nums ${tile.up ? 'text-red-500' : 'text-blue-500'}`}>
          {pct}
        </span>
      )}
    </>
  );

  if (!clickable) {
    return <div className="rounded-lg border border-gray-200 px-2.5 py-2">{body}</div>;
  }

  return (
    <button
      onClick={() => onSelect(tile.symbol as string)}
      title={`${tile.name} 차트 보기`}
      className="rounded-lg border border-gray-200 px-2.5 py-2 text-left hover:border-blue-300 hover:bg-blue-50"
    >
      {body}
    </button>
  );
}
