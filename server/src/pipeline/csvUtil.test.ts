import { test } from 'node:test';
import assert from 'node:assert/strict';
// 클라이언트의 순수 유틸을 서버 러너로 검증한다(clientSort.test.ts와 같은 방식).
import { csvCell, csvLine } from '../../../client/src/shared/lib/csv';

test('문자열은 큰따옴표로 감싼다', () => {
  assert.equal(csvCell('삼성전자'), '"삼성전자"');
});

test('내부 따옴표는 두 번 적는다', () => {
  assert.equal(csvCell('a"b'), '"a""b"');
});

test('쉼표·줄바꿈이 칸을 깨뜨리지 않는다', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('a\nb'), '"a\nb"');
});

test('숫자는 따옴표 없이 — 스프레드시트에서 계산 가능해야 한다', () => {
  assert.equal(csvCell(123), '123');
  assert.equal(csvCell(-12.3), '-12.3', '음수를 텍스트로 만들면 계산이 깨진다');
  assert.equal(csvCell(0), '0');
});

test('유한하지 않은 수는 빈 칸', () => {
  assert.equal(csvCell(NaN), '""');
  assert.equal(csvCell(Infinity), '""');
});

test('null·undefined는 빈 칸', () => {
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
});

test('수식으로 시작하는 문자열은 작은따옴표로 막는다 — 엑셀 수식 주입', () => {
  for (const bad of ['=1+1', '+1', '-1+1', '@SUM(A1)', '\tx', '\rx']) {
    const out = csvCell(bad);
    assert.ok(out.startsWith(`"'`), `${JSON.stringify(bad)} → ${out}`);
  }
});

test('평범한 문자열은 작은따옴표를 붙이지 않는다', () => {
  assert.equal(csvCell('SK하이닉스'), '"SK하이닉스"');
  assert.equal(csvCell('2026E 매출(억)'), '"2026E 매출(억)"');
});

test('행은 쉼표로 잇는다', () => {
  assert.equal(csvLine(['삼성전자', 123, null]), '"삼성전자",123,""');
});
