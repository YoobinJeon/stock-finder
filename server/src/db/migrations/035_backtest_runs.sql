-- 백테스트 실행 결과 저장 — 실행 간 비교 불가 문제 해소.
-- kind: 'backtest'(PIT/기록 재현, POST /backtest/run) | 'strategies'(POST /backtest/strategies)
--       | 'weights'(POST /backtest/weights)
CREATE TABLE IF NOT EXISTS backtest_runs (
  id       SERIAL PRIMARY KEY,
  run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind     TEXT NOT NULL,
  params   JSONB NOT NULL,
  result   JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_run_at ON backtest_runs(run_at DESC);
