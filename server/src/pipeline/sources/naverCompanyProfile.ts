import axios from 'axios';
import { decodeHtmlEntities } from './naverStockNews';

/**
 * 기업 개요 텍스트 — WiseReport(FnGuide) 기업모니터 페이지 스크랩.
 * stocks.routes.ts GET /:ticker에서 stocks.business_summary가 NULL일 때 1회 지연 백필용
 * (종목 상세 패널 확장 스펙 — 참고). 비공식 HTML 스크랩이라 페이지 구조가 바뀌면 깨질 수 있으니
 * 실패·비200·파싱실패는 전부 null 반환(fail-soft) — 나머지 상세 응답에는 영향 없음.
 */

const PROFILE_URL = (ticker: string) =>
  `https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd=${ticker}`;

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
const TICKER_RE = /^[0-9A-Z]{6}$/i;
const MAX_BULLETS = 4;
const MAX_LENGTH = 500;
// "동사는" 불릿 기준 앞뒤 탐색 범위(문자 수) — 실측(삼성전자) 기준 기업개요 <ul class="dot_cmp"> 블록이
// 이 범위 안에 온전히 들어옴. 너무 넓히면 다른 섹션의 무관한 <li>가 섞여 들어올 수 있어 보수적으로 잡음.
const WINDOW_BEFORE = 500;
const WINDOW_AFTER = 1500;

/** HTML → 기업개요 불릿 텍스트(개행 join, 최대 500자). "동사는" 불릿을 못 찾으면 null. (순수 함수) */
export function parseCompanyProfile(html: string): string | null {
  const anchor = html.indexOf('동사는');
  if (anchor === -1) return null;

  const windowStart = Math.max(0, anchor - WINDOW_BEFORE);
  const windowHtml = html.slice(windowStart, anchor + WINDOW_AFTER);

  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
  const bullets: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(windowHtml)) !== null && bullets.length < MAX_BULLETS) {
    const text = decodeHtmlEntities(m[1].replace(/<[^>]+>/g, '')).trim();
    if (text) bullets.push(text);
  }
  if (bullets.length === 0) return null;

  const joined = bullets.join('\n');
  return joined.length > MAX_LENGTH ? joined.slice(0, MAX_LENGTH) : joined;
}

/** 티커 → 기업개요 텍스트. 실패·비200·파싱실패 시 null (fail-soft). */
export async function fetchCompanyProfile(ticker: string): Promise<string | null> {
  if (!TICKER_RE.test(ticker)) return null;
  try {
    const res = await axios.get(PROFILE_URL(ticker), {
      headers: UA,
      timeout: 10000,
      validateStatus: (status) => status === 200,
    });
    return parseCompanyProfile(String(res.data));
  } catch {
    return null;
  }
}
