-- 핵심 스키마: 종목 / 시세 / 재무 / 점수 / 알고리즘 설정
-- (v2 리모델링 — 인증·유저 테이블 제거, 점수 테이블 단일행 upsert 구조로 정정)

CREATE TABLE IF NOT EXISTS stocks (
  ticker          VARCHAR(20) PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  market          VARCHAR(10)  NOT NULL,  -- KOSPI, KOSDAQ
  sector          VARCHAR(50),
  industry        VARCHAR(50),
  market_cap      BIGINT,
  listed_at       DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_prices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker          VARCHAR(20) NOT NULL REFERENCES stocks(ticker),
  trade_date      DATE NOT NULL,
  open            DECIMAL(12,2),
  high            DECIMAL(12,2),
  low             DECIMAL(12,2),
  close           DECIMAL(12,2),
  volume          BIGINT,
  UNIQUE (ticker, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_prices_ticker_date ON stock_prices(ticker, trade_date DESC);

CREATE TABLE IF NOT EXISTS stock_financials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker          VARCHAR(20) NOT NULL REFERENCES stocks(ticker),
  fiscal_year     INT NOT NULL,
  fiscal_quarter  INT,                    -- NULL = 연간, 1~4 = 분기
  revenue         BIGINT,                 -- 매출액 (원)
  operating_income BIGINT,                -- 영업이익
  net_income      BIGINT,                 -- 당기순이익
  eps             DECIMAL(12,2),          -- 주당순이익
  per             DECIMAL(8,2),           -- 주가수익비율
  pbr             DECIMAL(8,2),           -- 주가순자산비율
  roe             DECIMAL(8,4),           -- 자기자본이익률 (0.15 = 15%)
  roa             DECIMAL(8,4),           -- 총자산이익률
  debt_ratio      DECIMAL(8,4),           -- 부채비율 (1.0 = 100%)
  div_yield       DECIMAL(8,4),           -- 배당수익률 (0.03 = 3%)
  ev_ebitda       DECIMAL(8,2),           -- EV/EBITDA
  revenue_growth  DECIMAL(8,4),           -- 매출 YoY 성장률 (0.20 = 20%)
  eps_growth      DECIMAL(8,4),           -- EPS YoY 성장률
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 연간 재무는 (ticker, fiscal_year)당 1행 보장 (fiscal_quarter NULL은 UNIQUE 제약으로 못 잡으므로 부분 인덱스 사용)
CREATE UNIQUE INDEX IF NOT EXISTS uq_financials_annual
  ON stock_financials(ticker, fiscal_year) WHERE fiscal_quarter IS NULL;
CREATE INDEX IF NOT EXISTS idx_financials_ticker ON stock_financials(ticker, fiscal_year DESC);

-- 종목당 최신 점수 1행 (upsert)
CREATE TABLE IF NOT EXISTS stock_scores (
  ticker          VARCHAR(20) PRIMARY KEY REFERENCES stocks(ticker),
  total_score     DECIMAL(5,2),
  breakdown       JSONB NOT NULL DEFAULT '[]',
  scored_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS algorithm_configs (
  id          VARCHAR(50) PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  category    VARCHAR(30)  NOT NULL,
  version     VARCHAR(10)  NOT NULL,
  enabled     BOOLEAN      NOT NULL DEFAULT TRUE,
  weight      DECIMAL(4,3) NOT NULL,
  params      JSONB        NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 엔진 코드(CompositeScorer)와 일치하는 가중치 시드 (합계 1.00)
INSERT INTO algorithm_configs (id, name, category, version, enabled, weight, params) VALUES
  ('value_v1',           '가치 팩터',   'value',           '2.0', TRUE, 0.300, '{"perWeight":0.35,"pbrWeight":0.30,"divWeight":0.15,"evWeight":0.20}'),
  ('quality_v1',         '퀄리티 팩터', 'quality',         '2.0', TRUE, 0.250, '{"roeMax":20,"debtMax":200}'),
  ('growth_v1',          '성장성 팩터', 'growth',          '2.0', TRUE, 0.200, '{"growthNormMax":30}'),
  ('momentum_v1',        '모멘텀 팩터', 'momentum',        '2.0', TRUE, 0.150, '{"w1m":0.20,"w3m":0.30,"w6m":0.30,"w12m":0.20}'),
  ('tech_innovation_v1', '신기술 혁신', 'tech_innovation', '2.0', TRUE, 0.100, '{"keywordMax":30}')
ON CONFLICT (id) DO NOTHING;

-- 첫 실행 시 화면 확인용 시드 종목 (데이터 수집 실행 시 실데이터로 덮어씀)
INSERT INTO stocks (ticker, name, market, sector) VALUES
  ('005930', '삼성전자',   'KOSPI', 'IT/반도체'),
  ('000660', 'SK하이닉스', 'KOSPI', 'IT/반도체'),
  ('035420', 'NAVER',      'KOSPI', 'IT/소프트웨어'),
  ('051910', 'LG화학',     'KOSPI', '화학/소재'),
  ('006400', '삼성SDI',    'KOSPI', '이차전지')
ON CONFLICT (ticker) DO NOTHING;
