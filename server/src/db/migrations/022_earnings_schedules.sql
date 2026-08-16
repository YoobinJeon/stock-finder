-- 실적 발표·IR 예정일 (DART 원문 파싱 결과)
CREATE TABLE IF NOT EXISTS earnings_schedules (
  rcept_no     VARCHAR(20) PRIMARY KEY,  -- 출처 공시 접수번호
  ticker       VARCHAR(20) NOT NULL,
  announced_dt DATE NOT NULL,            -- 공시 접수일
  scheduled_dt DATE,                     -- 파싱된 예정일 (파싱 실패 시 NULL로 저장해 재시도 방지)
  kind         VARCHAR(20) NOT NULL,     -- 'ir' | 'earnings'
  report_nm    VARCHAR(300) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_earnings_schedules_dt ON earnings_schedules(scheduled_dt);
