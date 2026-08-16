import { Router, Request, Response } from 'express';
import { compositeScorer } from '../../scoring/CompositeScorer';
import { getDb } from '../../config/database';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

// 티커 형식 검증 (6자리 영숫자) — 다른 라우트와 일관, 잘못된 입력 조기 차단
const TICKER_PARAM_RE = /^[0-9A-Z]{6}$/i;
router.param('ticker', (_req, res, next, ticker) => {
  if (!TICKER_PARAM_RE.test(ticker)) {
    res.status(400).json({ error: '올바르지 않은 종목 코드입니다.' });
    return;
  }
  next();
});

// 개별 종목 점수 조회 (저장된 점수 없으면 실데이터로 즉시 계산 후 저장)
router.get('/:ticker', asyncHandler(async (req: Request, res: Response) => {
  const { ticker } = req.params;
  const db = getDb();

  const { rows } = await db.query('SELECT * FROM stock_scores WHERE ticker = $1', [ticker]);
  if (rows[0]) {
    res.json(rows[0]);
    return;
  }

  const { rows: stockRows } = await db.query(
    'SELECT ticker, name, market, sector, market_cap FROM stocks WHERE ticker = $1',
    [ticker],
  );
  if (!stockRows[0]) {
    res.status(404).json({ error: 'Stock not found' });
    return;
  }

  const result = await compositeScorer.score(stockRows[0], {});
  await db.query(
    `INSERT INTO stock_scores (ticker, total_score, breakdown, scored_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (ticker) DO UPDATE
       SET total_score = EXCLUDED.total_score, breakdown = EXCLUDED.breakdown, scored_at = NOW()`,
    [ticker, result.total, JSON.stringify(result.breakdown)],
  );
  res.json({
    ticker,
    total_score: result.total,
    breakdown: result.breakdown,
    scored_at: result.calculatedAt,
  });
}));

// 상위 종목 랭킹
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const { rows } = await getDb().query(
    `SELECT s.ticker, s.name, s.market, s.sector, ROUND(sc.total_score)::int AS total_score
     FROM stocks s
     LEFT JOIN stock_scores sc ON sc.ticker = s.ticker
     WHERE s.is_active = TRUE
     ORDER BY sc.total_score DESC NULLS LAST, s.name
     LIMIT 20`,
  );
  res.json(rows);
}));

export default router;
