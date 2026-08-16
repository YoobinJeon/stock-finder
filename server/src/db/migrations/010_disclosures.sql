-- DART 공시 이벤트 (점수 이벤트 룰 + 종목 상세 공시 표시)
CREATE TABLE IF NOT EXISTS disclosure_events (
  rcept_no    VARCHAR(20) PRIMARY KEY,   -- DART 접수번호
  ticker      VARCHAR(20) NOT NULL,
  rcept_dt    DATE NOT NULL,
  report_nm   VARCHAR(300) NOT NULL,
  event_type  VARCHAR(20),               -- exclusion | penalty | bonus | NULL(정보성)
  score_delta INT NOT NULL DEFAULT 0,    -- 감점(-)/가점(+), exclusion은 0 (점수 캡으로 처리)
  detail      VARCHAR(100)               -- 사람이 읽는 분류 라벨
);

CREATE INDEX IF NOT EXISTS idx_disclosures_ticker_date ON disclosure_events(ticker, rcept_dt DESC);
CREATE INDEX IF NOT EXISTS idx_disclosures_date ON disclosure_events(rcept_dt DESC);
