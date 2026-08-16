-- 실적 개선 판정 확장 — 연속 개선 분기 수 + 다음 분기 컨센서스 수치.
--
-- 1차 구현은 분기 이력이 5개뿐이어서 "직전 분기 대비 개선인가"만 볼 수 있었고, 다음 분기
-- 기대치는 불리언 하나로 뭉갰다. DART 분기 백필(042)로 이력이 12분기로 늘어나 연속성을
-- 판정할 수 있게 됐고, 이미 적재돼 있던 컨센서스 분기의 금액·증가율도 함께 노출한다.

-- 연속 개선 분기 수 — 최신 확정 분기부터 거꾸로 세어 개선이 끊기는 지점까지.
-- YoY는 각 분기가 자기 전년 동분기와, QoQ는 자기 직전 분기와 비교된다.
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS yoy_streak INT NOT NULL DEFAULT 0;
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS qoq_streak INT NOT NULL DEFAULT 0;

-- 다음(최초) 컨센서스 분기 — 어느 분기의 전망인지와 그 금액·증가율.
-- est_op_yoy가 NULL이면서 est_op_yoy_turnaround가 TRUE면 적자→흑자 전환 전망이다.
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS est_year INT;
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS est_quarter INT;
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS est_revenue BIGINT;
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS est_operating_income BIGINT;
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS est_revenue_yoy DECIMAL(12,4);
ALTER TABLE stock_earnings_trend ADD COLUMN IF NOT EXISTS est_op_yoy DECIMAL(12,4);
ALTER TABLE stock_earnings_trend
  ADD COLUMN IF NOT EXISTS est_op_yoy_turnaround BOOLEAN NOT NULL DEFAULT FALSE;

-- 연속 개선 상위를 좁힐 때 쓰는 인덱스 (1분기 이상만 — 대다수가 0이라 선택도가 높다)
CREATE INDEX IF NOT EXISTS idx_earnings_trend_streak
  ON stock_earnings_trend(yoy_streak DESC) WHERE yoy_streak > 0;
