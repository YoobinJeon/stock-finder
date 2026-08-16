-- 수급 추정평균가 정확화 — 순매수 수량(주) 저장. 기존 "대금÷종가" 근사를 실제 수량으로 대체.
ALTER TABLE stock_flows_krx ADD COLUMN IF NOT EXISTS net_qty BIGINT;      -- 순매수 수량(주, KRX 실측)

ALTER TABLE stock_flows ADD COLUMN IF NOT EXISTS foreign_qty BIGINT;     -- 외국인 순매수 수량(주, 네이버)
ALTER TABLE stock_flows ADD COLUMN IF NOT EXISTS inst_qty BIGINT;        -- 기관 순매수 수량(주, 네이버)
ALTER TABLE stock_flows ADD COLUMN IF NOT EXISTS individual_qty BIGINT;  -- 개인 순매수 수량(주, 네이버)
