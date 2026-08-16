import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commonShareTickerOf, isPreferredShare } from './shareClass';

test('보통주는 0으로 끝난다', () => {
  assert.equal(isPreferredShare('005930'), false, '삼성전자');
  assert.equal(isPreferredShare('000660'), false, 'SK하이닉스');
});

test('구형 우선주 — 5·7·9', () => {
  assert.equal(isPreferredShare('005935'), true, '삼성전자우');
  assert.equal(isPreferredShare('005937'), true, '2우B');
  assert.equal(isPreferredShare('005939'), true);
});

test('신형 우선주 — K·L·M', () => {
  assert.equal(isPreferredShare('00104K'), true, 'CJ4우(전환)');
  assert.equal(isPreferredShare('37550L'), true, 'DL이앤씨2우(전환)');
  assert.equal(isPreferredShare('00279K'), true, '아모레퍼시픽홀딩스3우C');
});

test('이름이 아니라 코드로 판정한다 — 이름이 우로 끝나는 보통주가 있다', () => {
  // 성우·이오플로우·에코글로우는 이름만 보면 우선주로 오인된다.
  assert.equal(isPreferredShare('458650'), false, '성우');
  assert.equal(isPreferredShare('294090'), false, '이오플로우');
  assert.equal(isPreferredShare('159910'), false, '에코글로우');
});

test('빈 코드는 우선주로 보지 않는다', () => {
  assert.equal(isPreferredShare(''), false);
});

test('보통주 짝 코드는 앞 5자리 + 0', () => {
  assert.equal(commonShareTickerOf('005935'), '005930');
  assert.equal(commonShareTickerOf('00104K'), '001040', 'CJ');
  assert.equal(commonShareTickerOf('005930'), '005930', '보통주는 자기 자신');
});
