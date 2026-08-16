-- KRX 세부 투자자별 수급 (연기금·투신·사모·금융투자·보험·은행) — [12010] 순매수대금(원)
CREATE TABLE IF NOT EXISTS stock_flows_krx (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_date  DATE NOT NULL,
  ticker      VARCHAR(20) NOT NULL,
  investor    VARCHAR(20) NOT NULL,   -- 금융투자|보험|투신|사모|은행|연기금
  net_amt     BIGINT NOT NULL,        -- 순매수 거래대금 (원)
  UNIQUE (trade_date, ticker, investor)
);

CREATE INDEX IF NOT EXISTS idx_flows_krx_date ON stock_flows_krx(trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_flows_krx_ticker ON stock_flows_krx(ticker, trade_date DESC);
