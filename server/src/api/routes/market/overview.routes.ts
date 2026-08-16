import { Router, Request, Response } from 'express';
import { fetchNaverIndex } from '../../../pipeline/sources/naverIndex';
import { fetchMainNews } from '../../../pipeline/sources/naverNews';
import { fetchNaverFutures } from '../../../pipeline/sources/naverFutures';
import { fetchTvFutures } from '../../../pipeline/sources/tradingviewFutures';
import { fetchKisNightFutures } from '../../../pipeline/sources/kisNightFutures';
import { asyncHandler } from '../../../utils/asyncHandler';
import { createTtlCache } from '../../../utils/ttlCache';
import {
  INDICES,
  MACRO_ITEMS,
  MACRO_FUTURES_ITEMS,
  MACRO_TV_FUTURES_ITEMS,
  MACRO_KIS_FUTURES_ITEMS,
  fetchQuote,
} from './shared';

const router = Router();

// 지수 개요 메모리 캐시 (1분) + single-flight
const overviewCache = createTtlCache(60 * 1000, async () => {
  const results = await Promise.all(
      INDICES.map(async (idx) => {
        // 한국 지수(KOSPI/KOSDAQ)는 네이버 실시간 — Yahoo는 ~20분 지연. 실패 시 Yahoo로 폴백.
        if (idx.key === 'kospi' || idx.key === 'kosdaq') {
          const ni = await fetchNaverIndex(idx.key === 'kospi' ? 'KOSPI' : 'KOSDAQ').catch(() => null);
          if (ni) {
            return {
              key: idx.key, name: idx.name,
              price: ni.price, change: ni.change, changePct: ni.changePct,
              up: ni.change >= 0, asOf: Date.now(), // 네이버는 실시간 — 조회 시각 = 데이터 시각
            };
          }
        }
        const quote = await fetchQuote(idx.symbol).catch(() => null);
        return {
          key:       idx.key,
          name:      idx.name,
          price:     quote?.price     ?? null,
          change:    quote?.change    ?? null,
          changePct: quote?.changePct ?? null,
          up:        quote?.up        ?? true,
          asOf:      quote?.asOf      ?? null,
        };
      }),
    );

  return Object.fromEntries(results.map(r => [r.key, r]));
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(await overviewCache.get());
  } catch {
    res.status(502).json({ error: 'Failed to fetch market data' });
  }
});

// ── 시장 주요뉴스 (네이버 증권 mainnews — 뉴스 피드) ──
router.get('/news', asyncHandler(async (_req: Request, res: Response) => {
  const items = await fetchMainNews(20);
  res.json({ count: items.length, items });
}));

// ── 매크로 티커 (글로벌 지표 — 대부분 24시간 거래라 장중 게이팅 없음) ──

let macroCache: { data: any; at: number } | null = null;
const MACRO_TTL = 60 * 1000;

router.get('/macro', asyncHandler(async (_req: Request, res: Response) => {
  if (macroCache && Date.now() - macroCache.at < MACRO_TTL) {
    res.json(macroCache.data);
    return;
  }

  const [yahooItems, futuresMap, tvFuturesMap, kisFuturesQuotes] = await Promise.all([
    Promise.all(
      MACRO_ITEMS.map(async (m) => {
        const q = await fetchQuote(m.symbol).catch(() => null); // 심볼별 fail-soft
        return {
          key: m.key,
          // 클릭 시 심볼 차트(/market/symbol-chart)를 열기 위해 심볼을 함께 내려준다.
          // MACRO_ITEMS는 차트 화이트리스트에도 들어 있어 그대로 조회 가능하다.
          symbol: m.symbol,
          name: m.name,
          unit: m.unit,
          price: q?.price != null ? q.price * m.scale : null,
          change: q?.change != null ? q.change * m.scale : null,
          changePct: q?.changePct ?? null,
          up: q?.up ?? true,
        };
      }),
    ),
    fetchNaverFutures(MACRO_FUTURES_ITEMS.map((m) => m.itemCode)),
    fetchTvFutures(MACRO_TV_FUTURES_ITEMS.map((m) => m.ticker)),
    // 야간선물은 항목별 fail-soft — 하나가 null이어도 나머지 매크로 항목은 그대로 나간다
    Promise.all(MACRO_KIS_FUTURES_ITEMS.map((m) => fetchKisNightFutures(m.iscd))),
  ]);

  const futuresItems = MACRO_FUTURES_ITEMS.map((m) => {
    const q = futuresMap.get(m.itemCode);
    return {
      key: m.key,
      name: m.name,
      unit: null as 'pct' | null,
      price: q?.price ?? null,
      change: q?.change ?? null,
      changePct: q?.changePct ?? null,
      up: q?.up ?? true,
    };
  });

  // 트레이딩뷰 scanner는 change(등락률 %)만 제공 — 등락폭(change)은 별도 계산 없이 null
  const tvFuturesItems = MACRO_TV_FUTURES_ITEMS.map((m) => {
    const q = tvFuturesMap.get(m.ticker);
    return {
      key: m.key,
      name: m.name,
      unit: null as 'pct' | null,
      price: q?.price ?? null,
      change: null as number | null,
      changePct: q?.changePct ?? null,
      up: (q?.changePct ?? 0) >= 0,
    };
  });

  // 야간선물 — 종목명은 만기가 섞인 원본(`F 202609`) 대신 스트립용 고정 라벨을 쓴다
  const kisFuturesItems = MACRO_KIS_FUTURES_ITEMS.map((m, i) => {
    const q = kisFuturesQuotes[i];
    return {
      key: m.key,
      name: m.name,
      unit: null as 'pct' | null,
      price: q?.price ?? null,
      change: q?.change ?? null,
      changePct: q?.changePct ?? null,
      up: q?.up ?? true,
    };
  });

  const items = [...yahooItems, ...futuresItems, ...tvFuturesItems, ...kisFuturesItems];
  const data = { asOf: Date.now(), items };
  if (items.some((i) => i.price != null)) macroCache = { data, at: Date.now() };
  res.json(data);
}));

export default router;
