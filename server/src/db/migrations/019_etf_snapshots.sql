-- ETF 일별 스냅샷 (네이버 실시간 시세를 하루 1회 적재 → 자금유입 추정·RS 순위 계산용)
CREATE TABLE IF NOT EXISTS etf_daily_snapshots (
  ticker          VARCHAR(20)  NOT NULL,   -- FK 없음 (ETF는 stocks 테이블 밖)
  snap_date       DATE         NOT NULL,
  name            VARCHAR(100) NOT NULL,
  tab             INT          NOT NULL,   -- 네이버 분류 1~7
  close           DECIMAL(12,2),
  change_pct      DECIMAL(8,2),
  nav             DECIMAL(12,2),
  deviation_pct   DECIMAL(8,2),
  three_month_return DECIMAL(8,2),
  volume          BIGINT,
  amount          BIGINT,                  -- 거래대금 (백만원)
  market_cap      BIGINT,                  -- 시가총액 (억원)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, snap_date)
);
CREATE INDEX IF NOT EXISTS idx_etf_snap_date ON etf_daily_snapshots(snap_date DESC);
