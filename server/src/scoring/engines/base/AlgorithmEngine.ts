export type AlgorithmCategory =
  | 'value'
  | 'momentum'
  | 'quality'
  | 'growth'
  | 'tech_innovation'
  | 'industry_trend'
  | 'leader_stock'
  | 'flow';

export interface AlgorithmMeta {
  id: string;
  name: string;
  version: string;
  category: AlgorithmCategory;
  description: string;
  enabled: boolean;
  weight: number;           // 0~1, 전체 엔진 합산 = 1
  params: Record<string, number | string | boolean>;
}

export interface StockData {
  ticker: string;
  name?: string;
  market?: string;
  sector?: string;
  [key: string]: unknown;
}

export interface MarketContext {
  kospiReturn1M?: number;
  kospiReturn3M?: number;
  sectorAverages?: Record<string, unknown>;
}

/** 엔진 계산 결과: 점수와 함께 실데이터 기반 근거를 반환 */
export interface EngineScore {
  score: number;      // 0~100
  reasons: string[];  // 예: "PER 6.8배 — 크게 저평가 (+20)"
  /** true면 재무·시세 데이터 부족으로 중립(50점) fail-soft 처리된 결과 — 커버리지 집계용 */
  dataMissing?: boolean;
}

export abstract class AlgorithmEngine {
  abstract readonly meta: AlgorithmMeta;

  /** 0~100 점수와 근거 목록 반환 */
  abstract calculate(stock: StockData, context: MarketContext): Promise<EngineScore>;
}

/** 점수 기여분 표기: "(+20)" / "(-10)" / 0이면 빈 문자열 */
export function delta(d: number): string {
  if (d === 0) return '';
  return d > 0 ? ` (+${d})` : ` (${d})`;
}

/** 퍼센트 표기 (부호 포함): 0.152 → "+15.2%" */
export function pct(v: number): string {
  const p = v * 100;
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}
