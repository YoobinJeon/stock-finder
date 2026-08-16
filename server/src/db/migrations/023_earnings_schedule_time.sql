-- 예정 시간 컬럼 추가. 기존 행은 파생 캐시(원문 재파싱 가능)라 비우고 재적재 —
-- sync가 1회 50건씩(최신순) 자동 재구축
ALTER TABLE earnings_schedules ADD COLUMN IF NOT EXISTS scheduled_time VARCHAR(5);
DELETE FROM earnings_schedules;
