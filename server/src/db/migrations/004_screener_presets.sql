-- 사용자 정의 스크리닝 전략 (프리셋)
-- criteria JSONB 필드: market, minScore, maxPer, minOpMargin(%), minRevenueGrowth(%),
--                      minDivYield(%), minMarketCap(원)
CREATE TABLE IF NOT EXISTS screener_presets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(50) NOT NULL,
  description VARCHAR(200),
  criteria    JSONB NOT NULL DEFAULT '{}',
  is_builtin  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 기본 전략 시드 — 전부 실제 재무 데이터 조건으로 필터링됨
INSERT INTO screener_presets (name, description, criteria, is_builtin) VALUES
  ('저PER 가치주', '확정 실적 기준 tPER 10배 이하 + 배당수익률 1% 이상', '{"maxPer":10,"minDivYield":1}', TRUE),
  ('고성장주', '최근 확정 연도 매출 성장률 15% 이상 + 영업이익률 5% 이상', '{"minRevenueGrowth":15,"minOpMargin":5}', TRUE),
  ('배당주', '배당수익률 3% 이상', '{"minDivYield":3}', TRUE),
  ('우량 대형주', '시가총액 1조 이상 + 영업이익률 8% 이상 + 종합 55점 이상', '{"minMarketCap":1000000000000,"minOpMargin":8,"minScore":55}', TRUE),
  ('고마진 기업', '영업이익률 15% 이상 (본업 수익성 우수)', '{"minOpMargin":15}', TRUE),
  ('종합 상위', '5팩터 종합점수 70점 이상', '{"minScore":70}', TRUE),
  ('추세초기전환', '5일선이 10일선 위/상향돌파 + 10일선 우상향 (추세 전환 초기)', '{"earlyTrend":true}', TRUE);
