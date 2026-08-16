-- 수급(FlowEngine) 알고리즘 설정 시드 — 001_core.sql의 5엔진 시드와 동일 패턴.
-- 초기 가중치 0(검증 후 활성화 예정): enabled=TRUE로 breakdown·score_history에는 기록되지만
-- CompositeScorer 정규화(가중합)에서 총점 기여는 0이다.
INSERT INTO algorithm_configs (id, name, category, version, enabled, weight, params) VALUES
  ('flow_v1', '수급', 'flow', '1.0', TRUE, 0.000, '{}')
ON CONFLICT (id) DO NOTHING;
