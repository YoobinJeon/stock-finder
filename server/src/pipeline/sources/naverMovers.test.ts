import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSiseRows } from './naverMovers';

// sise_quant/sise_rise 공용 행 구조 축약 fixture (2026-07 실측 마크업 패턴)
const ROW_HTML = `
<tr>
  <td class="no">20</td>
  <td><a href="/item/main.naver?code=005930" class="tltle">삼성전자</a></td>
  <td class="number">285,000</td>
  <td class="number">
    <em class="bu_p bu_pup"><span class="blind">상승</span></em><span class="tah p11 red02">
    7,000
    </span>
  </td>
  <td class="number">
    <span class="tah p11 red01">
    +2.52%
    </span>
  </td>
  <td class="number">19,919,725</td>
  <td class="number">5,768,281</td>
  <td class="number">285,000</td>
</tr>
<tr>
  <td class="no">21</td>
  <td><a href="/item/main.naver?code=0193T0" class="tltle">KODEX 레버리지형</a></td>
  <td class="number">21,760</td>
  <td class="number">
    <em class="bu_p bu_pdn"><span class="blind">하락</span></em><span class="tah p11 nv02">
    500
    </span>
  </td>
  <td class="number">
    <span class="tah p11 nv01">
    -1.10%
    </span>
  </td>
  <td class="number">1,000</td>
  <td class="number">22</td>
  <td class="number">21,700</td>
</tr>`;

test('시세 순위 행에서 종목·현재가·등락률·거래량·거래대금을 파싱한다', () => {
  const rows = parseSiseRows(ROW_HTML);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    ticker: '005930',
    name: '삼성전자',
    price: 285000,
    changePct: 2.52,
    volume: 19919725,
    amount: 5768281,
  });
  // 신형 영문 혼합 코드 + 하락 종목
  assert.equal(rows[1].ticker, '0193T0');
  assert.equal(rows[1].changePct, -1.1);
});

test('행 패턴이 없으면 빈 배열, 중복 티커는 제거한다', () => {
  assert.equal(parseSiseRows('<html>점검 중</html>').length, 0);
  assert.equal(parseSiseRows(ROW_HTML + ROW_HTML).length, 2);
});
