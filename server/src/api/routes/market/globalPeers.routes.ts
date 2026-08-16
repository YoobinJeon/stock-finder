import { Router, Request, Response } from 'express';
import { getDb } from '../../../config/database';
import {
  GLOBAL_PEER_GROUPS,
  collectDomesticTickers,
  collectUniqueForeignSymbols,
  inferCurrency,
  type GlobalPeerGroup,
} from '../../../pipeline/globalPeers';
import { fetchYahooSymbolChart } from '../../../pipeline/sources/yahooSymbolChart';
import { asyncHandler } from '../../../utils/asyncHandler';
import { INDICES, MACRO_ITEMS, fetchQuote, fetchStockQuotes } from './shared';

const router = Router();

// ── 글로벌 피어 보드 — 해외 기업 ↔ 국내 피어 그룹 비교 ──

interface ForeignPeerOut {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
  currency: string;
}

interface DomesticPeerOut {
  ticker: string;
  name: string;
  price: number | null;
  changePct: number | null;
}

interface PeerGroupOut {
  name: string;
  foreign: ForeignPeerOut[];
  domestic: DomesticPeerOut[];
}

let globalPeersCache: { data: { asOf: number; groups: PeerGroupOut[] }; at: number } | null = null;
// (2026-07-12) — 5→15그룹으로 해외 심볼이 ~35개까지 늘어 60초는 너무 잦음. 120초로 상향.
// (2026-07-12) — 15→18그룹, 해외 심볼(중복 제외) ~70개로 재차 증가해 180초로 상향.
const GLOBAL_PEERS_TTL = 180 * 1000;
const FOREIGN_QUOTE_CHUNK = 6; // 야후 레이트리밋 방지 — 6개씩 묶어 병렬 조회

/**
 * 전 그룹의 해외 심볼을 중복 제거 후 6개씩 chunk Promise.all로 일괄 조회.
 * collectUniqueForeignSymbols로 중복 정의(예: NVDA가 로봇·AI반도체 그룹에 걸침)를 걸러
 * 동일 심볼을 두 번 fetch하지 않는다.
 */
async function fetchAllForeignQuotes(
  groups: GlobalPeerGroup[],
): Promise<Map<string, ForeignPeerOut>> {
  const all = collectUniqueForeignSymbols(groups);
  const out = new Map<string, ForeignPeerOut>();

  for (let i = 0; i < all.length; i += FOREIGN_QUOTE_CHUNK) {
    const chunk = all.slice(i, i + FOREIGN_QUOTE_CHUNK);
    const results = await Promise.all(
      chunk.map(async (f): Promise<ForeignPeerOut | null> => {
        const q = await fetchQuote(f.symbol).catch(() => null);
        if (!q) return null;
        return {
          symbol: f.symbol,
          name: f.name,
          price: q.price,
          changePct: q.changePct,
          currency: q.currency ?? inferCurrency(f.symbol),
        };
      }),
    );
    results.forEach((r) => { if (r) out.set(r.symbol, r); });
  }

  return out;
}

router.get('/global-peers', asyncHandler(async (_req: Request, res: Response) => {
  if (globalPeersCache && Date.now() - globalPeersCache.at < GLOBAL_PEERS_TTL) {
    res.json(globalPeersCache.data);
    return;
  }

  const db = getDb();
  const domesticTickers = collectDomesticTickers(GLOBAL_PEER_GROUPS);

  // 국내 피어: stocks 이름 JOIN + shared.fetchStockQuotes(네이버 실시간 시세) 재사용.
  // 해외 피어: 전 그룹 심볼을 평탄화해 6개씩 chunk 병렬 조회(fetchAllForeignQuotes) — 개별 심볼
  // 실패는 fail-soft로 해당 항목만 제외.
  const [{ rows: domesticInfoRows }, domesticQuotes, foreignQuoteMap] = await Promise.all([
    domesticTickers.length > 0
      ? db.query(`SELECT ticker, name FROM stocks WHERE ticker = ANY($1)`, [domesticTickers])
      : Promise.resolve({ rows: [] as Array<{ ticker: string; name: string }> }),
    fetchStockQuotes(domesticTickers),
    fetchAllForeignQuotes(GLOBAL_PEER_GROUPS),
  ]);
  const domesticNameMap = new Map(domesticInfoRows.map((r) => [r.ticker, r.name]));

  const groups: PeerGroupOut[] = GLOBAL_PEER_GROUPS.map((g) => {
    const domestic: DomesticPeerOut[] = g.domestic
      .filter((t) => domesticNameMap.has(t))
      .map((t) => {
        const q = domesticQuotes.get(t);
        return {
          ticker: t,
          name: domesticNameMap.get(t)!,
          price: q?.price ?? null,
          changePct: q?.changePct ?? null,
        };
      });

    return {
      name: g.name,
      foreign: g.foreign
        .map((f) => foreignQuoteMap.get(f.symbol))
        .filter((f): f is ForeignPeerOut => f != null),
      domestic,
    };
  });

  const data = { asOf: Date.now(), groups };
  globalPeersCache = { data, at: Date.now() };
  res.json(data);
}));

// ── 심볼 차트 패널 — 해외 기업·지수 클릭 시 차트+기본정보 ──

// 화이트리스트: 지수 7종 + 글로벌 피어 해외 심볼 전체 + 매크로 심볼(확장 여지).
// 외부 입력을 야후 URL에 그대로 꽂지 않기 위한 필수 검증 — 집합에 없으면 400.
const SYMBOL_NAME_MAP: Map<string, string> = new Map([
  ...INDICES.map((i): [string, string] => [i.symbol, i.name]),
  ...GLOBAL_PEER_GROUPS.flatMap((g): Array<[string, string]> => g.foreign.map((f) => [f.symbol, f.name])),
  ...MACRO_ITEMS.map((m): [string, string] => [m.symbol, m.name]),
]);

interface SymbolChartOut {
  symbol: string;
  name: string;
  currency: string;
  price: number | null;
  changePct: number | null;
  high52w: number | null;
  low52w: number | null;
  exchange: string | null;
  candles: Array<{ trade_date: string; open: number | null; high: number | null; low: number | null; close: number | null }>;
}

const symbolChartCache = new Map<string, { data: SymbolChartOut; at: number }>();
const SYMBOL_CHART_TTL = 5 * 60 * 1000;

router.get('/symbol-chart', asyncHandler(async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol ?? '');
  if (!SYMBOL_NAME_MAP.has(symbol)) {
    res.status(400).json({ error: '지원하지 않는 심볼입니다.' });
    return;
  }

  const cached = symbolChartCache.get(symbol);
  if (cached && Date.now() - cached.at < SYMBOL_CHART_TTL) {
    res.json(cached.data);
    return;
  }

  const chart = await fetchYahooSymbolChart(symbol).catch(() => null);
  if (!chart) {
    res.status(502).json({ error: '차트 데이터를 불러오지 못했습니다.' });
    return;
  }

  const data: SymbolChartOut = {
    symbol,
    name: SYMBOL_NAME_MAP.get(symbol) ?? chart.meta.longName ?? symbol,
    currency: chart.meta.currency ?? 'KRW',
    price: chart.meta.price,
    changePct: chart.meta.changePct,
    high52w: chart.meta.high52w,
    low52w: chart.meta.low52w,
    exchange: chart.meta.exchange,
    candles: chart.candles,
  };

  symbolChartCache.set(symbol, { data, at: Date.now() });
  res.json(data);
}));

export default router;
