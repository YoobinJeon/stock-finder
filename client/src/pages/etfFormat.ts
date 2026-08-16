/** ETF 페이지 공용 포맷 헬퍼 — 시세 목록·차트보드·자금유입 뷰에서 공유 */

export function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/** 백만원 단위 거래대금 → 억/조 표기 */
export function fmtAmountMn(mn: number): string {
  const eok = mn / 100;
  if (eok >= 10000) return `${(eok / 10000).toFixed(1)}조`;
  if (eok >= 1) return `${Math.round(eok).toLocaleString()}억`;
  return `${mn.toLocaleString()}백만`;
}

/** 억원 단위 시가총액/자금유입 절대값 → 억/조 표기 (부호 없음) */
export function fmtCapEok(eok: number): string {
  const abs = Math.abs(eok);
  const sign = eok < 0 ? '-' : '';
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}조`;
  return `${sign}${Math.round(abs).toLocaleString()}억`;
}

/** 억원 단위 자금유입 추정 → 부호 포함 억/조 표기 (예: +1.2조, -320억) */
export function fmtFlowEok(eok: number): string {
  const formatted = fmtCapEok(eok);
  return eok >= 0 ? `+${formatted}` : formatted;
}
