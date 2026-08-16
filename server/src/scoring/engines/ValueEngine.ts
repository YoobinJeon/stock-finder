import { AlgorithmEngine, AlgorithmMeta, StockData, MarketContext, EngineScore, delta } from './base/AlgorithmEngine';
import { getDb } from '../../config/database';
import { assessEarningsQuality } from '../earningsQuality';

/** stock_financials에서 가치 팩터가 읽는 컬럼 (최신 연도부터 최대 3개년) */
export interface ValueFinRow {
  fiscal_year: number;
  per: number | string | null;
  pbr: number | string | null;
  div_yield: number | string | null;
  ev_ebitda: number | string | null;
  revenue: number | string | null;
  operating_income: number | string | null;
  net_income: number | string | null;
}

/** 순수 계산: 이미 조회된 재무 3개년 rows(최신 연도부터 내림차순)로부터 가치 점수 산출 */
export function scoreValue(rows: ValueFinRow[]): EngineScore {
  if (rows.length === 0) {
    return { score: 50, reasons: ['재무 데이터 없음 — 중립(50점) 처리'], dataMissing: true };
  }

  const f = rows[0];
  let score = 50;
  const reasons: string[] = [];

  // 이익의 질 (3개년 시계열): 이번 연도만 순이익이 튀면 일회성 → 저PER 착시 가능
  const eq = assessEarningsQuality(rows);
  const { oneOff } = eq;
  if (oneOff) {
    const op = Number(f.operating_income);
    const ni = Number(f.net_income);
    reasons.push(
      `⚠ 순이익(${fmtEok(ni)})이 영업이익(${fmtEok(op)})을 크게 상회 — 일회성 이익 의심, 저PER 신뢰 불가`,
    );
  } else if (eq.structural) {
    reasons.push('순이익>영업이익 구조가 수년간 지속 (지주사/지분법 특성) — 일회성 아님, 정상 평가');
  }

  // PER
  if (f.per != null) {
    const per = Number(f.per);
    let d: number;
    let label: string;
    if (per < 0)             { d = -15; label = '적자 기업'; }
    else if (oneOff && per <= 15) { d = 5; label = '일회성 이익 왜곡 가능 — 보너스 제한'; }
    else if (per < 2)        { d = 10;  label = '비정상적 저PER — 일회성/데이터 확인 필요'; }
    else if (per <= 8)       { d = 20;  label = '크게 저평가'; }
    else if (per <= 15)      { d = 10;  label = '저평가 구간'; }
    else if (per <= 25)      { d = 0;   label = '적정 수준'; }
    else                     { d = -10; label = '고평가 구간'; }
    score += d;
    reasons.push(`PER ${per.toFixed(1)}배 — ${label}${delta(d)}`);
  } else {
    reasons.push('PER 정보 없음');
  }

  // PBR
  if (f.pbr != null) {
    const pbr = Number(f.pbr);
    let d = 0;
    let label = '보통';
    if (pbr < 0.3)      { d = 8;  label = '극단적 저PBR — 자산주 또는 시장 외면 가능성'; }
    else if (pbr < 0.8) { d = 15; label = '청산가치 이하'; }
    else if (pbr < 1.5) { d = 8;  label = '순자산 대비 저평가'; }
    else if (pbr > 3)   { d = -5; label = '프리미엄 구간'; }
    score += d;
    reasons.push(`PBR ${pbr.toFixed(2)}배 — ${label}${delta(d)}`);
  }

  // 배당수익률
  if (f.div_yield != null) {
    const dy = Number(f.div_yield) * 100;
    let d = 0;
    if (dy >= 4)      d = 10;
    else if (dy >= 2) d = 5;
    score += d;
    if (dy > 0) {
      reasons.push(`배당수익률 ${dy.toFixed(2)}% — ${dy >= 4 ? '고배당' : dy >= 2 ? '배당 양호' : '저배당'}${delta(d)}`);
    }
  }

  // EV/EBITDA
  if (f.ev_ebitda != null) {
    const ev = Number(f.ev_ebitda);
    let d = 0;
    let label = '적정';
    if (ev > 0 && ev <= 6) { d = 10; label = '저평가'; }
    else if (ev > 0 && ev <= 12) { d = 5; label = '양호'; }
    else if (ev > 20) { d = -5; label = '고평가'; }
    score += d;
    reasons.push(`EV/EBITDA ${ev.toFixed(1)} — ${label}${delta(d)}`);
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export class ValueEngine extends AlgorithmEngine {
  readonly meta: AlgorithmMeta = {
    id: 'value_v1',
    name: '가치 팩터',
    version: '3.0',
    category: 'value',
    description: 'PER, PBR, 배당수익률 기반 저평가 평가 (일회성 이익 왜곡 감지)',
    enabled: true,
    weight: 0.30,
    params: { perWeight: 0.35, pbrWeight: 0.30, divWeight: 0.15, evWeight: 0.20 },
  };

  async calculate(stock: StockData, _ctx: MarketContext): Promise<EngineScore> {
    try {
      const { rows } = await getDb().query(
        `SELECT fiscal_year, per, pbr, div_yield, ev_ebitda, revenue, operating_income, net_income
         FROM stock_financials
         WHERE ticker = $1 AND fiscal_quarter IS NULL AND is_estimate = FALSE
         ORDER BY fiscal_year DESC LIMIT 3`,
        [stock.ticker],
      );
      return scoreValue(rows as ValueFinRow[]);
    } catch {
      return { score: 50, reasons: ['재무 데이터 조회 실패 — 중립 처리'], dataMissing: true };
    }
  }
}

/** 원 단위 → "1,422억" 표기 */
export function fmtEok(won: number): string {
  return `${Math.round(won / 1e8).toLocaleString('ko-KR')}억`;
}
