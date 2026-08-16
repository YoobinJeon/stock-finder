-- RS 백분위 이전값 보존 (RS 이원화 해소 — Phase 1a) — ingest.ts가 신규 값을 쓰기 전에
-- 현재값을 이 컬럼으로 옮겨두고, rs_top_entry 시그널이 "이전에는 90 미만" 판정에 사용한다.
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS rs_percentile_prev DECIMAL(5,2);
