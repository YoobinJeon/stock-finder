-- 유상증자·CB 조달금액 (원문 파싱 규모 반영) — NULL=미파싱/비대상, 0=파싱 실패 마커
ALTER TABLE disclosure_events ADD COLUMN IF NOT EXISTS amount BIGINT;
