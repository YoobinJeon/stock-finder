-- 수급(투자자별 매매동향) 원본 — 네이버 trend API, 최근 20영업일 upsert
CREATE TABLE IF NOT EXISTS stock_flows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker          VARCHAR(20) NOT NULL REFERENCES stocks(ticker),
  trade_date      DATE NOT NULL,
  foreign_net     BIGINT,           -- 외국인 순매수 (주)
  inst_net        BIGINT,           -- 기관 순매수 (주)
  individual_net  BIGINT,           -- 개인 순매수 (주)
  foreign_hold_ratio DECIMAL(6,2),  -- 외국인 보유율 (%)
  UNIQUE (ticker, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_flows_ticker_date ON stock_flows(ticker, trade_date DESC);

-- 종목당 1행 기술지표·수급 집계 (지표 계산 페이즈에서 upsert)
CREATE TABLE IF NOT EXISTS stock_indicators (
  ticker             VARCHAR(20) PRIMARY KEY REFERENCES stocks(ticker),
  last_close         DECIMAL(12,2),
  ma20               DECIMAL(12,2),
  ma60               DECIMAL(12,2),
  ma120              DECIMAL(12,2),
  rsi14              DECIMAL(5,2),
  high_52w           DECIMAL(12,2),
  pct_from_52w_high  DECIMAL(6,2),  -- 0 = 신고가, -10 = 고점 대비 -10%
  vol_ratio          DECIMAL(8,2),  -- 최근 5일 평균 거래량 / 20일 평균
  golden_cross       BOOLEAN,       -- MA20 > MA60
  above_ma20         BOOLEAN,
  above_ma60         BOOLEAN,
  foreign_net_5d     BIGINT,        -- 외국인 5일 순매수 합 (주)
  foreign_net_20d    BIGINT,
  inst_net_5d        BIGINT,
  inst_net_20d       BIGINT,
  foreign_buy_streak INT,           -- 외국인 연속 순매수 일수
  inst_buy_streak    INT,
  foreign_hold_ratio DECIMAL(6,2),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 수급·기술 지표 기반 기본 전략
INSERT INTO screener_presets (name, description, criteria, is_builtin) VALUES
  ('외국인 매집', '외국인 최근 5일 순매수 우위 + 3일 이상 연속 순매수', '{"foreignNetBuy5d":true,"minForeignStreak":3}', TRUE),
  ('쌍끌이 수급', '외국인·기관 동반 5일 순매수', '{"foreignNetBuy5d":true,"instNetBuy5d":true}', TRUE),
  ('골든크로스 정배열', 'MA20 > MA60 + 주가가 MA20 위 (상승 추세)', '{"goldenCross":true,"aboveMa20":true}', TRUE),
  ('52주 신고가 근접', '52주 최고가 대비 -5% 이내 + 거래량 20% 이상 증가', '{"maxPctFrom52wHigh":5,"minVolRatio":1.2}', TRUE),
  ('눌림목 후보', '정배열(MA20>MA60) 유지 중 RSI 35~50 조정 구간', '{"goldenCross":true,"rsiMin":35,"rsiMax":50}', TRUE);
