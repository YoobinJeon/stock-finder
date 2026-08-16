-- 기술·기본 지표 확장 — MACD·볼린저밴드·ATR·OBV·거래대금급증·간이 F-score.
-- computeIndicators()가 저장 시세/재무로 계산해 채운다(rescore 포함 전 스코프에서 재계산). 전부 nullable.
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS macd            DECIMAL(14,4);  -- MACD 라인(EMA12-EMA26)
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS macd_signal     DECIMAL(14,4);  -- 시그널(MACD의 EMA9)
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS macd_hist       DECIMAL(14,4);  -- 히스토그램(macd-signal)
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS bb_upper        DECIMAL(14,4);  -- 볼린저 상단
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS bb_mid          DECIMAL(14,4);  -- 볼린저 중심(SMA20)
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS bb_lower        DECIMAL(14,4);  -- 볼린저 하단
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS bb_pctb         DECIMAL(8,4);   -- %B(밴드 내 위치)
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS bb_bandwidth    DECIMAL(8,4);   -- 밴드폭 비율
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS atr14           DECIMAL(14,4);  -- ATR(14)
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS atr_pct         DECIMAL(8,4);   -- ATR 현재가 대비 %
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS obv             DECIMAL(20,2);  -- OBV 누적값
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS obv_trend       SMALLINT;       -- OBV 추세 -1/0/1
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS turnover_surge  DECIMAL(10,4);  -- 당일 거래대금/20일 평균 배수
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS f_score         SMALLINT;       -- 간이 F-score 통과 수
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS f_score_max     SMALLINT;       -- 산정 가능 기준 수(≤5)
