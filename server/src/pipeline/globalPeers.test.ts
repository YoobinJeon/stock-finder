import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferCurrency,
  collectDomesticTickers,
  collectUniqueForeignSymbols,
  GLOBAL_PEER_GROUPS,
  type GlobalPeerGroup,
} from './globalPeers';

test('inferCurrency: .T 접미사는 JPY', () => {
  // Arrange & Act & Assert
  assert.equal(inferCurrency('6981.T'), 'JPY');
});

test('inferCurrency: .TW 접미사는 TWD', () => {
  // Arrange & Act & Assert
  assert.equal(inferCurrency('2330.TW'), 'TWD');
});

test('inferCurrency: .SZ 접미사는 CNY', () => {
  // Arrange & Act & Assert
  assert.equal(inferCurrency('300750.SZ'), 'CNY');
});

test('inferCurrency: 접미사가 없으면 USD', () => {
  // Arrange & Act & Assert
  assert.equal(inferCurrency('MU'), 'USD');
  assert.equal(inferCurrency('SNDK'), 'USD');
});

test('inferCurrency: 유럽·홍콩 접미사', () => {
  // Arrange & Act & Assert
  assert.equal(inferCurrency('OR.PA'), 'EUR');
  assert.equal(inferCurrency('NESN.SW'), 'CHF');
  assert.equal(inferCurrency('VWS.CO'), 'DKK');
  assert.equal(inferCurrency('0700.HK'), 'HKD');
});

test('inferCurrency: .DE(프랑크푸르트) 접미사는 EUR', () => {
  // Arrange & Act & Assert
  assert.equal(inferCurrency('IFX.DE'), 'EUR');
  assert.equal(inferCurrency('ENR.DE'), 'EUR');
});

test('collectDomesticTickers: 여러 그룹의 국내 피어 티커를 중복 없이 모은다', () => {
  // Arrange
  const groups: GlobalPeerGroup[] = [
    { name: 'A', foreign: [], domestic: ['005930', '000660'] },
    { name: 'B', foreign: [], domestic: ['005930'] },
  ];

  // Act
  const result = collectDomesticTickers(groups);

  // Assert
  assert.deepEqual(result, ['005930', '000660']);
});

test('collectDomesticTickers: 빈 그룹 목록이면 빈 배열', () => {
  // Arrange & Act
  const result = collectDomesticTickers([]);

  // Assert
  assert.deepEqual(result, []);
});

test('GLOBAL_PEER_GROUPS: 모든 그룹이 최소 1개 해외·국내 종목을 갖는다', () => {
  // Arrange & Act & Assert
  for (const g of GLOBAL_PEER_GROUPS) {
    assert.ok(g.foreign.length > 0, `${g.name}: 해외 종목 없음`);
    assert.ok(g.domestic.length > 0, `${g.name}: 국내 종목 없음`);
  }
});

test('GLOBAL_PEER_GROUPS: 국내 티커는 모두 6자리 숫자다', () => {
  // Arrange & Act & Assert
  for (const g of GLOBAL_PEER_GROUPS) {
    for (const t of g.domestic) {
      assert.match(t, /^\d{6}$/, `${g.name}: ${t} 형식 오류`);
    }
  }
});

test('GLOBAL_PEER_GROUPS: 18그룹 이상 (전력반도체·로봇·AI반도체 신설)', () => {
  // Arrange & Act & Assert
  assert.ok(GLOBAL_PEER_GROUPS.length >= 18, `그룹 수가 ${GLOBAL_PEER_GROUPS.length}개뿐`);
});

test('GLOBAL_PEER_GROUPS: 그룹명은 중복되지 않는다', () => {
  // Arrange
  const names = GLOBAL_PEER_GROUPS.map((g) => g.name);

  // Act
  const unique = new Set(names);

  // Assert
  assert.equal(unique.size, names.length);
});

test('GLOBAL_PEER_GROUPS: 그룹당 해외 종목은 3개로 제한되지 않는다 (최대 4개 이상 그룹 존재)', () => {
  // Arrange & Act
  const expanded = GLOBAL_PEER_GROUPS.filter((g) => g.foreign.length > 3);

  // Assert
  assert.ok(expanded.length > 0, '해외 종목 4개 이상인 그룹이 하나도 없음');
});

test('collectUniqueForeignSymbols: 여러 그룹에 걸친 동일 심볼(NVDA)을 한 번만 반환한다', () => {
  // Arrange
  const groups: GlobalPeerGroup[] = [
    { name: 'A', foreign: [{ symbol: 'NVDA', name: '엔비디아' }, { symbol: 'TSLA', name: '테슬라' }], domestic: ['005930'] },
    { name: 'B', foreign: [{ symbol: 'NVDA', name: '엔비디아' }, { symbol: 'AMD', name: 'AMD' }], domestic: ['005930'] },
  ];

  // Act
  const result = collectUniqueForeignSymbols(groups);

  // Assert
  assert.deepEqual(result.map((f) => f.symbol), ['NVDA', 'TSLA', 'AMD']);
});

test('collectUniqueForeignSymbols: 실제 GLOBAL_PEER_GROUPS에서도 NVDA는 한 번만 등장한다', () => {
  // Arrange & Act
  const result = collectUniqueForeignSymbols(GLOBAL_PEER_GROUPS);
  const nvdaCount = result.filter((f) => f.symbol === 'NVDA').length;

  // Assert
  assert.equal(nvdaCount, 1);
});
