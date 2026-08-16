import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMainNews } from './naverNews';

// api.stock.naver.com/news/mainnews 실측 응답 축약 fixture
const FIXTURE = [
  {
    type: '1',
    oid: '016',
    ohnm: '헤럴드경제',
    aid: '0002668811',
    tit: '메모리주, 매수 기회 왔다는 이유',
    dt: '20260710214111',
    subcontent: '질주하던 글로벌 메모리 반도체 주가가 최근 급락한 가운데…',
    thumbUrl: 'https://example.invalid/thumb.jpg',
  },
  // 형식 불량 행 — 건너뛰어야 함
  { oid: '', aid: '123', tit: '제목', dt: '20260710214111' },
  { oid: '016', aid: '0001', tit: '', dt: '20260710214111' },
  { oid: '016', aid: '0001', tit: '날짜 불량', dt: 'yesterday' },
];

test('주요뉴스 JSON에서 제목·언론사·시각·기사링크를 만든다', () => {
  const items = parseMainNews(FIXTURE);

  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    title: '메모리주, 매수 기회 왔다는 이유',
    press: '헤럴드경제',
    at: '2026-07-10 21:41',
    url: 'https://n.news.naver.com/mnews/article/016/0002668811',
    summary: '질주하던 글로벌 메모리 반도체 주가가 최근 급락한 가운데…',
  });
});

test('배열이 아니거나 비어 있으면 빈 배열을 반환한다', () => {
  assert.deepEqual(parseMainNews(null), []);
  assert.deepEqual(parseMainNews({ error: true }), []);
  assert.deepEqual(parseMainNews([]), []);
});
