import axios from 'axios';
import iconv from 'iconv-lite';

/**
 * 네이버 실시간 지수 (KOSPI/KOSDAQ) — Yahoo가 한국 지수를 ~20분 지연 제공하는 문제 대응.
 * 네이버 지수 페이지의 now_value(현재가)·등락률은 장중 실시간 반영된다.
 */

export interface IndexQuote {
  price: number;
  change: number; // 전일대비 (부호 포함)
  changePct: number;
}

/** 지수 페이지 HTML → 현재가·등락률 (순수 함수) */
export function parseNaverIndex(html: string): IndexQuote | null {
  const priceM = html.match(/id="now_value">([\d,.]+)/);
  const pctM = html.match(/id="change_value_and_rate"><span>[\d,.]+<\/span>\s*([+\-]?[\d.]+)%/);
  if (!priceM || !pctM) return null;
  const price = Number(priceM[1].replace(/,/g, ''));
  const changePct = Number(pctM[1]);
  if (!Number.isFinite(price) || !Number.isFinite(changePct)) return null;
  // 등락 금액은 현재가와 등락률로 유도 (전일 종가 = price / (1 + pct/100))
  const prev = price / (1 + changePct / 100);
  return { price, change: price - prev, changePct };
}

export async function fetchNaverIndex(code: 'KOSPI' | 'KOSDAQ'): Promise<IndexQuote | null> {
  try {
    const res = await axios.get(`https://finance.naver.com/sise/sise_index.naver?code=${code}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      responseType: 'arraybuffer',
      timeout: 8000,
    });
    const html = iconv.decode(Buffer.from(res.data), 'euc-kr');
    return parseNaverIndex(html);
  } catch {
    return null;
  }
}
