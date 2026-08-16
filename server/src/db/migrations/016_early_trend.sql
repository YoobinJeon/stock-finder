-- 추세 초기 전환 판정용 단기 이평선 (MA5·MA10)
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS ma5  DECIMAL(12,2);
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS ma10 DECIMAL(12,2);
-- early_trend: MA5 ≥ MA10 (5일선이 10일선 위/상향돌파) AND MA10 우상향
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS early_trend BOOLEAN;
