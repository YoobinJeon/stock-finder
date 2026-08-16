import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCorpCodeXml, resolveCorpCode } from './dartCorpCode';

/** 실제 CORPCODE.xml 형태를 줄인 픽스처 */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<result>
  <list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code><modify_date>20260101</modify_date></list>
  <list><corp_code>00164779</corp_code><corp_name>SK하이닉스</corp_name><stock_code>000660</stock_code><modify_date>20260101</modify_date></list>
  <list><corp_code>00999999</corp_code><corp_name>비상장법인</corp_name><stock_code> </stock_code><modify_date>20260101</modify_date></list>
  <list><corp_code>00888888</corp_code><corp_name>코드짧음</corp_name><stock_code>12345</stock_code><modify_date>20260101</modify_date></list>
</result>`;

test('stock_code가 있는 상장사만 매핑한다', () => {
  const map = parseCorpCodeXml(XML);

  assert.equal(map.size, 2);
  assert.equal(map.get('005930'), '00126380');
  assert.equal(map.get('000660'), '00164779');
});

test('stock_code가 비었거나 6자리가 아니면 버린다', () => {
  const map = parseCorpCodeXml(XML);

  assert.equal(map.has('12345'), false);
  assert.equal([...map.values()].includes('00999999'), false);
});

test('같은 종목코드가 중복되면 첫 항목을 유지한다', () => {
  const dup = XML.replace(
    '</result>',
    '<list><corp_code>00000001</corp_code><stock_code>005930</stock_code></list></result>',
  );

  assert.equal(parseCorpCodeXml(dup).get('005930'), '00126380');
});

test('형식이 깨졌거나 비어도 예외 없이 빈 맵', () => {
  assert.equal(parseCorpCodeXml('').size, 0);
  assert.equal(parseCorpCodeXml('<html>error</html>').size, 0);
  assert.equal(parseCorpCodeXml('<result></result>').size, 0);
});

// ── resolveCorpCode: 우선주 폴백 ──

test('직접 매핑이 있으면 그대로 쓴다', () => {
  const map = parseCorpCodeXml(XML);

  assert.equal(resolveCorpCode(map, '005930'), '00126380');
});

test('우선주는 보통주 고유번호로 대체한다 (DART에 우선주 고유번호가 없다)', () => {
  const map = parseCorpCodeXml(XML);

  // 삼성전자우 005935 → 005930의 고유번호. 공시 주체가 같은 법인이므로 의도된 동일 매핑.
  assert.equal(resolveCorpCode(map, '005935'), '00126380');
  assert.equal(resolveCorpCode(map, '005937'), '00126380'); // 2우선주
});

test('끝자리가 0인 코드는 폴백하지 않는다 (보통주인데 미상장이면 그대로 미매핑)', () => {
  const map = parseCorpCodeXml(XML);

  assert.equal(resolveCorpCode(map, '123450'), null);
});

test('폴백 대상 보통주가 매핑에 없으면 null', () => {
  const map = parseCorpCodeXml(XML);

  assert.equal(resolveCorpCode(map, '999995'), null);
});

test('6자리가 아닌 입력은 폴백을 시도하지 않는다', () => {
  const map = parseCorpCodeXml(XML);

  assert.equal(resolveCorpCode(map, '5935'), null);
  assert.equal(resolveCorpCode(map, ''), null);
});
