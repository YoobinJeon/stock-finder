-- 컨센서스(추정) 연도 재무 구분: is_estimate = TRUE 행은 애널리스트 전망치
-- (fPER, 내년 매출/영업이익 가이던스 표시용 — 점수 엔진은 확정 실적만 사용)
ALTER TABLE stock_financials ADD COLUMN IF NOT EXISTS is_estimate BOOLEAN NOT NULL DEFAULT FALSE;
