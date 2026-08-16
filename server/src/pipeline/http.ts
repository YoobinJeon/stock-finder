import axios from 'axios';

/** 네이버 모바일 API는 모바일 UA가 필요 */
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

export const http = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': MOBILE_UA },
});

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** JSON GET + 재시도 (429는 5초 대기, 그 외 지수 백오프) */
export async function getJson(url: string, retries = 3): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { data } = await http.get(url);
      return data;
    } catch (e: any) {
      if (attempt >= retries) throw e;
      const status = e?.response?.status;
      await sleep(status === 429 ? 5000 : 500 * 2 ** attempt);
    }
  }
}

/** "25.02배", "1,668원", "0.54%", "-" 등 표기 문자열 → 숫자 (파싱 불가 시 null) */
export function num(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** % 값 → 소수 (예: 29.94 → 0.2994) */
export function frac(v: number | null): number | null {
  return v == null ? null : v / 100;
}

/**
 * 현재 KST 날짜 (YYYY-MM-DD). 서버 로컬 타임존·DB의 CURRENT_DATE(UTC)에 의존하면
 * 새벽 수동 실행 시 전날로 기록되므로 KST를 명시적으로 계산한다.
 */
export function kstToday(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}
