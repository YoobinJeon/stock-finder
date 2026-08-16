-- 예정일 파싱 실패(scheduled_dt NULL)로 굳어진 earnings_schedules 행을 일회성 재큐잉한다.
-- 기존 버그: DART 원문 조회가 일시 실패(null 반환)해도 scheduled_dt=NULL로 확정 저장되어
-- 재시도가 막혔고, IR·실적예고 이벤트가 실제 예정일이 아닌 접수일 칩에 영구히 머물렀다.
-- (실사례: SK하이닉스 IR 20260715800456 — 원문에 2026-07-29 09:00이 있으나 7/15에 표시)
-- 이 행들을 지우면 다음 disclosures 동기화에서 재파싱된다. 원문 조회가 성공하면 실제
-- 예정일이 채워지고, 성공했는데도 예정일이 없으면 다시 NULL로 저장되어 재시도가 멈춘다
-- (수정된 syncEarningsSchedules는 조회 실패 시에만 저장을 건너뛴다).
DELETE FROM earnings_schedules WHERE scheduled_dt IS NULL;
