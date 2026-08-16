import { Router, Request, Response } from 'express';
import { getDb } from '../../config/database';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

// 관심종목 목록 (시세·점수·수급 요약 포함)
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const { rows } = await getDb().query(
    `SELECT w.ticker, w.memo, w.added_at,
            s.name, s.market, s.sector,
            ROUND(sc.total_score)::int AS total_score,
            i.last_close, i.day_change,
            i.foreign_amt_5d, i.inst_amt_5d
     FROM watchlist w
     JOIN stocks s ON s.ticker = w.ticker
     LEFT JOIN stock_scores sc ON sc.ticker = w.ticker
     LEFT JOIN stock_indicators i ON i.ticker = w.ticker
     ORDER BY w.added_at DESC`,
  );
  res.json(rows);
}));

// 추가 (이미 있으면 메모만 갱신)
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { ticker, memo } = req.body ?? {};
  if (!ticker || typeof ticker !== 'string') {
    res.status(400).json({ error: 'ticker가 필요합니다.' });
    return;
  }
  const { rows: stock } = await getDb().query('SELECT ticker FROM stocks WHERE ticker = $1', [ticker]);
  if (!stock[0]) {
    res.status(404).json({ error: '존재하지 않는 종목입니다.' });
    return;
  }
  await getDb().query(
    `INSERT INTO watchlist (ticker, memo) VALUES ($1, $2)
     ON CONFLICT (ticker) DO UPDATE SET memo = COALESCE(EXCLUDED.memo, watchlist.memo)`,
    [ticker, typeof memo === 'string' ? memo.slice(0, 200) : null],
  );
  res.status(201).json({ ticker });
}));

// 메모 수정
router.put('/:ticker', asyncHandler(async (req: Request, res: Response) => {
  const memo = typeof req.body?.memo === 'string' ? req.body.memo.slice(0, 200) : null;
  const { rows } = await getDb().query(
    'UPDATE watchlist SET memo = $2 WHERE ticker = $1 RETURNING ticker',
    [req.params.ticker, memo],
  );
  if (!rows[0]) {
    res.status(404).json({ error: '관심종목에 없는 종목입니다.' });
    return;
  }
  res.json({ ticker: req.params.ticker, memo });
}));

// 제거
router.delete('/:ticker', asyncHandler(async (req: Request, res: Response) => {
  await getDb().query('DELETE FROM watchlist WHERE ticker = $1', [req.params.ticker]);
  res.status(204).end();
}));

export default router;
