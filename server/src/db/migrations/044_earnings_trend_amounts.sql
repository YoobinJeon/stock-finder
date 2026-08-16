-- 실적 개선 판정에 **금액**을 함께 적재.
--
-- 1차·2차는 증가율만 저장해 "+261.5%"만 보였다. 규모를 판단할 수 없다는 게 문제였다 —
-- 매출 100억이 300억이 된 것과 10조가 30조가 된 것이 같은 +200%로 보인다.
-- 기준 분기 금액과 **비교 대상 분기 금액**을 함께 담아 "어디서 어디로" 갔는지 보이게 한다.
--
-- 연간 실적 컬럼(stock_financials의 연간 행)과는 별개다 — 이쪽은 분기 단독 금액이다.

-- 판정 기준이 된 최신 확정 분기의 금액
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS base_revenue BIGINT;
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS base_operating_income BIGINT;

-- 비교 대상 분기의 금액 (YoY = 전년 동분기, QoQ = 직전 분기).
-- 비교 대상이 없으면 NULL이며, 그때 증가율도 NULL이다(판정 불가).
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS yoy_prev_revenue BIGINT;
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS yoy_prev_operating_income BIGINT;
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS qoq_prev_revenue BIGINT;
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS qoq_prev_operating_income BIGINT;
