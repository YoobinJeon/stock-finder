-- ETF 국면(state) 일별 이력 — 차트보드 큐레이션 종목의 국면 전환 타임라인용
CREATE TABLE IF NOT EXISTS etf_phase_history (
  ticker         VARCHAR(20) NOT NULL,
  snap_date      DATE        NOT NULL,
  name           VARCHAR(100) NOT NULL,
  state          VARCHAR(10) NOT NULL,   -- entered|aligned|neutral|exited
  aligned_streak INT         NOT NULL DEFAULT 0,
  recent_exit    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, snap_date)
);
CREATE INDEX IF NOT EXISTS idx_etf_phase_date ON etf_phase_history(snap_date DESC);
