-- 어닝 서프라이즈 포착 — 분기 컨센서스가 확정 실적으로 뒤바뀌는 순간(E→A)에
-- "발표 직전 컨센서스 + 확정치" 한 쌍을 영구 보존한다. WiseReport frq=1은 과거 컨센서스를
-- 제공하지 않아 소급이 불가능하므로, 전환 순간을 놓치면 그 분기는 영영 복원할 수 없다.
CREATE TABLE IF NOT EXISTS earnings_surprises (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker               VARCHAR(20) NOT NULL REFERENCES stocks(ticker),
  fiscal_year          INT NOT NULL,
  fiscal_quarter       INT NOT NULL,
  -- 전환을 포착한 수집일 (실제 발표일이 아니라 우리가 관측한 날 — 최대 1영업일 차이)
  detected_at          DATE NOT NULL,
  -- 직전 추정 행의 stock_financials.updated_at — 컨센서스 신선도(표본 품질) 지표
  estimate_updated_at  TIMESTAMPTZ,
  est_revenue          BIGINT,
  est_operating_income BIGINT,
  est_net_income       BIGINT,
  est_eps              DECIMAL(12,2),
  act_revenue          BIGINT,
  act_operating_income BIGINT,
  act_net_income       BIGINT,
  act_eps              DECIMAL(12,2),
  -- 대표(영업이익) 서프라이즈율 %. 적자·미미한 분모 등 산출 불가 시 NULL
  surprise_pct         DECIMAL(8,2),
  revenue_surprise_pct DECIMAL(8,2),
  -- beat | miss | inline | turn_positive | turn_negative | deficit
  kind                 VARCHAR(20) NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 분기당 1행. 확정치가 사후 정정돼도 최초 기록을 덮지 않는다(INSERT는 DO NOTHING) —
  -- 서프라이즈는 발표 시점의 사건이라 정정치로 갱신하면 사건성이 사라진다.
  UNIQUE (ticker, fiscal_year, fiscal_quarter)
);

CREATE INDEX IF NOT EXISTS idx_earnings_surprises_detected
  ON earnings_surprises(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_earnings_surprises_ticker
  ON earnings_surprises(ticker, fiscal_year DESC, fiscal_quarter DESC);
