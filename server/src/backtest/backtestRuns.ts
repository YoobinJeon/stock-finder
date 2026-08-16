import { getDb } from '../config/database';

/**
 * 백테스트 실행 결과 저장 — 실행 간 비교가 안 되던 문제 해소.
 * kind: 'backtest'(POST /backtest/run) | 'strategies'(POST /backtest/strategies) | 'weights'(POST /backtest/weights)
 */

export type BacktestRunKind = 'backtest' | 'strategies' | 'weights';

export interface BacktestRunSummary {
  id: number;
  runAt: string;
  kind: BacktestRunKind;
  params: Record<string, any>;
  result: Record<string, any>;
}

function parseJsonb(v: unknown): Record<string, any> {
  if (typeof v === 'string') return JSON.parse(v);
  return (v as Record<string, any>) ?? {};
}

export async function saveBacktestRun(
  kind: BacktestRunKind,
  params: Record<string, any>,
  result: Record<string, any>,
): Promise<void> {
  const db = getDb();
  await db.query(
    `INSERT INTO backtest_runs (kind, params, result) VALUES ($1, $2, $3)`,
    [kind, JSON.stringify(params), JSON.stringify(result)],
  );
}

export async function listBacktestRuns(limit: number): Promise<BacktestRunSummary[]> {
  const db = getDb();
  const { rows } = await db.query(
    `SELECT id, to_char(run_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS run_at, kind, params, result
     FROM backtest_runs ORDER BY run_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r: any) => ({
    id: r.id,
    runAt: r.run_at,
    kind: r.kind,
    params: parseJsonb(r.params),
    result: parseJsonb(r.result),
  }));
}
