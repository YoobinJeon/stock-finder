/**
 * 스크리너 표 셀 표기 헬퍼와 페이지 번호 생성.
 * (2026-07-26 ScreenerPage.tsx 분할 — 800줄 규칙. 로직은 그대로 옮겼다.)
 */

/** 순매수 금액(원) → "+132억" / "-1.2조" */
export function fmtNetAmt(v: number | string | null): { text: string; up: boolean | null } {
  if (v == null) return { text: '—', up: null };
  const n = Number(v);
  if (!Number.isFinite(n)) return { text: '—', up: null };
  const abs = Math.abs(n);
  const sign = n >= 0 ? '+' : '-';
  if (abs >= 1e12) return { text: `${sign}${(abs / 1e12).toFixed(1)}조`, up: n >= 0 };
  const eok = abs / 1e8;
  return { text: `${sign}${eok >= 100 ? eok.toFixed(0) : eok >= 1 ? eok.toFixed(1) : eok.toFixed(2)}억`, up: n >= 0 };
}

/** 원 단위 금액 → "1,809조" / "1,320억" (조 단위는 소수 1자리) */
export function fmtKrw(v: number | string | null): string {
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(1)}조`;
  return `${Math.round(n / 1e8).toLocaleString('ko-KR')}억`;
}

export function fmtPer(v: number | string | null): string {
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n < 0 ? '적자' : n.toFixed(1);
}

/** 영업이익률 (%) */
export function opMargin(revenue: number | string | null, op: number | string | null): string {
  if (revenue == null || op == null) return '—';
  const r = Number(revenue);
  const o = Number(op);
  if (!Number.isFinite(r) || r <= 0 || !Number.isFinite(o)) return '—';
  return `${((o / r) * 100).toFixed(1)}%`;
}

/**
 * 분기 증가율(소수) → "+20.5%". 흑자전환은 직전 값이 0 이하라 백분율이 없으므로
 * 숫자 대신 '흑자전환'으로 적는다(스크리너 실적 개선 필터).
 */
export function fmtGrowth(v: number | string | null, turnaround?: boolean | null): string {
  if (turnaround === true) return '흑자전환';
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

export function buildPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '...')[] = [];
  pages.push(1);
  if (current > 3) pages.push('...');
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p);
  }
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}
