import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStockNews, decodeHtmlEntities } from './naverStockNews';

// m.stock.naver.com/api/news/stock/{ticker} 실측 응답 축약 fixture (그룹 배열)
const FIXTURE = [
  {
    total: 3,
    items: [
      {
        title: '삼성전자 반도체 신제품 공개',
        titleFull: '삼성전자, 차세대 반도체 신제품 &quot;X&quot; 공개 &amp; 출하',
        officeId: '015',
        officeName: '한국경제',
        articleId: '0004912345',
        datetime: '202607111030',
        mobileNewsUrl: 'https://m.stock.naver.com/dummy',
      },
      // articleId 누락 — 스킵 대상
      {
        title: '누락된 기사',
        officeId: '015',
        officeName: '한국경제',
        datetime: '202607111031',
      },
      // datetime 형식 불량 — 스킵 대상
      {
        title: '날짜 불량 기사',
        officeId: '020',
        officeName: '동아일보',
        articleId: '0001234567',
        datetime: 'not-a-date',
      },
    ],
  },
  {
    total: 1,
    items: [
      {
        // titleFull 없음 — title로 폴백
        title: '두번째 그룹 기사 제목',
        officeId: '025',
        officeName: '중앙일보',
        articleId: '0009999999',
        datetime: '202607101200',
      },
    ],
  },
];

test('그룹 배열을 평탄화해 제목·언론사·시각·기사링크를 만든다', () => {
  const items = parseStockNews(FIXTURE);

  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title: '삼성전자, 차세대 반도체 신제품 "X" 공개 & 출하',
    press: '한국경제',
    datetime: '2026-07-11 10:30',
    url: 'https://n.news.naver.com/mnews/article/015/0004912345',
  });
});

test("datetime 'YYYYMMDDHHmm'을 'YYYY-MM-DD HH:mm'으로 변환한다", () => {
  const items = parseStockNews(FIXTURE);
  assert.equal(items[0].datetime, '2026-07-11 10:30');
  assert.equal(items[1].datetime, '2026-07-10 12:00');
});

test('titleFull이 있으면 title 대신 titleFull을 사용한다', () => {
  const items = parseStockNews(FIXTURE);
  assert.equal(items[0].title, '삼성전자, 차세대 반도체 신제품 "X" 공개 & 출하');
});

test('titleFull이 없으면 title로 폴백한다', () => {
  const items = parseStockNews(FIXTURE);
  assert.equal(items[1].title, '두번째 그룹 기사 제목');
});

test('HTML 엔티티(named·숫자)를 디코드한다', () => {
  assert.equal(decodeHtmlEntities('&quot;X&quot; &amp; &#39;Y&#39;'), '"X" & \'Y\'');
  assert.equal(decodeHtmlEntities('&#44032;&#45208;'), '가나');
});

test('officeId·articleId 누락 또는 datetime 형식 불량 행은 스킵한다', () => {
  const items = parseStockNews(FIXTURE);
  const titles = items.map((i) => i.title);
  assert.ok(!titles.includes('누락된 기사'));
  assert.ok(!titles.includes('날짜 불량 기사'));
});

test('배열이 아니거나 items가 없으면 빈 배열을 반환한다', () => {
  assert.deepEqual(parseStockNews(null), []);
  assert.deepEqual(parseStockNews({ error: true }), []);
  assert.deepEqual(parseStockNews([]), []);
  assert.deepEqual(parseStockNews([{ total: 0 }]), []);
});
