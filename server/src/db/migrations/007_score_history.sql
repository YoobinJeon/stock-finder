-- 점수 이력: 채점할 때마다 (기준일, 종목)별 스냅샷 저장
-- 쌓이면 '기록 기반 백테스트'(수급·기술 포함 완전판)와 점수 추이 분석에 사용
CREATE TABLE IF NOT EXISTS score_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of       DATE NOT NULL,            -- 채점 기준일 (당시 최신 거래일)
  ticker      VARCHAR(20) NOT NULL REFERENCES stocks(ticker),
  total_score DECIMAL(5,2),
  factors     JSONB NOT NULL DEFAULT '{}',  -- {value,quality,growth,momentum,tech} 팩터별 점수
  UNIQUE (as_of, ticker)
);

CREATE INDEX IF NOT EXISTS idx_score_history_asof ON score_history(as_of DESC);
