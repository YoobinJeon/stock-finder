-- 종목 상세 패널 확장 — 기업개요 텍스트 캐시 (WiseReport 스크랩, 지연 백필). 스펙 참고.
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS business_summary TEXT;
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS business_summary_at TIMESTAMPTZ;
