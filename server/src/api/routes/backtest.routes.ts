import { Router, Request, Response } from 'express';
import { runBacktest, runHistoryBacktest, getHistoryDates } from '../../backtest/runBacktest';
import { evaluateStrategies } from '../../backtest/strategyEval';
import { evalWeightSets, DEFAULT_WEIGHT_CANDIDATES, type WeightCandidate } from '../../backtest/weightEval';
import { saveBacktestRun, listBacktestRuns, type BacktestRunKind } from '../../backtest/backtestRuns';
import { logger } from '../../utils/logger';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

const MAX_WEIGHT_CANDIDATES = 10;

/** 실행 결과 저장 실패로 API 응답까지 실패하지 않도록 fail-soft 처리 */
async function saveRunSafely(kind: BacktestRunKind, params: Record<string, any>, result: Record<string, any>): Promise<void> {
  try {
    await saveBacktestRun(kind, params, result);
  } catch (e: any) {
    logger.warn(`백테스트 결과 저장 실패 (kind=${kind})`, e);
  }
}

// 전략 성과 검증 + 전략 탐색 (PIT 기준)
router.post('/strategies', async (req: Request, res: Response) => {
  const monthsAgo = Number(req.body?.monthsAgo);
  if (![1, 3, 6].includes(monthsAgo)) {
    res.status(400).json({ error: 'monthsAgo는 1 | 3 | 6 중 하나여야 합니다.' });
    return;
  }
  try {
    const result = await evaluateStrategies(monthsAgo);
    await saveRunSafely('strategies', { monthsAgo }, result);
    res.json(result);
  } catch (e: any) {
    res.status(422).json({ error: e?.message ?? '전략 검증 실패' });
  }
});

// 기록 기반 백테스트에 쓸 수 있는 기준일 목록 (점수 이력이 쌓인 날짜)
router.get('/history-dates', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getHistoryDates());
}));

// 저장된 백테스트 실행 이력 (최신순)
router.get('/runs', asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 100);
  res.json(await listBacktestRuns(limit));
}));

// 백테스트 실행 (동기 — 전 종목 수 초 내외)
// mode: 'pit'(시점 재계산, monthsAgo 필요) | 'history'(저장된 점수, asOf 필요)
router.post('/run', async (req: Request, res: Response) => {
  const mode = req.body?.mode === 'history' ? 'history' : 'pit';
  const top = Math.min(Math.max(Number(req.body?.top) || 20, 5), 50);

  try {
    if (mode === 'history') {
      const asOf = String(req.body?.asOf ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
        res.status(400).json({ error: 'asOf는 YYYY-MM-DD 형식이어야 합니다.' });
        return;
      }
      const result = await runHistoryBacktest(asOf, top);
      await saveRunSafely('backtest', { mode, asOf, top }, result);
      res.json(result);
      return;
    }

    const monthsAgo = Number(req.body?.monthsAgo);
    if (![1, 3, 6].includes(monthsAgo)) {
      res.status(400).json({ error: 'monthsAgo는 1 | 3 | 6 중 하나여야 합니다.' });
      return;
    }
    const result = await runBacktest(monthsAgo, top);
    await saveRunSafely('backtest', { mode, monthsAgo, top }, result);
    res.json(result);
  } catch (e: any) {
    res.status(422).json({ error: e?.message ?? '백테스트 실패' });
  }
});

// 가중치 세트 평가 — 후보 가중 벡터들을 같은 PIT 데이터셋에 적용해 성과 비교
router.post('/weights', async (req: Request, res: Response) => {
  const monthsAgo = Number(req.body?.monthsAgo);
  if (![1, 3, 6].includes(monthsAgo)) {
    res.status(400).json({ error: 'monthsAgo는 1 | 3 | 6 중 하나여야 합니다.' });
    return;
  }

  const rawCandidates = req.body?.candidates;
  let candidates: WeightCandidate[] = DEFAULT_WEIGHT_CANDIDATES;
  if (rawCandidates != null) {
    if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
      res.status(400).json({ error: 'candidates는 비어있지 않은 배열이어야 합니다.' });
      return;
    }
    if (rawCandidates.length > MAX_WEIGHT_CANDIDATES) {
      res.status(400).json({ error: `candidates는 최대 ${MAX_WEIGHT_CANDIDATES}개까지 지원합니다.` });
      return;
    }
    for (const c of rawCandidates) {
      if (typeof c?.name !== 'string' || c.name.trim() === '') {
        res.status(400).json({ error: '각 candidate는 name(문자열)이 필요합니다.' });
        return;
      }
      const w = c?.weights;
      if (w == null || typeof w !== 'object') {
        res.status(400).json({ error: `candidate "${c.name}"의 weights가 없습니다.` });
        return;
      }
      const sum = ['value', 'quality', 'growth', 'momentum'].reduce(
        (s, k) => s + (typeof w[k] === 'number' ? w[k] : 0), 0,
      );
      if (sum <= 0) {
        res.status(400).json({ error: `candidate "${c.name}"의 value/quality/growth/momentum 가중치 합이 0 이하입니다.` });
        return;
      }
    }
    candidates = rawCandidates as WeightCandidate[];
  }

  try {
    const result = await evalWeightSets(monthsAgo, candidates);
    await saveRunSafely('weights', { monthsAgo, candidates }, result);
    res.json(result);
  } catch (e: any) {
    res.status(422).json({ error: e?.message ?? '가중치 평가 실패' });
  }
});

export default router;
