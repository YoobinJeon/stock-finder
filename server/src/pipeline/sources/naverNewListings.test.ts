import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNewListingRows } from './naverNewListings';

// sise_new_stock.naver 행 구조 축약 fixture (2026-07 실측 마크업 패턴)
const ROW_HTML = `
<tr>
  <td class="no">1</td>
  <td class="no">2026.07.06</td>
  <td><a href="/item/main.naver?code=365660" class="tltle">레몬헬스케어</a></td>
  <td class="number">9,800</td>
  <td class="number">
    <em class="bu_p bu_pdn"><span class="blind">하락</span></em><span class="tah p11 nv01">
    50
    </span>
  </td>
  <td class="number">
    <span class="tah p11 nv01">
    -0.51%
    </span>
  </td>
  <td class="number">7,171,023</td>
  <td class="number">9,850</td>
  <td class="number">11,050</td>
  <td class="number">9,510</td>
  <td class="number">1,308</td>
  <td class="number">-52.41</td>
</tr>
<tr>
  <td class="no">2</td>
  <td class="no">2026.07.01</td>
  <td><a href="/item/main.naver?code=0039P0" class="tltle">매드업</a></td>
  <td class="number">8,020</td>
  <td class="number">
    <em class="bu_p bu_pdn"><span class="blind">하락</span></em><span class="tah p11 nv01">
    210
    </span>
  </td>
  <td class="number">
    <span class="tah p11 nv01">
    -2.55%
    </span>
  </td>
  <td class="number">1,000</td>
  <td class="number">8,100</td>
  <td class="number">8,400</td>
  <td class="number">7,900</td>
  <td class="number">500</td>
  <td class="number">30.11</td>
</tr>`;

test('신규상장 행에서 종목·티커·상장일을 파싱하고 YYYY.MM.DD를 YYYY-MM-DD로 변환한다', () => {
  const rows = parseNewListingRows(ROW_HTML);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { ticker: '365660', name: '레몬헬스케어', listedAt: '2026-07-06' });
  assert.deepEqual(rows[1], { ticker: '0039P0', name: '매드업', listedAt: '2026-07-01' });
});

test('행 패턴이 없으면 빈 배열을 반환한다', () => {
  assert.equal(parseNewListingRows('<html>점검 중</html>').length, 0);
});

test('영문 혼합 종목코드(스팩·ETN 등)도 정상 파싱한다', () => {
  const html = `
<tr>
  <td class="no">1</td>
  <td class="no">2026.06.30</td>
  <td><a href="/item/main.naver?code=0164H0" class="tltle">한국제16호스팩</a></td>
</tr>`;
  const rows = parseNewListingRows(html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ticker, '0164H0');
});
