import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreTechInnovation } from './TechInnovationEngine';

test('업종·키워드 정보가 없으면 기본 25점, "정보 없음" 근거', () => {
  const result = scoreTechInnovation(undefined, undefined);
  assert.equal(result.score, 25);
  assert.ok(result.reasons.some((r) => r.includes('업종 정보 없음')));
  assert.ok(result.reasons.some((r) => r.includes('기술 트렌드 키워드 매칭 없음')));
});

test('기술 섹터(반도체) + 키워드(HBM) 매칭 시 기본점수와 보너스가 합산된다', () => {
  const result = scoreTechInnovation('HBM 테스트기업', '반도체와반도체장비');
  // base 65(반도체 섹터) + 10(HBM) + 8(반도체 키워드 중복 매칭) = 83
  assert.equal(result.score, 83);
  assert.ok(result.reasons.some((r) => r.includes('기술 관련 섹터')));
  assert.ok(result.reasons.some((r) => r.includes('HBM')));
});

test('전통 산업 섹터는 기본점수가 낮고 "전통 산업" 근거가 붙는다', () => {
  const result = scoreTechInnovation('그냥은행', '은행');
  assert.equal(result.score, 28);
  assert.ok(result.reasons.some((r) => r.includes('전통 산업')));
});

test('TECH_SECTORS에 없는 업종은 "분류 외" 기본 25점', () => {
  const result = scoreTechInnovation('아무회사', '기타서비스');
  assert.equal(result.score, 25);
  assert.ok(result.reasons.some((r) => r.includes('분류 외')));
});

test('키워드 매칭 보너스는 +40에서 상한 클램프된다', () => {
  // '반도체'/'바이오'/'이차전지'는 TECH_SECTORS 키와도 겹치므로 제외하고 순수 키워드만 사용
  const result = scoreTechInnovation('AI 인공지능 LLM 생성형 HBM NPU GAA', undefined);
  // 키워드 합산 67점(10+10+10+9+10+9+9)이지만 +40으로 클램프 → 25(기본, 업종 없음) + 40 = 65
  assert.equal(result.score, 65);
  assert.ok(result.reasons.some((r) => r.includes('보너스 +40')));
});

test('기본점수+키워드 보너스가 100을 넘으면 100점에서 클램프된다', () => {
  const result = scoreTechInnovation('AI 인공지능 LLM 생성형 HBM NPU GAA', '반도체와반도체장비');
  // base 65(반도체 섹터) + 키워드 합산(HBM10+반도체8+AI10+인공지능10+LLM10+생성형9+NPU9+GAA9=75 → 40 클램프) = 105 → 100
  assert.equal(result.score, 100);
});
