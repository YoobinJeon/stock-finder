-- 기존 DB에도 '추세초기전환' 기본 전략 추가 (이미 있으면 건너뜀)
INSERT INTO screener_presets (name, description, criteria, is_builtin)
SELECT '추세초기전환', '5일선이 10일선 위/상향돌파 + 10일선 우상향 (추세 전환 초기)', '{"earlyTrend":true}', TRUE
WHERE NOT EXISTS (SELECT 1 FROM screener_presets WHERE name = '추세초기전환');
