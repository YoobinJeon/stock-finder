-- 엘리엇 파동 "2파 끝 → 3파 시작" 스크리너 프리셋 — 026 패턴(멱등)
-- 실제 파동 카운팅(스윙 고저점 식별·피보나치 되돌림 38.2~61.8%·1파 저점 침범 금지)은
-- 일봉 지표 스크리너로 검증 불가 — 아래 근사 매핑으로 대체. 상세는 ARCHITECTURE.md 참고.
--   1파 존재     → 52주 저점 대비 +30% 이상 (minPctFrom52wLow)
--   2파 조정 완료 → 고점 대비 -25% 이내 유지(대세 미훼손) + MA150 위 + MA200 상승 (조정이 장기추세를 깨지 않음)
--   3파 점화     → 주가 MA20 재돌파 + 거래량 1.3배↑ + RSI 45~65(재상승 초기·과열 전)
--   3파 동력     → 기관 5일 순매수(외인 OR 조건은 엔진이 AND 전용이라 기관 단독) + RS 백분위 70↑(주도주)

INSERT INTO screener_presets (name, description, criteria, is_builtin)
SELECT '엘리엇 2→3파 시작(근사)',
       '엘리엇 파동 근사: 1파(52주저점+30%↑) 후 2파 조정이 대세를 안 깨고(고점-25%이내·MA150위·MA200상승) 3파 점화 신호(MA20재돌파·거래량1.3배↑·RSI45~65·기관순매수·RS백분위70↑)가 나온 종목. 실제 파동 카운팅·피보나치 되돌림 검증은 불가한 지표 근사 — 차트로 파동 구조 확인 후 판단 권장',
       '{"minPctFrom52wLow":30,"maxPctFrom52wHigh":25,"aboveMa150":true,"ma200Up":true,"aboveMa20":true,"rsiMin":45,"rsiMax":65,"minVolRatio":1.3,"instNetBuy5d":true,"minRsPercentile":70}',
       TRUE
WHERE NOT EXISTS (SELECT 1 FROM screener_presets WHERE name = '엘리엇 2→3파 시작(근사)');
