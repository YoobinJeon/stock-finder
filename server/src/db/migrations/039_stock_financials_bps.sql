-- PER/PBR/PBR-ROE 밸류에이션 밴드(밸류에이션 밴드)에 필요한 BPS(주당순자산) 컬럼 추가.
-- eps와 동일한 정밀도(DECIMAL(12,2), 원 단위)를 사용 — naverConsensus의 BPS 필드 또는
-- naverFinancials의 EPS/ROE 역산값(deriveBps)이 채운다.
ALTER TABLE stock_financials ADD COLUMN IF NOT EXISTS bps DECIMAL(12,2);
