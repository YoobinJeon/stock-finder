-- 수급 당일평단 정밀화 — 순매수(net) 대신 매수(BID)측 대금·수량 저장.
-- 키움 추정평균가는 매수대금÷매수수량이라 순매수 기준과 최대 ~1% 차이(그날 매도가 섞이면 갈림).
ALTER TABLE stock_flows_krx ADD COLUMN IF NOT EXISTS buy_amt BIGINT;   -- 매수 거래대금(원, BID)
ALTER TABLE stock_flows_krx ADD COLUMN IF NOT EXISTS buy_qty BIGINT;   -- 매수 거래수량(주, BID)
