-- 신규상장 보드용 인덱스. stocks.listed_at 컬럼은 001_core.sql에 이미 존재하나
-- 지금까지 채워진 적이 없음(IF NOT EXISTS는 안전망) — 네이버 신규상장 소스(syncNewListings)가
-- 이제부터 값을 채운다.
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS listed_at DATE;
CREATE INDEX IF NOT EXISTS idx_stocks_listed_at ON stocks(listed_at DESC);
