-- 테마 일별 스냅샷 (네이버 테마 등락률을 하루 1회 적재 → 로테이션(모멘텀·연속상승) 감지용)
CREATE TABLE IF NOT EXISTS theme_daily_snapshots (
  theme_no   INT  NOT NULL,        -- FK 없음 (테마 목록 갱신과 독립적으로 이력 보존)
  snap_date  DATE NOT NULL,
  name       TEXT NOT NULL,
  chg_pct    DECIMAL(8,2),
  up_cnt     INT,
  down_cnt   INT,
  total_cnt  INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (theme_no, snap_date)
);
CREATE INDEX IF NOT EXISTS idx_theme_snap_date ON theme_daily_snapshots(snap_date DESC);
