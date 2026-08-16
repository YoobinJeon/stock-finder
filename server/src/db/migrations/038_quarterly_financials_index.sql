-- 분기 컨센서스 upsert용 유니크 인덱스 (분기별 실적·컨센서스)
-- fiscal_quarter 컬럼은 001_core.sql에서 이미 존재하지만 분기 행에 대한 유니크 제약이
-- 없어 upsert 시 (ticker, fiscal_year, fiscal_quarter)당 1행을 보장할 수 없었다.
-- 연간 인덱스(uq_financials_annual)와 마찬가지로 부분 인덱스로 분리.
CREATE UNIQUE INDEX IF NOT EXISTS uq_financials_quarter
  ON stock_financials(ticker, fiscal_year, fiscal_quarter) WHERE fiscal_quarter IS NOT NULL;
