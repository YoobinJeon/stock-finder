-- 시그널: 지표 계산 페이즈에서 자동 감지되는 이벤트 (수집/재채점 시 갱신)
CREATE TABLE IF NOT EXISTS signals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_date DATE NOT NULL,          -- 감지 기준 거래일 (해당 종목의 최신 일봉 날짜)
  ticker      VARCHAR(20) NOT NULL REFERENCES stocks(ticker),
  type        VARCHAR(30) NOT NULL,   -- golden_cross | high_52w | foreign_streak | dual_flow
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (signal_date, ticker, type)
);

CREATE INDEX IF NOT EXISTS idx_signals_date ON signals(signal_date DESC);

-- 전일 대비 등락률 (스크리너 표시·정렬용)
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS day_change DECIMAL(6,2);
