import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseThemeList } from './naverThemes';

// 네이버 테마 목록 페이지의 행 구조를 축약한 합성 fixture (2026-07 실측 마크업 패턴)
const ROW_HTML = `
<tr>
  <td style="padding-left:10px;"><a href="/sise/sise_group_detail.naver?type=theme&no=536">HBM(고대역폭메모리)</a></td>
  <td class="number">
    <span class="tah p11 red01">
    +10.04%
    </span>
  </td>
  <td class="number">33</td>
  <td class="number">32</td>
  <td class="number">0</td>
  <td class="number">1</td>
</tr>
<tr>
  <td style="padding-left:10px;"><a href="/sise/sise_group_detail.naver?type=theme&no=12">반도체 장비</a></td>
  <td class="number">
    <span class="tah p11 nv01">
    -1.20%
    </span>
  </td>
  <td class="number">95</td>
  <td class="number">10</td>
  <td class="number">4</td>
  <td class="number">81</td>
</tr>`;

test('테마 행에서 번호·이름·등락률·상승/하락 수를 파싱한다', () => {
  const list = parseThemeList(ROW_HTML);

  assert.equal(list.length, 2);
  assert.deepEqual(list[0], {
    no: 536,
    name: 'HBM(고대역폭메모리)',
    chgPct: 10.04,
    total: 33,
    up: 32,
    down: 1, // 보합(0)은 건너뛰고 하락 수를 취한다
  });
  assert.equal(list[1].no, 12);
  assert.equal(list[1].chgPct, -1.2);
  assert.equal(list[1].down, 81);
});

test('행 패턴이 없거나 중복 테마 번호면 걸러낸다', () => {
  assert.equal(parseThemeList('<html>점검 중</html>').length, 0);
  assert.equal(parseThemeList(ROW_HTML + ROW_HTML).length, 2); // 중복 no 제거
});
