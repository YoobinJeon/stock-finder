import { Router } from 'express';
import regimeFlowsRouter from './market/regimeFlows.routes';
import sectorsRouter from './market/sectors.routes';
import overviewRouter from './market/overview.routes';
import moversRouter from './market/movers.routes';
import globalPeersRouter from './market/globalPeers.routes';
import rsRankingRouter from './market/rsRanking';
import earningsSurprisesRouter from './market/earningsSurprises.routes';
import sectorOutlookRouter from './market/sectorOutlook.routes';
import monthlyRouter from './market/monthly.routes';

/**
 * market.routes.ts 관심사별 분리 (949줄 → market/ 하위 5개 라우트 모듈 + shared).
 * 이 파일은 서브 라우터 합성 인덱스로만 동작 — 로직은 각 서브 모듈로 순수 이동(기계적 분리).
 * 외부에서 import하는 심볼(kstMarket, fetchStockQuotes)과 app.ts 마운트 경로는 그대로 유지.
 *
 *   market/shared.ts          — 공유 상수·헬퍼(kstMarket, fetchStockQuotes, fetchQuote, 심볼 테이블)
 *   market/regimeFlows.routes.ts — /regime, /regime/recompute, /flows-ranking
 *   market/sectors.routes.ts     — /sectors, /quotes
 *   market/overview.routes.ts    — / (지수), /news, /macro
 *   market/movers.routes.ts      — /movers, /new-listings
 *   market/globalPeers.routes.ts — /global-peers, /symbol-chart
 *   market/rsRanking.ts          — /rs (RS 랭킹)
 *   market/earningsSurprises.routes.ts — /earnings-surprises
 *   market/sectorOutlook.routes.ts     — /outlook (산업 실적 전망)
 *   market/monthly.routes.ts           — /monthly/* (월간 상승률)
 */
export { kstMarket, fetchStockQuotes } from './market/shared';

const router = Router();

router.use(regimeFlowsRouter);
router.use(sectorsRouter);
router.use(overviewRouter);
router.use(moversRouter);
router.use(globalPeersRouter);
router.use(rsRankingRouter);
router.use(earningsSurprisesRouter);
router.use(sectorOutlookRouter);
router.use(monthlyRouter);

export default router;
