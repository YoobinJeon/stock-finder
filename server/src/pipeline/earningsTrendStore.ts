import { getDb, type Db } from '../config/database';
import { logger } from '../utils/logger';
import { num } from './http';
import { decideEarningsTrend, type QuarterPoint } from './earningsTrend';

/**
 * 분기 실적 개선 판정 결과 적재 (스크리너 실적 개선 필터).
 *
 * 판정 규칙은 `earningsTrend.ts`(순수 함수)에 있고 여기서는 읽기·쓰기만 한다.
 * **저장된 분기만 읽어 전 종목을 다시 판정한다** — 공시 룰에서 겪었듯 새 규칙이
 * 기존 데이터에 소급되지 않으면 규칙을 고칠 때마다 30분+ 전체 수집을 다시 돌려야 한다.
 * 이 함수는 네트워크를 타지 않으므로 규칙 수정 후 곧바로 재판정할 수 있다.
 */

export interface EarningsTrendTally {
  /** 판정에 성공해 적재한 종목 수 */
  computed: number;
  /** 확정 분기가 없어 행을 지운 종목 수 */
  cleared: number;
}

/** PGlite는 BIGINT를 문자열로 돌려주므로 판정 함수에 넣기 전에 수치로 정규화한다. */
function toQuarterPoint(r: Record<string, unknown>): QuarterPoint {
  return {
    fiscalYear: Number(r.fiscal_year),
    fiscalQuarter: Number(r.fiscal_quarter),
    isEstimate: r.is_estimate === true,
    revenue: num(r.revenue),
    operatingIncome: num(r.operating_income),
  };
}

/**
 * 활성 종목 전체의 실적 개선 판정을 저장된 분기 재무만으로 다시 계산해 적재한다.
 *
 * 종목별로 질의하지 않고 한 번에 훑는다 — 활성 2,700여 종목 × 분기 7행 정도라 메모리에
 * 담기고, 종목당 왕복을 없애는 편이 PGlite(단일 프로세스)에서 훨씬 빠르다.
 */
export async function recomputeEarningsTrends(db: Db = getDb()): Promise<EarningsTrendTally> {
  const { rows } = await db.query(
    `SELECT f.ticker, f.fiscal_year, f.fiscal_quarter, f.is_estimate, f.revenue, f.operating_income
       FROM stock_financials f
       JOIN stocks s ON s.ticker = f.ticker AND s.is_active = TRUE
      WHERE f.fiscal_quarter IS NOT NULL
      ORDER BY f.ticker, f.fiscal_year, f.fiscal_quarter`,
  );

  const byTicker = new Map<string, QuarterPoint[]>();
  for (const r of rows as Array<Record<string, unknown>>) {
    const ticker = String(r.ticker);
    const list = byTicker.get(ticker);
    if (list) list.push(toQuarterPoint(r));
    else byTicker.set(ticker, [toQuarterPoint(r)]);
  }

  let computed = 0;
  let cleared = 0;
  let yoyImproving = 0;
  let qoqImproving = 0;
  let streak3Plus = 0;
  for (const [ticker, quarters] of byTicker) {
    const trend = decideEarningsTrend(quarters);
    if (!trend) {
      // 확정 분기가 사라진 종목(추정만 남음)은 낡은 판정을 남겨두지 않는다.
      const { rows: deleted } = await db.query(
        'DELETE FROM stock_earnings_trend WHERE ticker = $1 RETURNING ticker',
        [ticker],
      );
      if (deleted.length > 0) cleared += 1;
      continue;
    }

    await db.query(
      `INSERT INTO stock_earnings_trend
         (ticker, base_year, base_quarter, base_revenue, base_operating_income,
          revenue_yoy, op_yoy, op_yoy_turnaround, yoy_improving,
          yoy_prev_revenue, yoy_prev_operating_income,
          qoq_prev_revenue, qoq_prev_operating_income,
          revenue_qoq, op_qoq, op_qoq_turnaround, qoq_improving,
          yoy_streak, qoq_streak,
          est_yoy_improving, est_qoq_improving,
          est_year, est_quarter, est_revenue, est_operating_income,
          est_revenue_yoy, est_op_yoy, est_op_yoy_turnaround,
          est_revenue_qoq, est_op_qoq, est_op_qoq_turnaround,
          est_yoy_prev_revenue, est_yoy_prev_operating_income,
          est_qoq_prev_revenue, est_qoq_prev_operating_income, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
               $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
               $29, $30, $31, $32, $33, $34, $35, NOW())
       ON CONFLICT (ticker) DO UPDATE SET
         base_year = EXCLUDED.base_year, base_quarter = EXCLUDED.base_quarter,
         base_revenue = EXCLUDED.base_revenue,
         base_operating_income = EXCLUDED.base_operating_income,
         yoy_prev_revenue = EXCLUDED.yoy_prev_revenue,
         yoy_prev_operating_income = EXCLUDED.yoy_prev_operating_income,
         qoq_prev_revenue = EXCLUDED.qoq_prev_revenue,
         qoq_prev_operating_income = EXCLUDED.qoq_prev_operating_income,
         revenue_yoy = EXCLUDED.revenue_yoy, op_yoy = EXCLUDED.op_yoy,
         op_yoy_turnaround = EXCLUDED.op_yoy_turnaround, yoy_improving = EXCLUDED.yoy_improving,
         revenue_qoq = EXCLUDED.revenue_qoq, op_qoq = EXCLUDED.op_qoq,
         op_qoq_turnaround = EXCLUDED.op_qoq_turnaround, qoq_improving = EXCLUDED.qoq_improving,
         yoy_streak = EXCLUDED.yoy_streak, qoq_streak = EXCLUDED.qoq_streak,
         est_yoy_improving = EXCLUDED.est_yoy_improving,
         est_qoq_improving = EXCLUDED.est_qoq_improving,
         est_year = EXCLUDED.est_year, est_quarter = EXCLUDED.est_quarter,
         est_revenue = EXCLUDED.est_revenue,
         est_operating_income = EXCLUDED.est_operating_income,
         est_revenue_yoy = EXCLUDED.est_revenue_yoy, est_op_yoy = EXCLUDED.est_op_yoy,
         est_op_yoy_turnaround = EXCLUDED.est_op_yoy_turnaround,
         est_revenue_qoq = EXCLUDED.est_revenue_qoq, est_op_qoq = EXCLUDED.est_op_qoq,
         est_op_qoq_turnaround = EXCLUDED.est_op_qoq_turnaround,
         est_yoy_prev_revenue = EXCLUDED.est_yoy_prev_revenue,
         est_yoy_prev_operating_income = EXCLUDED.est_yoy_prev_operating_income,
         est_qoq_prev_revenue = EXCLUDED.est_qoq_prev_revenue,
         est_qoq_prev_operating_income = EXCLUDED.est_qoq_prev_operating_income,
         computed_at = NOW()`,
      [
        ticker, trend.baseYear, trend.baseQuarter,
        trend.baseRevenue, trend.baseOperatingIncome,
        trend.yoy.revenueGrowth, trend.yoy.opGrowth, trend.yoy.opTurnaround, trend.yoy.improving,
        trend.yoy.prevRevenue, trend.yoy.prevOperatingIncome,
        trend.qoq.prevRevenue, trend.qoq.prevOperatingIncome,
        trend.qoq.revenueGrowth, trend.qoq.opGrowth, trend.qoq.opTurnaround, trend.qoq.improving,
        trend.yoyStreak, trend.qoqStreak,
        trend.estimate?.yoy.improving === true, trend.estimate?.qoq.improving === true,
        trend.estimate?.fiscalYear ?? null, trend.estimate?.fiscalQuarter ?? null,
        trend.estimate?.revenue ?? null, trend.estimate?.operatingIncome ?? null,
        trend.estimate?.yoy.revenueGrowth ?? null, trend.estimate?.yoy.opGrowth ?? null,
        trend.estimate?.yoy.opTurnaround === true,
        trend.estimate?.qoq.revenueGrowth ?? null, trend.estimate?.qoq.opGrowth ?? null,
        trend.estimate?.qoq.opTurnaround === true,
        trend.estimate?.yoy.prevRevenue ?? null, trend.estimate?.yoy.prevOperatingIncome ?? null,
        trend.estimate?.qoq.prevRevenue ?? null, trend.estimate?.qoq.prevOperatingIncome ?? null,
      ],
    );
    computed += 1;
    if (trend.yoy.improving) yoyImproving += 1;
    if (trend.qoq.improving) qoqImproving += 1;
    if (trend.yoyStreak >= 3) streak3Plus += 1;
  }

  logger.info(
    `실적 개선 판정: ${computed}개 종목 적재, ${cleared}개 정리 ` +
    `(YoY 개선 ${yoyImproving}개, QoQ 개선 ${qoqImproving}개, YoY 3분기+ 연속 ${streak3Plus}개)`,
  );

  return { computed, cleared };
}
