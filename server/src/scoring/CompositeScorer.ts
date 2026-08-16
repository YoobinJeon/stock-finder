import { registry } from './AlgorithmRegistry';
import { ValueEngine } from './engines/ValueEngine';
import { TechInnovationEngine } from './engines/TechInnovationEngine';
import { MomentumEngine } from './engines/MomentumEngine';
import { QualityEngine } from './engines/QualityEngine';
import { GrowthEngine } from './engines/GrowthEngine';
import { FlowEngine } from './engines/FlowEngine';
import { StockData, MarketContext } from './engines/base/AlgorithmEngine';
import { getDb } from '../config/database';
import { logger } from '../utils/logger';

// 엔진 등록 (총점 기여 가중치 합계 = 1.00 — flow_v1은 검증 전까지 가중치 0으로 breakdown·
// score_history에만 축적된다., algorithm_configs 시드는 마이그 034)
registry.register(new ValueEngine());          // 0.30
registry.register(new QualityEngine());        // 0.25
registry.register(new GrowthEngine());         // 0.20
registry.register(new MomentumEngine());       // 0.15
registry.register(new TechInnovationEngine()); // 0.10
registry.register(new FlowEngine());           // 0.00 (검증 후 활성화 예정)

export interface EngineResult {
  id: string;
  name: string;
  category: string;
  weight: number;
  score: number;
  reasons: string[];
  /** true면 해당 엔진이 데이터 부족으로 중립(50점) fail-soft 처리됨 */
  dataMissing?: boolean;
  /** 'coverage_info' 행에만 존재 — 커버리지 배지(클라)가 참조하는 집계치 */
  coverage?: ScoreCoverage;
}

export interface ScoreCoverage {
  available: number;
  total: number;
}

export interface CompositeScore {
  total: number;
  breakdown: EngineResult[];
  calculatedAt: string;
}

/** 결측 엔진이 이 개수 이상이면 커버리지 수축 적용 */
const LOW_COVERAGE_MIN_MISSING = 2;
/** 커버리지 수축 계수 — size_adjustment와 동일하게 50점 기준 초과분을 할인 */
const LOW_COVERAGE_SHRINK = 0.85;

/**
 * 순수 계산: 결측 엔진 수가 임계 이상이면 중립(50) 방향으로 총점을 수축.
 * 재무·시세 데이터가 없는 종목이 fail-soft 중립 50점들의 가중합으로 중간 점수까지
 * 부풀려지는 것을 방지 — size_adjustment와 동일한 "50점 기준 할인" 패턴.
 */
export function applyCoverageShrink(total: number, missingCount: number): { total: number; note: string | null } {
  if (missingCount < LOW_COVERAGE_MIN_MISSING) return { total, note: null };
  const shrunk = Math.round(50 + (total - 50) * LOW_COVERAGE_SHRINK);
  if (shrunk === total) return { total, note: null };
  return {
    total: shrunk,
    note: `데이터 결측 엔진 ${missingCount}개 — 커버리지 신뢰도 할인 적용 (${total}점 → ${shrunk}점)`,
  };
}

class CompositeScorer {
  async score(stock: StockData, context: MarketContext): Promise<CompositeScore> {
    const activeEngines = await registry.getActive();

    const results = await Promise.all(
      activeEngines.map(async (engine): Promise<EngineResult> => {
        const { score, reasons, dataMissing } = await engine.calculate(stock, context);
        return {
          id: engine.meta.id,
          name: engine.meta.name,
          category: engine.meta.category,
          weight: engine.meta.weight,
          score: Math.min(100, Math.max(0, Math.round(score))),
          reasons,
          ...(dataMissing ? { dataMissing: true } : {}),
        };
      }),
    );

    // 커버리지 집계 (adjustment 행이 섞이기 전, 엔진 결과만으로 계산). 가중치 0인 엔진(검증
    // 중인 신규 팩터 — 예: flow_v1)은 총점에 기여하지 않으므로 분모(기존 "n/5" 표시)에서 제외한다.
    const contributingResults = results.filter((r) => r.weight > 0);
    const missingCount = contributingResults.filter((r) => r.dataMissing).length;
    const coverage: ScoreCoverage = {
      available: contributingResults.length - missingCount,
      total: contributingResults.length,
    };

    // 가중 합산 (정규화)
    const totalWeight = results.reduce((s, r) => s + r.weight, 0);
    const raw = totalWeight > 0
      ? results.reduce((s, r) => s + r.score * (r.weight / totalWeight), 0)
      : 0;

    // 규모 신뢰도 보정: 초소형주는 재무 노이즈·일회성 왜곡이 커서 중립(50) 방향으로 수축
    const { total: sizeAdjustedTotal, note: sizeNote } = applySizeAdjustment(raw, stock.market_cap as number | null | undefined);
    if (sizeNote) {
      results.push({
        id: 'size_adjustment',
        name: '규모 신뢰도 보정',
        category: 'adjustment',
        weight: 0,
        score: sizeAdjustedTotal,
        reasons: [sizeNote],
      });
    }

    // 커버리지 수축(결측 2개↑) — 규모 보정 뒤·위험 캡 앞 순서. 정보 노출은 결측이 1개라도
    // 있으면(available < total) 수행하되, 점수 할인은 임계 이상일 때만 적용.
    const { total: coverageAdjustedTotal, note: coverageShrinkNote } = applyCoverageShrink(sizeAdjustedTotal, missingCount);
    if (coverage.available < coverage.total) {
      results.push({
        id: 'coverage_info',
        name: '데이터 커버리지',
        category: 'adjustment',
        weight: 0,
        score: coverageAdjustedTotal,
        reasons: coverageShrinkNote
          ? [coverageShrinkNote]
          : [`데이터 커버리지 ${coverage.available}/${coverage.total} — 정보용, 점수 영향 없음`],
        coverage,
      });
    }

    // 위험종목 제외 규칙: 부채비율 500% 초과 또는 3년 연속 영업손실 → 점수 상한 캡
    const risk = await checkRiskExclusion(stock.ticker as string);
    let finalTotal = coverageAdjustedTotal;
    if (risk.length > 0 && coverageAdjustedTotal > RISK_SCORE_CAP) {
      finalTotal = RISK_SCORE_CAP;
      results.push({
        id: 'risk_exclusion',
        name: '위험종목 제외 규칙',
        category: 'adjustment',
        weight: 0,
        score: finalTotal,
        reasons: risk.map((r) => `🚫 ${r} — 점수 상한 ${RISK_SCORE_CAP}점 적용 (${coverageAdjustedTotal}점 → ${finalTotal}점)`),
      });
    }

    // 공시 이벤트 룰 (DART): 제외성 공시 → 점수 캡 / 감점·가점 공시 → 델타 합산
    const disc = await checkDisclosureEvents(stock.ticker as string);
    if (disc.exclusions.length > 0 || disc.delta !== 0) {
      const before = finalTotal;
      const reasons: string[] = [];
      if (disc.exclusions.length > 0 && finalTotal > RISK_SCORE_CAP) {
        finalTotal = RISK_SCORE_CAP;
        reasons.push(...disc.exclusions.map((e) => `🚫 ${e} — 점수 상한 ${RISK_SCORE_CAP}점 적용`));
      }
      if (disc.delta !== 0) {
        finalTotal = Math.max(0, Math.min(100, finalTotal + disc.delta));
        reasons.push(...disc.notes);
      }
      if (finalTotal !== before || reasons.length > 0) {
        results.push({
          id: 'disclosure_events',
          name: '공시 이벤트 반영',
          category: 'adjustment',
          weight: 0,
          score: finalTotal,
          reasons: [...reasons, `공시 반영 결과: ${before}점 → ${finalTotal}점`],
        });
      }
    }

    return {
      total: finalTotal,
      breakdown: results,
      calculatedAt: new Date().toISOString(),
    };
  }
}

/** 시가총액 구간별 수축 계수 (50점 기준으로 초과분을 할인) */
function applySizeAdjustment(raw: number, marketCap: number | null | undefined): { total: number; note: string | null } {
  const rounded = Math.round(raw);
  if (marketCap == null || marketCap <= 0) {
    return { total: rounded, note: null };
  }

  let factor = 1.0;
  let sizeLabel = '';
  if (marketCap < 50_000_000_000)            { factor = 0.7;  sizeLabel = '초소형주(시총 500억 미만)'; }
  else if (marketCap < 100_000_000_000)      { factor = 0.8;  sizeLabel = '초소형주(시총 1,000억 미만)'; }
  else if (marketCap < 300_000_000_000)      { factor = 0.85; sizeLabel = '소형주(시총 3,000억 미만)'; }
  else if (marketCap < 1_000_000_000_000)    { factor = 0.95; sizeLabel = '중형주(시총 1조 미만)'; }

  if (factor === 1.0) return { total: rounded, note: null };

  const adjusted = Math.round(50 + (raw - 50) * factor);
  if (adjusted === rounded) return { total: rounded, note: null };

  const capText = marketCap >= 1e12
    ? `${(marketCap / 1e12).toFixed(1)}조`
    : `${Math.round(marketCap / 1e8).toLocaleString('ko-KR')}억`;
  return {
    total: adjusted,
    note: `${sizeLabel}, 시총 ${capText} — 재무 신뢰도 할인 적용 (${rounded}점 → ${adjusted}점)`,
  };
}

/** 제외 규칙 상한: 어떤 팩터가 좋아도 이 점수를 넘지 못함 */
const RISK_SCORE_CAP = 30;

/** 부채비율 500% 초과(최신 확정 연도) / 3년 연속 영업손실 여부 판정 */
async function checkRiskExclusion(ticker: string): Promise<string[]> {
  try {
    const { rows } = await getDb().query(
      `SELECT fiscal_year, debt_ratio, operating_income
       FROM stock_financials
       WHERE ticker = $1 AND fiscal_quarter IS NULL AND is_estimate = FALSE
       ORDER BY fiscal_year DESC LIMIT 3`,
      [ticker],
    );
    if (rows.length === 0) return [];

    const risks: string[] = [];
    const latest = rows[0] as { debt_ratio: string | null; operating_income: string | null };
    if (latest.debt_ratio != null && Number(latest.debt_ratio) > 5.0) {
      risks.push(`부채비율 ${(Number(latest.debt_ratio) * 100).toFixed(0)}% (500% 초과)`);
    }
    if (rows.length >= 3 && rows.every((r) => r.operating_income != null && Number(r.operating_income) < 0)) {
      risks.push('3년 연속 영업손실');
    }
    return risks;
  } catch (e) {
    logger.warn('제외 규칙 재무 조회 실패 — 규칙 미적용', e);
    return []; // 재무 조회 실패 시 규칙 미적용 (점수 계산은 계속)
  }
}

/** 공시 이벤트 조회 — 제외성 공시 90일, 감점·가점 30일 창구. 델타 합산은 ±15로 캡. */
const DISCLOSURE_DELTA_CAP = 15;

export interface DisclosureEventRow {
  event_type: string;
  score_delta: number | string;
  detail: string | null;
  d: string;       // MM/DD 표기
  recent: boolean; // 30일 창 안인지
}

/**
 * 공시 이벤트 행들을 제외/델타/사유로 집계하는 순수 함수.
 * 가점(+)은 동일 유형(detail)당 30일 창에서 1회만 인정 — 공급계약 등 같은 유형을
 * 반복 공시하는 종목이 캡(+15)까지 부풀리는 왜곡 방지(2026-07-17, 디바이스 사례).
 * 감점(-)은 건별 위험이 실제로 누적되므로 중복 허용. rows는 rcept_dt DESC 정렬 가정
 * (중복 유형 중 최신 건이 대표로 남음).
 */
export function aggregateDisclosureEvents(rows: DisclosureEventRow[]): { exclusions: string[]; delta: number; notes: string[] } {
  const exclusions: string[] = [];
  const notes: string[] = [];
  const seenBonusTypes = new Set<string>();
  let skippedDup = 0;
  let delta = 0;

  for (const r of rows) {
    if (r.event_type === 'exclusion') {
      exclusions.push(`${r.detail} (${r.d})`);
      continue;
    }
    if (!r.recent) continue;

    const d = Number(r.score_delta);
    if (d > 0) {
      const key = r.detail ?? '';
      if (seenBonusTypes.has(key)) {
        skippedDup += 1;
        continue; // 동일 유형 가점은 1회만
      }
      seenBonusTypes.add(key);
    }
    delta += d;
    // 0점 이벤트는 점수를 설명하지 못하므로 목록에 넣지 않는다 — 최대주주 지분 변동처럼
    // 원문 파싱 결과 감점 사유가 아니었던 건이 여기 해당한다(공시 피드에는 그대로 남는다).
    if (d !== 0) notes.push(`${d > 0 ? '＋' : ''}${d} ${r.detail} (${r.d})`);
  }

  if (skippedDup > 0) notes.push(`동일 유형 반복 공시 ${skippedDup}건 미가산`);
  delta = Math.max(-DISCLOSURE_DELTA_CAP, Math.min(DISCLOSURE_DELTA_CAP, delta));
  return { exclusions, delta, notes };
}

async function checkDisclosureEvents(ticker: string): Promise<{ exclusions: string[]; delta: number; notes: string[] }> {
  try {
    const { rows } = await getDb().query(
      `SELECT event_type, score_delta, detail, to_char(rcept_dt, 'MM/DD') AS d,
              rcept_dt >= (CURRENT_DATE - INTERVAL '30 days') AS recent
       FROM disclosure_events
       WHERE ticker = $1 AND event_type IS NOT NULL
         AND rcept_dt >= (CURRENT_DATE - INTERVAL '90 days')
       ORDER BY rcept_dt DESC`,
      [ticker],
    );
    return aggregateDisclosureEvents(rows as DisclosureEventRow[]);
  } catch (e) {
    logger.warn('공시 이벤트 조회 실패 — 룰 미적용', e);
    return { exclusions: [], delta: 0, notes: [] }; // 조회 실패 시 미적용
  }
}

export const compositeScorer = new CompositeScorer();
