-- 분기 실적 개선 판정 결과 (스크리너 실적 개선 필터).
-- stock_financials의 분기 행에서 파생되는 값이지만 스크리너의 WHERE 조건으로 쓰여
-- 2,700여 종목 전수에 걸리므로, 매 조회마다 LATERAL로 재계산하지 않고 미리 적재한다.
-- 판정 규칙은 pipeline/earningsTrend.ts(순수 함수)에 있고 이 표는 그 결과만 담는다.
--
-- 갱신 주체가 stock_indicators(일 단위 시세·수급)와 다르므로(분기 실적 발표 시점) 별도 표로 둔다.
CREATE TABLE IF NOT EXISTS stock_earnings_trend (
  ticker              VARCHAR(20) PRIMARY KEY REFERENCES stocks(ticker),
  -- 판정 기준이 된 최신 확정 분기
  base_year           INT NOT NULL,
  base_quarter        INT NOT NULL,
  -- 전년 동분기 대비 (소수: 0.2 = +20%). 직전 값이 0 이하면 백분율이 성립하지 않아 NULL —
  -- 이때 개선 여부는 turnaround 플래그가 판단한다.
  revenue_yoy         DECIMAL(12,4),
  op_yoy              DECIMAL(12,4),
  op_yoy_turnaround   BOOLEAN NOT NULL DEFAULT FALSE,
  yoy_improving       BOOLEAN NOT NULL DEFAULT FALSE,
  -- 직전 분기 대비
  revenue_qoq         DECIMAL(12,4),
  op_qoq              DECIMAL(12,4),
  op_qoq_turnaround   BOOLEAN NOT NULL DEFAULT FALSE,
  qoq_improving       BOOLEAN NOT NULL DEFAULT FALSE,
  -- 최초 컨센서스 분기 기준 — 배지 표시 전용(필터에는 쓰지 않는다)
  est_yoy_improving   BOOLEAN NOT NULL DEFAULT FALSE,
  est_qoq_improving   BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 스크리너가 "개선 종목만" 좁힐 때 쓰는 부분 인덱스 — 전체의 일부만 TRUE라 선택도가 높다.
CREATE INDEX IF NOT EXISTS idx_earnings_trend_yoy
  ON stock_earnings_trend(ticker) WHERE yoy_improving;
CREATE INDEX IF NOT EXISTS idx_earnings_trend_qoq
  ON stock_earnings_trend(ticker) WHERE qoq_improving;
