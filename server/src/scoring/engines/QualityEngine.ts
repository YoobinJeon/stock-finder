import { AlgorithmEngine, AlgorithmMeta, StockData, MarketContext, EngineScore, delta } from './base/AlgorithmEngine';
import { getDb } from '../../config/database';
import { assessEarningsQuality } from '../earningsQuality';
import { fmtEok } from './ValueEngine';

/** stock_financials에서 퀄리티 팩터가 읽는 컬럼 (최신 연도부터 최대 3개년) */
export interface QualityFinRow {
  fiscal_year: number;
  roe: number | string | null;
  roa: number | string | null;
  debt_ratio: number | string | null;
  revenue: number | string | null;
  operating_income: number | string | null;
  net_income: number | string | null;
}

/** 순수 계산: 이미 조회된 재무 3개년 rows(최신 연도부터 내림차순)로부터 퀄리티 점수 산출 */
export function scoreQuality(rows: QualityFinRow[]): EngineScore {
  if (rows.length === 0) {
    return { score: 50, reasons: ['재무 데이터 없음 — 중립(50점) 처리'], dataMissing: true };
  }

  const f = rows[0]; // 최신 확정 연도
  let score = 50;
  const reasons: string[] = [];

  // 이익의 질 (3개년 시계열 판단): 이번 연도만 순이익이 튀는 일회성만 감점,
  // 지주사/지분법처럼 구조적으로 순이익>영업이익인 기업은 면제
  const eq = assessEarningsQuality(rows);
  const { oneOff } = eq;
  const op = f.operating_income != null ? Number(f.operating_income) : null;
  const ni = f.net_income != null ? Number(f.net_income) : null;
  if (oneOff) {
    score -= 10;
    reasons.push(`⚠ 이익의 질 낮음 — 순이익 ${fmtEok(ni!)} 중 대부분이 영업외 이익 (영업이익 ${op != null ? fmtEok(op) : '없음'}) (-10)`);
  } else if (eq.structural) {
    reasons.push('순이익>영업이익 구조 지속 (지주사/지분법 특성) — 일회성 감점 미적용');
  }

  // ROE (일회성 이익이면 부풀려진 값이므로 보너스 절반)
  if (f.roe != null) {
    const roe = Number(f.roe) * 100;
    let d: number;
    let label: string;
    if (roe < 0)        { d = -25; label = '적자'; }
    else if (roe >= 20) { d = 25;  label = '초우량 수익성'; }
    else if (roe >= 15) { d = 15;  label = '우수한 수익성'; }
    else if (roe >= 10) { d = 8;   label = '양호'; }
    else if (roe < 5)   { d = -15; label = '수익성 저조'; }
    else                { d = 0;   label = '보통'; }
    if (oneOff && d > 0) {
      d = Math.round(d / 2);
      label += ' (일회성 이익 반영치 — 절반만 인정)';
    }
    score += d;
    reasons.push(`ROE ${roe.toFixed(1)}% — ${label}${delta(d)}`);

    // 3년 일관성 보너스
    if (rows.length >= 3) {
      const allGood = rows.every((r) => r.roe != null && Number(r.roe) * 100 >= 10);
      if (allGood) {
        score += 5;
        reasons.push('3년 연속 ROE 10% 이상 — 꾸준한 수익성 (+5)');
      }
    }
  } else {
    reasons.push('ROE 정보 없음');
  }

  // 영업이익률 (본업 수익성)
  const rev = f.revenue != null ? Number(f.revenue) : null;
  if (rev != null && rev > 0 && op != null) {
    const margin = (op / rev) * 100;
    let d: number;
    let label: string;
    if (margin >= 15)     { d = 10;  label = '고수익 사업'; }
    else if (margin >= 8) { d = 5;   label = '양호한 본업 수익성'; }
    else if (margin >= 0) { d = 0;   label = '저마진'; }
    else                  { d = -15; label = '영업적자'; }
    score += d;
    reasons.push(`영업이익률 ${margin.toFixed(1)}% — ${label}${delta(d)}`);
  }

  // 부채비율
  if (f.debt_ratio != null) {
    const dr = Number(f.debt_ratio) * 100;
    let d: number;
    let label: string;
    if (dr < 50)       { d = 15;  label = '매우 건전'; }
    else if (dr < 100) { d = 8;   label = '건전'; }
    else if (dr < 200) { d = 0;   label = '보통'; }
    else               { d = -15; label = '부채 과다'; }
    score += d;
    reasons.push(`부채비율 ${dr.toFixed(0)}% — ${label}${delta(d)}`);
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export class QualityEngine extends AlgorithmEngine {
  readonly meta: AlgorithmMeta = {
    id: 'quality_v1',
    name: '퀄리티 팩터',
    version: '3.0',
    category: 'quality',
    description: 'ROE, 영업이익률, 부채비율, 이익의 질 기반 재무 건전성',
    enabled: true,
    weight: 0.25,
    params: { roeMax: 20, debtMax: 200 },
  };

  async calculate(stock: StockData, _ctx: MarketContext): Promise<EngineScore> {
    try {
      const { rows } = await getDb().query(
        `SELECT fiscal_year, roe, roa, debt_ratio, revenue, operating_income, net_income
         FROM stock_financials
         WHERE ticker = $1 AND fiscal_quarter IS NULL AND is_estimate = FALSE
         ORDER BY fiscal_year DESC LIMIT 3`,
        [stock.ticker],
      );
      return scoreQuality(rows as QualityFinRow[]);
    } catch {
      return { score: 50, reasons: ['재무 데이터 조회 실패 — 중립 처리'], dataMissing: true };
    }
  }
}
