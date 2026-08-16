-- 추세 지표 확장 — MA50/150/200(+MA200 우상향)·52주 저점 대비·RS 백분위 (거장 전략 3종 근사 정밀화)
-- 분기 EPS 성장(eps_growth_qoq)은 이번 범위에서 제외: naverFinancials가 연간(finance/annual)만
-- 수집하고 fiscal_quarter는 항상 NULL(0% 커버리지).
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS ma50 DECIMAL(12,2);
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS ma150 DECIMAL(12,2);
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS ma200 DECIMAL(12,2);
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS ma200_up BOOLEAN;         -- MA200이 약 21거래일 전보다 위인지
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS low_52w DECIMAL(12,2);
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS pct_from_52w_low DECIMAL(8,2); -- 52주 저점 대비 상승률(%)
ALTER TABLE stock_indicators ADD COLUMN IF NOT EXISTS rs_percentile DECIMAL(5,2);    -- 상대강도 백분위 0~100 (IBD RS 근사)

-- 거장 전략 3종 프리셋 정밀화 (026에서 근사 적용했던 필드를 원문에 가깝게 교체, 멱등 UPDATE)
UPDATE screener_presets SET
  criteria = '{"aboveMa150":true,"aboveMa200":true,"ma150AboveMa200":true,"ma200Up":true,"minPctFrom52wLow":30,"maxPctFrom52wHigh":25,"minRsPercentile":70,"minRevenueGrowth":15}',
  description = '미너비니 SEPA 정밀화: 주가>MA150>MA200(상승) 4조건 실지표로 판정·52주저점+30%·52주고점-25%이내·RS 백분위 상위 30%(≥70)·매출성장률≥15%(EPS성장 자체는 분기 데이터 없어 대체). 잔여 근사: RS는 IBD 가중 산식이 아닌 단순 수익률 백분위, 손절 규칙(변동성 축소 구간 진입) 미반영',
  updated_at = NOW()
WHERE name = '미너비니 SEPA(근사)';

UPDATE screener_presets SET
  criteria = '{"minRsPercentile":80,"maxPctFrom52wHigh":15,"minVolRatio":1.5,"instNetBuy5d":true,"minRevenueGrowth":25}',
  description = '오닐 CANSLIM 정밀화: RS 백분위 상위 20%(≥80, L·RS 실지표)·52주고점-15%이내(N)·거래량1.5배↑(S)·기관5일순매수(I, 엔진이 AND 전용이라 기관 단독 적용)·매출성장률≥25%(C·A, 분기 EPS 데이터 없어 대체). 잔여 근사: ROE·시장방향(M) 미지원 — M은 대시보드 "시장 색깔"로 확인',
  updated_at = NOW()
WHERE name = '오닐 CANSLIM(근사)';

UPDATE screener_presets SET
  criteria = '{"minRsPercentile":85,"maxPctFrom52wHigh":10,"foreignNetBuy5d":true,"instNetBuy5d":true,"minMarketCap":500000000000,"ma200Up":true}',
  description = '드러켄밀러 모멘텀 정밀화: RS 백분위 상위 15%(≥85, 실지표) · 52주고점-10%이내 · 외국인+기관 5일 동반순매수(쌍끌이) · 시총5000억↑(대형·유동성) · MA200 우상향(추세 지속). 잔여 근사: 매크로 톱다운 판단·레버리지 비중은 종목 필터로 표현 불가 — 원 전략의 핵심(매크로)은 스크리너 범위 밖',
  updated_at = NOW()
WHERE name = '드러켄밀러 모멘텀(근사)';
