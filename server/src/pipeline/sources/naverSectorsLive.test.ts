import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSectorLive } from './naverSectorsLive';

// 네이버 업종 시세 페이지의 행 구조를 축약한 합성 fixture (실제 마크업 패턴 유지)
const ROW_HTML = `
<tr>
  <td><a href="/sise/sise_group_detail.naver?type=upjong&no=278">반도체와반도체장비</a></td>
  <td><span class="tah p11 red01"> +2.31% </span></td>
  <td class="number">129</td>
  <td class="number">98</td>
  <td class="number">7</td>
  <td class="number">24</td>
</tr>
<tr>
  <td><a href="/sise/sise_group_detail.naver?type=upjong&no=281">은행</a></td>
  <td><span class="tah p11 nv01"> -0.84% </span></td>
  <td class="number">12</td>
  <td class="number">3</td>
  <td class="number">1</td>
  <td class="number">8</td>
</tr>`;

test('업종 행에서 섹터명·등락률·종목수를 파싱한다', () => {
  const map = parseSectorLive(ROW_HTML);

  assert.equal(map.size, 2);
  assert.deepEqual(map.get('반도체와반도체장비'), {
    chgPct: 2.31,
    total: 129,
    up: 98,
    down: 24, // 보합(7)은 건너뛰고 하락 수를 취한다
  });
  assert.equal(map.get('은행')?.chgPct, -0.84);
});

test('행 패턴이 없는 HTML이면 빈 맵을 반환한다', () => {
  assert.equal(parseSectorLive('<html><body>점검 중</body></html>').size, 0);
  assert.equal(parseSectorLive('').size, 0);
});
