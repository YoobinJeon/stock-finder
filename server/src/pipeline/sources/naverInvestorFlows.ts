import { getJson, num } from '../http';

export interface DailyFlow {
  date: string;                    // YYYY-MM-DD
  foreignNet: number | null;       // 외국인 순매수 (주)
  instNet: number | null;          // 기관 순매수 (주)
  individualNet: number | null;    // 개인 순매수 (주)
  foreignAmt: number | null;       // 외국인 순매수 금액(원) — 수량 × 당일 종가 근사
  instAmt: number | null;
  individualAmt: number | null;
  foreignHoldRatio: number | null; // 외국인 보유율 (%)
}

const trendUrl = (t: string, days: number) =>
  `https://m.stock.naver.com/api/stock/${t}/trend?pageSize=${days}&page=1`;

/** 네이버 투자자별 매매동향 (최신일 우선 정렬로 반환) */
export async function fetchInvestorFlows(ticker: string, days = 20): Promise<DailyFlow[]> {
  const data = await getJson(trendUrl(ticker, days));
  const arr: any[] = Array.isArray(data) ? data : [];

  return arr
    .map((r) => {
      const close = num(r?.closePrice);
      const amt = (qty: number | null) =>
        qty != null && close != null ? Math.round(qty * close) : null;
      const foreignNet = num(r?.foreignerPureBuyQuant);
      const instNet = num(r?.organPureBuyQuant);
      const individualNet = num(r?.individualPureBuyQuant);
      return {
        date: fmtBizdate(r?.bizdate),
        foreignNet,
        instNet,
        individualNet,
        foreignAmt: amt(foreignNet),
        instAmt: amt(instNet),
        individualAmt: amt(individualNet),
        foreignHoldRatio: num(r?.foreignerHoldRatio),
      };
    })
    .filter((r): r is DailyFlow & { date: string } => r.date != null);
}

/** '20260703' → '2026-07-03' */
function fmtBizdate(v: unknown): string | null {
  const s = String(v ?? '');
  if (!/^\d{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
