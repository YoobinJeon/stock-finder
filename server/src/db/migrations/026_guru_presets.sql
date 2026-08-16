-- 거장 투자전략 3종 스크리너 프리셋 (미너비니 SEPA·오닐 CANSLIM·드러켄밀러) — 017 패턴(멱등)
-- 원 전략 조건 중 스크리너 미지원 필드(EPS성장률 자체·MA150/200·52주 저점 대비·ROE·
-- 실제 상대강도(RS) 순위·OR 조합·시장 방향 판정)는 근사하거나 미적용 처리했다.
-- 근사 매핑 상세는 ARCHITECTURE.md 참고.

INSERT INTO screener_presets (name, description, criteria, is_builtin)
SELECT '미너비니 SEPA(근사)',
       '미너비니 SEPA 근사: 골든크로스+주가>MA20(MA150/200 대체)·52주고점-25%이내·RSI50~80(RS 대체)·매출성장률≥15%(EPS성장 대체)·시총1000억↑(초소형 제외). 52주저점+30%·MA200상승·실제RS는 데이터 없어 미적용',
       '{"goldenCross":true,"aboveMa20":true,"maxPctFrom52wHigh":25,"rsiMin":50,"rsiMax":80,"minRevenueGrowth":15,"minMarketCap":100000000000}',
       TRUE
WHERE NOT EXISTS (SELECT 1 FROM screener_presets WHERE name = '미너비니 SEPA(근사)');

INSERT INTO screener_presets (name, description, criteria, is_builtin)
SELECT '오닐 CANSLIM(근사)',
       '오닐 CANSLIM 근사: 매출성장률≥25%(분기·연간EPS+25% 대체)·52주고점-15%이내(N)·거래량1.5배↑(S)·기관5일순매수(I, OR조건 미지원으로 단독 적용)·RSI≥60(L RS 대체). ROE·시장방향(M)은 스크리너 미지원, M은 시장색깔 배지로 별도 확인 권장',
       '{"minRevenueGrowth":25,"maxPctFrom52wHigh":15,"minVolRatio":1.5,"instNetBuy5d":true,"rsiMin":60}',
       TRUE
WHERE NOT EXISTS (SELECT 1 FROM screener_presets WHERE name = '오닐 CANSLIM(근사)');

INSERT INTO screener_presets (name, description, criteria, is_builtin)
SELECT '드러켄밀러 모멘텀(근사)',
       '드러켄밀러 모멘텀 근사: 52주고점-10%이내·매출성장률≥15%(EPS성장 대체)·외국인+기관 5일 동반순매수·거래량1.2배↑·시총5000억↑·골든크로스. 원전략은 매크로 톱다운·레버리지 집중 베팅 — 종목 필터 근사만 반영, 매크로 판단은 스크리너로 불가',
       '{"maxPctFrom52wHigh":10,"minRevenueGrowth":15,"foreignNetBuy5d":true,"instNetBuy5d":true,"minVolRatio":1.2,"minMarketCap":500000000000,"goldenCross":true}',
       TRUE
WHERE NOT EXISTS (SELECT 1 FROM screener_presets WHERE name = '드러켄밀러 모멘텀(근사)');
