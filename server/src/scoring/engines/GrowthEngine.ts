import { AlgorithmEngine, AlgorithmMeta, StockData, MarketContext, EngineScore, delta, pct } from './base/AlgorithmEngine';
import { getDb } from '../../config/database';
import { assessEarningsQuality } from '../earningsQuality';
import { fmtEok } from './ValueEngine';

/** stock_financials에서 성장성 팩터가 읽는 컬럼 (최신 연도부터 최대 3개년) */
export interface GrowthFinRow {
  fiscal_year: number;
  revenue: number | string | null;
  revenue_growth: number | string | null;
  eps_growth: number | string | null;
  operating_income: number | string | null;
  net_income: number | string | null;
}

/** 순수 계산: 이미 조회된 재무 3개년 rows(최신 연도부터 내림차순)로부터 성장성 점수 산출 */
export function scoreGrowth(rows: GrowthFinRow[]): EngineScore {
  if (rows.length === 0) {
    return { score: 50, reasons: ['재무 데이터 없음 — 중립(50점) 처리'], dataMissing: true };
  }

  const f = rows[0]; // 최신 확정 연도
  let score = 50;
  const reasons: string[] = [];
  const year = f.fiscal_year ? `${f.fiscal_year}년 ` : '';

  // 이익의 질 + 영업이익 성장 추세 (3개년 시계열)
  const eq = assessEarningsQuality(rows);
  const { oneOff } = eq;

  // 기저효과: 최근 매출이 2년 전 매출보다 여전히 낮으면 '회복 반등'
  const rev0 = f.revenue != null ? Number(f.revenue) : null;
  const rev2 = rows.length >= 3 && rows[2].revenue != null ? Number(rows[2].revenue) : null;
  const baseEffect = rev0 != null && rev2 != null && rev0 < rev2;

  // 매출 성장률
  if (f.revenue_growth != null) {
    const rg = Number(f.revenue_growth);
    const rgPct = rg * 100;
    let d: number;
    let label: string;
    if (rgPct >= 30)      { d = 25;  label = '고성장'; }
    else if (rgPct >= 20) { d = 18;  label = '높은 성장'; }
    else if (rgPct >= 10) { d = 10;  label = '견조한 성장'; }
    else if (rgPct >= 0)  { d = 3;   label = '완만한 성장'; }
    else                  { d = -15; label = '역성장'; }

    if (rgPct > 150 && d > 0) {
      d = 10;
      label = '급증 — 일회성/기저효과 가능성, 보너스 제한';
    }
    if (baseEffect && d > 0) {
      d = Math.round(d / 2);
      const drop = ((rev0! - rev2!) / rev2!) * 100;
      label += ` (기저효과 반등 — 2년 전 대비 ${drop.toFixed(0)}%, 절반만 인정)`;
    }
    score += d;
    reasons.push(`${year}매출 성장률 ${pct(rg)} — ${label}${delta(d)}`);

    // 2년 연속 매출 성장 보너스
    if (rows.length >= 2 && rows[1].revenue_growth != null && Number(rows[1].revenue_growth) > 0 && rg > 0 && !baseEffect) {
      score += 5;
      reasons.push('2년 연속 매출 성장 — 성장 지속성 (+5)');
    }
  } else {
    reasons.push('매출 성장률 데이터 없음 (직전 연도 비교 불가)');
  }

  // 영업이익 성장 (본업 성장 — 순이익보다 신뢰도 높은 축)
  {
    const curOp = f.operating_income != null ? Number(f.operating_income) : null;
    const prevOp = rows.length >= 2 && rows[1].operating_income != null ? Number(rows[1].operating_income) : null;
    if (eq.opTurnaround && curOp != null && prevOp != null) {
      const marginPct = eq.opMargin != null ? eq.opMargin * 100 : null;
      const weak = marginPct != null && marginPct < 5;
      const d = weak ? 4 : 8;
      score += d;
      reasons.push(
        `영업이익 흑자전환 (${fmtEok(prevOp)} → ${fmtEok(curOp)}${marginPct != null ? `, 이익률 ${marginPct.toFixed(1)}%` : ''})${weak ? ' — 소폭 전환' : ''}${delta(d)}`,
      );
    } else if (eq.opCollapse && curOp != null) {
      score -= 10;
      reasons.push(`영업이익 적자 전환 (${fmtEok(curOp)}) — 본업 악화${delta(-10)}`);
    } else if (eq.opGrowth != null) {
      const og = eq.opGrowth * 100;
      let d: number;
      let label: string;
      if (og >= 30)      { d = 10; label = '영업이익 고성장'; }
      else if (og >= 10) { d = 6;  label = '영업이익 성장'; }
      else if (og >= 0)  { d = 2;  label = '영업이익 유지'; }
      else               { d = -8; label = '영업이익 감소 — 본업 둔화'; }
      score += d;
      reasons.push(`${year}영업이익 성장률 ${pct(eq.opGrowth)} — ${label}${delta(d)}`);
    }
  }

  // EPS 성장률 (일회성 이익이면 무효)
  if (f.eps_growth != null) {
    const eg = Number(f.eps_growth);
    const egPct = eg * 100;
    let d: number;
    let label: string;
    if (oneOff) {
      d = 0;
      label = '일회성(영업외) 이익 기인 — 성장으로 불인정';
    } else if (egPct >= 30) {
      if (egPct > 150) { d = 10; label = '급증 — 지속성 불확실, 보너스 제한'; }
      else             { d = 25; label = '이익 급증'; }
    }
    else if (egPct >= 20) { d = 15;  label = '높은 이익 성장'; }
    else if (egPct >= 10) { d = 8;   label = '이익 성장'; }
    else if (egPct >= 0)  { d = 2;   label = '이익 유지'; }
    else                  { d = -15; label = '이익 감소'; }
    score += d;
    reasons.push(`${year}EPS 성장률 ${pct(eg)} — ${label}${delta(d)}`);
  } else {
    reasons.push('EPS 성장률 데이터 없음 (적자 또는 비교 불가)');
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export class GrowthEngine extends AlgorithmEngine {
  readonly meta: AlgorithmMeta = {
    id: 'growth_v1',
    name: '성장성 팩터',
    version: '3.0',
    category: 'growth',
    description: '매출·EPS YoY 성장률 (일회성 급증·기저효과 반등 감지)',
    enabled: true,
    weight: 0.20,
    params: { growthNormMax: 30 },
  };

  async calculate(stock: StockData, _ctx: MarketContext): Promise<EngineScore> {
    try {
      const { rows } = await getDb().query(
        `SELECT fiscal_year, revenue, revenue_growth, eps_growth, operating_income, net_income
         FROM stock_financials
         WHERE ticker = $1 AND fiscal_quarter IS NULL AND is_estimate = FALSE
         ORDER BY fiscal_year DESC LIMIT 3`,
        [stock.ticker],
      );
      return scoreGrowth(rows as GrowthFinRow[]);
    } catch {
      return { score: 50, reasons: ['재무 데이터 조회 실패 — 중립 처리'], dataMissing: true };
    }
  }
}
