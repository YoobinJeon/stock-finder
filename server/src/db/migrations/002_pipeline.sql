-- 데이터 수집 실행 이력 (마지막 갱신 시각 표시 + 실패 추적)
CREATE TABLE IF NOT EXISTS ingest_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       VARCHAR(20) NOT NULL,           -- top200 | kospi | all
  status      VARCHAR(20) NOT NULL DEFAULT 'running',  -- running | done | error
  total       INT NOT NULL DEFAULT 0,
  done        INT NOT NULL DEFAULT 0,
  failed      JSONB NOT NULL DEFAULT '[]',
  error       TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingest_runs_started ON ingest_runs(started_at DESC);
