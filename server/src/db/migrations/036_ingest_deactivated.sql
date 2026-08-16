-- 상장폐지 자동 감지 — 수집 실행별 비활성화(is_active=FALSE 전환) 종목 수 기록.
ALTER TABLE ingest_runs ADD COLUMN IF NOT EXISTS deactivated INT NOT NULL DEFAULT 0;
