-- DART 고유번호(corp_code) 매핑 — 분기 실적 이력 백필용.
-- DART 재무 API는 ticker가 아니라 8자리 corp_code로만 조회되고, 매핑은 corpCode.xml(zip)
-- 다운로드로만 얻는다(에서 선행 작업으로 기록해둔 것). 매핑은 거의 변하지 않으므로
-- 종목 행에 한 번 채워두고 재사용한다.
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS corp_code VARCHAR(8);

CREATE INDEX IF NOT EXISTS idx_stocks_corp_code ON stocks(corp_code) WHERE corp_code IS NOT NULL;
