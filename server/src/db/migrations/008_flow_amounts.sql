-- 수급을 금액(원)으로: 순매수 수량 × 당일 종가 근사
ALTER TABLE stock_flows ADD COLUMN IF NOT EXISTS foreign_amt    BIGINT;  -- 외국인 순매수 금액(원)
ALTER TABLE stock_flows ADD COLUMN IF NOT EXISTS inst_amt       BIGINT;
ALTER TABLE stock_flows ADD COLUMN IF NOT EXISTS individual_amt BIGINT;

ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS foreign_amt_5d  BIGINT;
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS foreign_amt_20d BIGINT;
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS inst_amt_5d     BIGINT;
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS inst_amt_20d    BIGINT;

-- 기존 수급 데이터 백필: 보유 일봉 종가로 금액 계산
UPDATE stock_flows f SET
  foreign_amt    = (f.foreign_net * p.close)::bigint,
  inst_amt       = (f.inst_net * p.close)::bigint,
  individual_amt = (f.individual_net * p.close)::bigint
FROM stock_prices p
WHERE p.ticker = f.ticker AND p.trade_date = f.trade_date AND p.close IS NOT NULL
  AND f.foreign_amt IS NULL;
