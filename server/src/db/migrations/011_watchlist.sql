-- 관심종목 (개인용 단일 사용자라 소유자 구분 없음)
CREATE TABLE IF NOT EXISTS watchlist (
  ticker     VARCHAR(20) PRIMARY KEY REFERENCES stocks(ticker),
  memo       VARCHAR(200),
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
