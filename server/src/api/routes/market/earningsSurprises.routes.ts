import { Router, Request, Response } from 'express';
import { getDb } from '../../../config/database';
import { asyncHandler } from '../../../utils/asyncHandler';

const router = Router();

// ── 어닝 서프라이즈 피드 — 대시보드 위젯용 ──

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 20;
const MAX_DAYS = 365;
const MAX_LIMIT = 100;

/**
 * 상회 쪽에 흑자전환을, 하회 쪽에 적자전환을 포함해 pct가 없는 전환 사건도 노출한다.
 * `inline`(예상 부합)·`deficit`(적자 지속)은 "서프라이즈"가 아니므로 양쪽 어디에도 넣지 않는다.
 */
export const BEAT_KINDS = ['beat', 'turn_positive'];
export const MISS_KINDS = ['miss', 'turn_negative'];

interface SurpriseOut {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
  fiscalYear: number;
  fiscalQuarter: number;
  detectedAt: string;
  kind: string;
  surprisePct: number | null;
  revenueSurprisePct: number | null;
  totalScore: number | null;
  changePct: number | null;
}

/** 쿼리 파라미터를 정수로 파싱하고 범위를 벗어나면 기본값으로 폴백 (신뢰하지 않는 입력) */
export function intParam(raw: unknown, fallback: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1 || n > max) return fallback;
  return n;
}

const SELECT_SQL = `
  SELECT es.ticker, s.name, s.market, s.sector,
         es.fiscal_year, es.fiscal_quarter,
         to_char(es.detected_at, 'YYYY-MM-DD') AS detected_at, es.kind,
         es.surprise_pct, es.revenue_surprise_pct,
         sc.total_score, i.day_change
    FROM earnings_surprises es
    JOIN stocks s ON s.ticker = es.ticker
    LEFT JOIN stock_scores sc ON sc.ticker = es.ticker
    LEFT JOIN stock_indicators i ON i.ticker = es.ticker
   WHERE es.detected_at >= CURRENT_DATE - ($1::int)
     AND es.kind = ANY($2::text[])
`;

/** SELECT_SQL이 돌려주는 행. PG는 DECIMAL·BIGINT를 문자열로 주므로 숫자 필드는 둘 다 받는다. */
interface SurpriseRow {
  ticker: string;
  name: string;
  market: string;
  sector: string | null;
  fiscal_year: number | string;
  fiscal_quarter: number | string;
  detected_at: string;
  kind: string;
  surprise_pct: number | string | null;
  revenue_surprise_pct: number | string | null;
  total_score: number | string | null;
  day_change: number | string | null;
}

/**
 * DB 행 → 응답 DTO. PG는 DECIMAL을 **문자열**로 돌려주므로 숫자 필드는 Number로 변환하되,
 * `0`을 결측으로 뭉개지 않도록 반드시 `== null` 비교를 쓴다(falsy 검사 금지).
 */
export function toOut(r: SurpriseRow): SurpriseOut {
  return {
    ticker: r.ticker,
    name: r.name,
    market: r.market,
    sector: r.sector,
    fiscalYear: Number(r.fiscal_year),
    fiscalQuarter: Number(r.fiscal_quarter),
    detectedAt: r.detected_at,
    kind: r.kind,
    surprisePct: r.surprise_pct == null ? null : Number(r.surprise_pct),
    revenueSurprisePct: r.revenue_surprise_pct == null ? null : Number(r.revenue_surprise_pct),
    totalScore: r.total_score == null ? null : Number(r.total_score),
    changePct: r.day_change == null ? null : Number(r.day_change),
  };
}

/**
 * 최근 N일 어닝 서프라이즈 상회·하회 목록.
 * pct가 없는 전환 사건(흑자전환·적자전환)은 NULLS LAST로 정렬 뒤쪽에 붙는다.
 */
router.get(
  '/earnings-surprises',
  asyncHandler(async (req: Request, res: Response) => {
    const days = intParam(req.query.days, DEFAULT_DAYS, MAX_DAYS);
    const limit = intParam(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const db = getDb();

    const [beats, misses] = await Promise.all([
      db.query(`${SELECT_SQL} ORDER BY es.surprise_pct DESC NULLS LAST LIMIT $3`, [days, BEAT_KINDS, limit]),
      db.query(`${SELECT_SQL} ORDER BY es.surprise_pct ASC NULLS LAST LIMIT $3`, [days, MISS_KINDS, limit]),
    ]);

    res.json({
      beats: beats.rows.map(toOut),
      misses: misses.rows.map(toOut),
    });
  }),
);

export default router;
