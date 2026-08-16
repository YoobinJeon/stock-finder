import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFchart, parseEtfAnalysis, calcMaFlags, Candle } from './naverEtfDetail';

const FCHART_XML = `<?xml version="1.0" encoding="EUC-KR" ?>
<protocol>
  <chartdata symbol="069500" name="KODEX 200" count="2" timeframe="day" precision="0" origintime="20021014">
    <item data="20260709|121315|122080|113760|117700|25543395" />
    <item data="20260710|122250|124395|119630|120605|21032785" />
  </chartdata>
</protocol>`;

test('fchart XML에서 일봉을 파싱한다', () => {
  const candles = parseFchart(FCHART_XML);

  assert.equal(candles.length, 2);
  assert.deepEqual(candles[1], {
    date: '2026-07-10',
    open: 122250,
    high: 124395,
    low: 119630,
    close: 120605,
    volume: 21032785,
  });
  assert.equal(parseFchart('<protocol></protocol>').length, 0);
});

test('etfAnalysis JSON에서 정보·편입종목·비중을 파싱한다', () => {
  const info = parseEtfAnalysis({
    etfSummary: '요약<br>둘째 줄',
    issuerName: '삼성자산운용(ETF)',
    etfBaseIndex: '코스피 200',
    listedDate: '20021014',
    marketValue: '26조 2,075억',
    totalNav: '25조 5,797억',
    nav: 117715.96,
    deviationSign: '-',
    deviationRate: 0.01,
    totalFee: 0.15,
    etfTop10MajorConstituentAssets: [
      { seq: 1, itemCode: '005930', itemName: '삼성전자', stockCount: '6,978', etfWeight: '32.95%' },
      { seq: 2, itemCode: '000660', itemName: 'SK하이닉스', stockCount: '1,000', etfWeight: null },
    ],
    sectorPortfolioList: [
      { detailTypeCode: 'IT', weight: 67.61 },
      { detailTypeCode: 'ETC', weight: 0 },
    ],
  });

  assert.equal(info.issuer, '삼성자산운용(ETF)');
  assert.equal(info.listedDate, '2002-10-14');
  assert.equal(info.summary, '요약\n둘째 줄');
  assert.equal(info.deviationPct, -0.01);
  assert.equal(info.constituents.length, 2);
  assert.deepEqual(info.constituents[0], { ticker: '005930', name: '삼성전자', weight: 32.95 });
  assert.equal(info.constituents[1].weight, null); // 비중 없는 행은 null
  assert.deepEqual(info.sectors, [{ name: 'IT', weight: 67.61 }]); // weight 0 제외

  const empty = parseEtfAnalysis(null);
  assert.equal(empty.issuer, null);
  assert.deepEqual(empty.constituents, []);
});

function mkCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    open: close, high: close, low: close, close, volume: 1,
  }));
}

test('이동평균 플래그 — 정배열·20일선 위를 판정한다', () => {
  // 단조 상승 130봉 → 최신 MA5 > MA10 > … > MA120 (정배열), 종가 > MA20
  const rising = mkCandles(Array.from({ length: 130 }, (_, i) => 100 + i));
  const up = calcMaFlags(rising);
  assert.equal(up.aligned, true);
  assert.equal(up.above20, true);
  assert.ok(up.ma5! > up.ma10! && up.ma10! > up.ma20! && up.ma20! > up.ma60! && up.ma60! > up.ma120!);

  // 단조 하락 → 역배열, 20일선 아래
  const falling = mkCandles(Array.from({ length: 130 }, (_, i) => 300 - i));
  const down = calcMaFlags(falling);
  assert.equal(down.aligned, false);
  assert.equal(down.above20, false);

  // 데이터 부족 (60봉) → MA120 없음 → aligned null, above20은 판단 가능
  const short = calcMaFlags(mkCandles(Array.from({ length: 60 }, (_, i) => 100 + i)));
  assert.equal(short.ma120, null);
  assert.equal(short.aligned, null);
  assert.equal(short.above20, true);
});

test('60일선 위 판정 — 정배열이 아니어도 중기 추세 생존을 가려낸다', () => {
  // 단조 상승 → 종가 > MA60
  const rising = calcMaFlags(mkCandles(Array.from({ length: 130 }, (_, i) => 100 + i)));
  assert.equal(rising.above60, true);

  // 단조 하락 → 종가 < MA60
  const falling = calcMaFlags(mkCandles(Array.from({ length: 130 }, (_, i) => 300 - i)));
  assert.equal(falling.above60, false);

  // 상승 후 완만한 눌림: 20일선은 내줬지만 60일선은 지킨 구간 — 정배열 필터로는 안 잡힌다
  const dipped = calcMaFlags(
    mkCandles([
      ...Array.from({ length: 100 }, (_, i) => 100 + i * 2),
      ...Array.from({ length: 20 }, (_, i) => 298 - i * 0.5),
    ]),
  );
  assert.equal(dipped.above60, true);
  assert.equal(dipped.above20, false);
  assert.equal(dipped.aligned, false);

  // MA60을 못 만드는 59봉 → 판정 불가(null)
  const tooShort = calcMaFlags(mkCandles(Array.from({ length: 59 }, (_, i) => 100 + i)));
  assert.equal(tooShort.ma60, null);
  assert.equal(tooShort.above60, null);
});

test('신고가 돌파 — 직전 고가 이상이면 true, 데이터 부족이면 null', () => {
  // 단조 상승 → 매일이 신고가
  const rising = calcMaFlags(mkCandles(Array.from({ length: 130 }, (_, i) => 100 + i)));
  assert.equal(rising.newHigh, true);
  assert.equal(rising.high52w, 228); // 직전 봉(오늘 제외) 고가

  // 고점(300) 후 하락 → 신고가 아님
  const peaked = calcMaFlags(
    mkCandles([...Array.from({ length: 100 }, (_, i) => 200 + i), ...Array.from({ length: 30 }, (_, i) => 290 - i)]),
  );
  assert.equal(peaked.newHigh, false);
  assert.equal(peaked.high52w, 299);

  // 60봉 미만(신규상장) → 판정 안 함
  const listed = calcMaFlags(mkCandles(Array.from({ length: 30 }, (_, i) => 100 + i)));
  assert.equal(listed.newHigh, null);
  assert.equal(listed.high52w, null);
});
