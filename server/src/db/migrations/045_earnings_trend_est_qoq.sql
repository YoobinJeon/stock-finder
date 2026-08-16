-- 다음 분기 컨센서스의 **직전 분기 대비(QoQ)** 증가율 적재.
--
-- 3차까지 컨센서스는 YoY만 저장했다. 판정 함수(`earningsTrend.ts`)는 QoQ도 이미 계산하고
-- 있었는데(`estimate.qoq`) 적재만 빠져 있어, 표에서 확정 분기는 YoY·QoQ 둘 다 보이는데
-- 전망은 YoY만 보이는 비대칭이 있었다.
--
-- QoQ의 비교 대상은 대개 **최신 확정 분기**다 — "지금 실적에서 다음 분기에 어디로 가는가"를
-- 보여주므로 YoY보다 직관적인 경우가 많다(계절성이 없는 업종에서 특히).
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS est_revenue_qoq DECIMAL(12,4);
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS est_op_qoq DECIMAL(12,4);
ALTER TABLE stock_earnings_trend
  ADD COLUMN IF NOT EXISTS est_op_qoq_turnaround BOOLEAN NOT NULL DEFAULT FALSE;

-- 컨센서스 QoQ의 비교 대상 금액 (금액 동반 표시 — 와 같은 이유)
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS est_qoq_prev_revenue BIGINT;
ALTER TABLE stock_earnings_trend
  ADD COLUMN IF NOT EXISTS est_qoq_prev_operating_income BIGINT;
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS est_yoy_prev_revenue BIGINT;
ALTER TABLE stock_earnings_trend
  ADD COLUMN IF NOT EXISTS est_yoy_prev_operating_income BIGINT;
