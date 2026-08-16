/**
 * 간이 Piotroski F-score — 저장된 연간 재무 컬럼만으로 산정 가능한 5개 기준의 축약판.
 * DB I/O 없음. ingest.ts의 computeIndicators()가 연도별 재무를 넘겨 호출한다.
 *
 * 정식 Piotroski는 9개 기준이지만, 본 프로젝트는 CFO·유동비율·발행주식수·매출총이익·자산회전율을
 * 저장하지 않아 산정 불가 → **5개 기준(max=5)** 으로 축약하고 UI에도 "간이(5개)"로 표기한다.
 * 미산정 6개: CFO>0, 발생액(CFO−순이익), 유동비율↑, 주식수 미증가, 매출총이익률↑, 자산회전율↑.
 *
 * 전년 대비가 필요한 기준(roe↑·debt↓)은 전년 데이터가 없으면 해당 기준을 제외(max 감소)한다.
 * (기본 지표 확장 — ARCHITECTURE.md 참고)
 */

export interface FinYear {
  netIncome: number | null;
  roe: number | null;
  debtRatio: number | null;
  revenueGrowth: number | null; // YoY 성장률 (0.2 = 20%)
}

export interface FscoreResult {
  score: number;
  max: number;
  criteria: { name: string; pass: boolean }[];
}

/** years는 최신순([0]=최신, [1]=전년). 각 기준은 필요한 데이터가 있을 때만 max에 포함된다. */
export function calcFscore(years: FinYear[]): FscoreResult {
  const criteria: { name: string; pass: boolean }[] = [];
  if (years.length === 0) return { score: 0, max: 0, criteria };

  const cur = years[0];
  const prev = years[1];

  // 1) 순이익 > 0 (수익성)
  if (cur.netIncome != null) {
    criteria.push({ name: '순이익 흑자', pass: cur.netIncome > 0 });
  }
  // 2) ROE > 0 (수익성 — ROA 대체)
  if (cur.roe != null) {
    criteria.push({ name: 'ROE 양수', pass: cur.roe > 0 });
  }
  // 3) ROE 개선 (전년 대비)
  if (cur.roe != null && prev?.roe != null) {
    criteria.push({ name: 'ROE 개선', pass: cur.roe > prev.roe });
  }
  // 4) 부채비율 감소 (전년 대비, 레버리지)
  if (cur.debtRatio != null && prev?.debtRatio != null) {
    criteria.push({ name: '부채비율 감소', pass: cur.debtRatio < prev.debtRatio });
  }
  // 5) 매출 성장 > 0
  if (cur.revenueGrowth != null) {
    criteria.push({ name: '매출 성장', pass: cur.revenueGrowth > 0 });
  }

  const score = criteria.filter((c) => c.pass).length;
  return { score, max: criteria.length, criteria };
}
