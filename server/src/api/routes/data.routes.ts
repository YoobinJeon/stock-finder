import { Router, Request, Response } from 'express';
import { getDb } from '../../config/database';
import { logger } from '../../utils/logger';
import { jobRunner } from '../../pipeline/JobRunner';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  runIngest, INGEST_SCOPES, IngestScope, pollDisclosures, pollTodayFlows, backfillRecentFlowQty,
} from '../../pipeline/ingest';
import { detectPriceBreaks, runPriceRepair } from '../../pipeline/priceRepair';
import { createTtlCache } from '../../utils/ttlCache';
import { countWeekdaysBetweenUTC } from '../../utils/dateOnly';

const router = Router();

// 'flow-qty'는 일반 수집(runIngest) 대상이 아닌 1회성 소급 백필이라 INGEST_SCOPES에는 넣지 않고 별도 분기.
const REFRESH_SCOPES = [...INGEST_SCOPES, 'flow-qty'];

// 데이터 신선도 — /summary가 DataPage에서 수집 중 5초마다 폴링되므로 MAX(trade_date)
// 재계산을 캐시로 완충. 신선도는 자주 안 바뀌는 값이라 5분 TTL이면 충분하다.
const FRESHNESS_CACHE_TTL_MS = 5 * 60 * 1000;

/** 현재 KST 날짜 (YYYY-MM-DD) — etfSnapshot.ts kstToday류와 동일 계산 방식 */
function kstToday(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

interface Freshness {
  /** stock_prices 최신 거래일 (YYYY-MM-DD) — 데이터가 전혀 없으면 null */
  latestTradeDate: string | null;
  /** 오늘(KST) 기준 최신 거래일로부터 경과한 평일 수 — 주말만 제외한 근사치(dateOnly countWeekdaysBetweenUTC 한계 참고) */
  businessDaysBehind: number | null;
}

const freshnessCache = createTtlCache<Freshness>(FRESHNESS_CACHE_TTL_MS, async () => {
  const db = getDb();
  const { rows } = await db.query(
    `SELECT to_char(MAX(trade_date), 'YYYY-MM-DD') AS d FROM stock_prices`,
  );
  const latestTradeDate: string | null = rows[0]?.d ?? null;
  return {
    latestTradeDate,
    businessDaysBehind: latestTradeDate ? countWeekdaysBetweenUTC(latestTradeDate, kstToday()) : null,
  };
});

// 수집 시작 (202) — 이미 실행 중이면 409
router.post('/refresh', (req: Request, res: Response) => {
  const scope = (req.body?.scope ?? 'top200') as IngestScope | 'flow-qty';
  if (!REFRESH_SCOPES.includes(scope)) {
    res.status(400).json({ error: `scope는 ${REFRESH_SCOPES.join(' | ')} 중 하나여야 합니다.` });
    return;
  }

  // 수급 수량 백필 (수급 추정평균가 정확화) — net_qty/foreign_qty 등 컬럼 소급 채우기
  if (scope === 'flow-qty') {
    const started = jobRunner.start(scope, async (job) => {
      job.setPhase('수급 수량 백필');
      await backfillRecentFlowQty();
    });
    if (!started) {
      res.status(409).json({ error: '이미 실행 중인 수집 작업이 있습니다.', status: jobRunner.getStatus() });
      return;
    }
    res.status(202).json(jobRunner.getStatus());
    return;
  }

  const started = jobRunner.start(scope, (job) => runIngest(scope, job));
  if (!started) {
    res.status(409).json({ error: '이미 실행 중인 수집 작업이 있습니다.', status: jobRunner.getStatus() });
    return;
  }
  res.status(202).json(jobRunner.getStatus());
});

// 진행 상태 (UI 폴링용)
router.get('/status', (_req: Request, res: Response) => {
  res.json(jobRunner.getStatus());
});

// 공시 즉시 폴링 (새 공시 수집 → 영향 종목 재채점) — 수집 잡과 별개로 가벼움
router.post('/poll-disclosures', async (_req: Request, res: Response) => {
  if (jobRunner.isRunning()) {
    res.status(409).json({ error: '이미 실행 중인 수집 작업이 있습니다.', status: jobRunner.getStatus() });
    return;
  }
  try {
    await pollDisclosures();
    res.json({ ok: true });
  } catch (e) {
    logger.warn('공시 즉시 폴링 실패', e);
    res.status(500).json({ ok: false, error: '요청 처리 중 오류가 발생했습니다.' });
  }
});

// 마감 직후 당일 수급만 수집 (KRX [12010] — 세부주체 + 외인·기관·개인 기본)
router.post('/poll-flows', async (_req: Request, res: Response) => {
  if (jobRunner.isRunning()) {
    res.status(409).json({ error: '이미 실행 중인 수집 작업이 있습니다.', status: jobRunner.getStatus() });
    return;
  }
  try {
    const date = await pollTodayFlows();
    res.json({ ok: true, date });
  } catch (e) {
    logger.warn('마감 수급 폴링 실패', e);
    res.status(500).json({ ok: false, error: '요청 처리 중 오류가 발생했습니다.' });
  }
});

// 기업 액션(감자·병합·분할) 미보정 가격 재정합 — 이상 종가 비율 감지 → 해당 종목만 수정주가 재수집.
// 수집 작업(jobRunner)과 동시에 stock_prices를 건드리면 충돌하므로 실행 중이면 409.
router.post('/repair-prices', async (_req: Request, res: Response) => {
  if (jobRunner.isRunning()) {
    res.status(409).json({ error: '이미 실행 중인 수집 작업이 있습니다.', status: jobRunner.getStatus() });
    return;
  }
  try {
    const result = await runPriceRepair();
    res.json(result);
  } catch (e) {
    logger.warn('수정주가 복구 실패', e);
    res.status(500).json({ error: '요청 처리 중 오류가 발생했습니다.' });
  }
});

// 데이터 보유 현황 요약
router.get('/summary', asyncHandler(async (_req: Request, res: Response) => {
  const db = getDb();
  const [stocks, inactiveStocks, financials, prices, scores, lastRun, freshness, priceBreaks] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS c FROM stocks WHERE is_active = TRUE'),
    // 상장폐지 자동 감지로 비활성화된 종목 수 — 가시성 노출용
    db.query('SELECT COUNT(*)::int AS c FROM stocks WHERE is_active = FALSE'),
    db.query('SELECT COUNT(DISTINCT ticker)::int AS c FROM stock_financials'),
    db.query('SELECT COUNT(DISTINCT ticker)::int AS c FROM stock_prices'),
    db.query('SELECT COUNT(*)::int AS c FROM stock_scores'),
    db.query(
      `SELECT scope, status, started_at, finished_at, deactivated
       FROM ingest_runs ORDER BY started_at DESC LIMIT 1`,
    ),
    // 데이터 신선도·휴장 구분 배지 — 5분 캐시(freshnessCache)
    freshnessCache.get(),
    // 기업 액션 미반영으로 종가 눈금이 튄 종목 — 재정합이 원천 한계로 못 고친 것들이 남는다.
    // 월간 상승률이 이 종목들의 해당 달을 제외하는 근거라, 목록을 숨기지 않고 노출한다.
    detectPriceBreaks(),
  ]);

  // 파손 종목의 이름 — 목록이 비면 조회하지 않는다.
  const breakNames = priceBreaks.length === 0 ? [] : (await db.query(
    'SELECT ticker, name FROM stocks WHERE ticker = ANY($1) ORDER BY name',
    [priceBreaks],
  )).rows as Array<{ ticker: string; name: string }>;

  res.json({
    stocks: stocks.rows[0].c,
    inactiveStocks: inactiveStocks.rows[0].c,
    financials: financials.rows[0].c,
    prices: prices.rows[0].c,
    scores: scores.rows[0].c,
    lastRun: lastRun.rows[0] ?? null,
    freshness,
    // 티커만 주면 화면에서 무엇인지 알 수 없다 — 종목명을 붙여 그대로 읽히게 한다.
    priceBreaks: { count: priceBreaks.length, items: breakNames },
  });
}));

export default router;
