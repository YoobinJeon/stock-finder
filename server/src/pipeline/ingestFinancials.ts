import { getDb, type Db } from '../config/database';
import { logger } from '../utils/logger';
import { num, kstToday } from './http';
import { fetchFinancials } from './sources/naverFinancials';
import { fetchConsensus, fetchQuarterlyConsensus } from './sources/naverConsensus';
import { fetchQuarterlyFinance } from './sources/naverQuarterlyFinance';
import { mergeConsensusEstimates } from './financialsMerge';
import { decideSurprises, type QuarterRow, type SurpriseRecord } from './earningsSurprise';

/**
 * 재무·컨센서스 수집과 어닝 서프라이즈 기록.
 * (2026-07-26 ingest.ts 분할 — 800줄 규칙. 로직은 그대로 옮겼다.)
 */

/**
 * PGlite는 BIGINT·DECIMAL을 문자열로 돌려주므로 판정 함수에 넣기 전에 수치로 정규화한다.
 * (num()은 콤마·단위 문자가 섞인 값도 방어적으로 처리한다)
 */
function toQuarterRows(rows: any[]): QuarterRow[] {
  return rows.map((r) => ({
    fiscalYear: Number(r.fiscal_year),
    fiscalQuarter: Number(r.fiscal_quarter),
    isEstimate: r.is_estimate === true,
    revenue: num(r.revenue),
    operatingIncome: num(r.operating_income),
    netIncome: num(r.net_income),
    eps: num(r.eps),
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  }));
}

/** 실행 단위 어닝 서프라이즈 요약 — 수집 루프 스코프에서 누적한다(전역 상태 금지). */
interface SurpriseTally {
  /** 적재를 마친 레코드 수 */
  recorded: number;
  /** 적재에 실패한 레코드 수 (실패분은 소급 불가 — 로그 덤프가 마지막 사본) */
  failed: number;
}

/**
 * E→A 전환 분기를 earnings_surprises에 기록한다. 이미 기록된 분기는 DO NOTHING으로 보존
 * (사후 정정치로 최초 사건을 덮지 않는다). **절대 throw하지 않는다** — 서프라이즈 기록
 * 실패가 재무 수집을 막아서는 안 되므로 유상증자 금액 파싱과 동일한 fail-soft 관례.
 * 실패는 레코드 단위로 격리한다 — 한 건이 실패해도 나머지는 시도해야 하고(각각 대체 불가),
 * 이 시점 DB는 이미 (A)라 catch 로그의 값 덤프가 사라진 컨센서스의 마지막 사본이다.
 */
async function recordEarningsSurprises(
  db: Db,
  ticker: string,
  records: SurpriseRecord[],
): Promise<SurpriseTally> {
  let recorded = 0;
  let failed = 0;
  try {
    const detectedAt = kstToday();
    for (const r of records) {
      try {
        await db.query(
          `INSERT INTO earnings_surprises
             (ticker, fiscal_year, fiscal_quarter, detected_at, estimate_updated_at,
              est_revenue, est_operating_income, est_net_income, est_eps,
              act_revenue, act_operating_income, act_net_income, act_eps,
              surprise_pct, revenue_surprise_pct, kind)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           ON CONFLICT (ticker, fiscal_year, fiscal_quarter) DO NOTHING`,
          [
            ticker, r.fiscalYear, r.fiscalQuarter, detectedAt, r.estimateUpdatedAt,
            r.est.revenue, r.est.operatingIncome, r.est.netIncome, r.est.eps,
            r.act.revenue, r.act.operatingIncome, r.act.netIncome, r.act.eps,
            r.surprisePct, r.revenueSurprisePct, r.kind,
          ],
        );
        recorded += 1;
        logger.info(
          `어닝 서프라이즈 포착: ${ticker} ${r.fiscalYear}.${r.fiscalQuarter}Q ` +
          `${r.kind} ${r.surprisePct ?? '-'}%`,
        );
      } catch (e: any) {
        failed += 1;
        logger.warn(
          `어닝 서프라이즈 기록 실패, 건너뜀 (${ticker} ${r.fiscalYear}.${r.fiscalQuarter}Q): ` +
          `${e?.message} — 잃은 값: ${JSON.stringify(r)}`,
        );
      }
    }
  } catch (e: any) {
    // 루프 바깥(kstToday 등)에서의 실패 — fail-soft 성질을 지키기 위한 최종 방어선
    failed += records.length - recorded;
    logger.warn(`어닝 서프라이즈 기록 실패, 건너뜀 (${ticker}): ${e?.message}`);
  }
  return { recorded, failed };
}

export async function ingestFinancials(ticker: string): Promise<SurpriseTally> {
  const fins = await fetchFinancials(ticker);
  // 다년 컨센서스(최대 +3년) 병합 — 실패해도 fins 그대로 진행(fail-soft, mergeConsensusEstimates 참고)
  const consensus = await fetchConsensus(ticker).catch(() => []);
  const merged = mergeConsensusEstimates(fins, consensus);
  const db = getDb();
  for (const f of merged) {
    await db.query(
      `INSERT INTO stock_financials
         (ticker, fiscal_year, fiscal_quarter, is_estimate, revenue, operating_income, net_income,
          eps, bps, per, pbr, roe, debt_ratio, div_yield, revenue_growth, eps_growth, updated_at)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
       ON CONFLICT (ticker, fiscal_year) WHERE fiscal_quarter IS NULL
       DO UPDATE SET
         is_estimate = EXCLUDED.is_estimate,
         revenue = EXCLUDED.revenue, operating_income = EXCLUDED.operating_income,
         net_income = EXCLUDED.net_income, eps = EXCLUDED.eps, bps = EXCLUDED.bps,
         per = EXCLUDED.per, pbr = EXCLUDED.pbr, roe = EXCLUDED.roe,
         debt_ratio = EXCLUDED.debt_ratio, div_yield = EXCLUDED.div_yield,
         revenue_growth = EXCLUDED.revenue_growth, eps_growth = EXCLUDED.eps_growth,
         updated_at = NOW()`,
      [
        ticker, f.fiscalYear, f.isEstimate, f.revenue, f.operatingIncome, f.netIncome,
        f.eps, f.bps, f.per, f.pbr, f.roe, f.debtRatio, f.divYield,
        f.revenueGrowth, f.epsGrowth,
      ],
    );
  }

  // 분기별 실적·컨센서스(확정 + 추정) — 연간과 별개 요청 1회. 실패해도 연간 수집엔 영향 없음
  // (fail-soft). 점수 엔진은 fiscal_quarter IS NULL 필터를 갖고 있어 이 행들에 오염되지 않는다.
  // bps: 분기말 BPS는 재무상태표 시점값이라 4분기(Q4) 값이 연말 BPS와 사실상 같다 — PBR 밴드가
  // 연간 확정치에 BPS가 없을 때(밸류에이션 밴드) 이 분기 데이터로 보강한다.
  const quarters = await fetchQuarterlyConsensus(ticker).catch(() => []);

  // upsert가 이전 추정치를 덮어쓰므로, 어닝 서프라이즈 판정 기준이 되는 직전 상태를
  // 반드시 여기서 먼저 읽어둔다 (이 스냅샷을 놓치면 그 분기는 소급 불가).
  const { rows: prevQuarterRows } = await db.query(
    `SELECT fiscal_year, fiscal_quarter, is_estimate, revenue, operating_income,
            net_income, eps, updated_at
       FROM stock_financials
      WHERE ticker = $1 AND fiscal_quarter IS NOT NULL`,
    [ticker],
  );

  // 판정·적재는 스냅샷(prevQuarterRows)과 소스 응답(quarters)만 쓰므로 upsert보다 앞에 둔다 —
  // upsert가 중간에 실패해도 이미 (A)로 덮인 분기의 컨센서스를 잃지 않기 위함(소급 불가).
  // 적재 후 upsert가 실패하면 다음 실행 때 스냅샷이 여전히 (E)라 재판정되고, INSERT의
  // ON CONFLICT (ticker, fiscal_year, fiscal_quarter) DO NOTHING이 중복을 막는다.
  const surprises = decideSurprises(
    toQuarterRows(prevQuarterRows),
    quarters.map((q) => ({
      fiscalYear: q.fiscalYear,
      fiscalQuarter: q.fiscalQuarter,
      isEstimate: q.isEstimate,
      revenue: q.revenue,
      operatingIncome: q.operatingIncome,
      netIncome: q.netIncome,
      eps: q.eps,
      updatedAt: null, // 새 응답에는 신선도 개념이 없다 — 기준은 직전 추정 행의 updated_at
    })),
  );
  const tally = surprises.length > 0
    ? await recordEarningsSurprises(db, ticker, surprises)
    : { recorded: 0, failed: 0 };

  for (const q of quarters) {
    await db.query(
      `INSERT INTO stock_financials
         (ticker, fiscal_year, fiscal_quarter, is_estimate, revenue, operating_income, net_income,
          eps, bps, per, pbr, roe, revenue_growth, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
       ON CONFLICT (ticker, fiscal_year, fiscal_quarter) WHERE fiscal_quarter IS NOT NULL
       DO UPDATE SET
         is_estimate = EXCLUDED.is_estimate,
         revenue = EXCLUDED.revenue, operating_income = EXCLUDED.operating_income,
         net_income = EXCLUDED.net_income, eps = EXCLUDED.eps, bps = EXCLUDED.bps,
         per = EXCLUDED.per, pbr = EXCLUDED.pbr, roe = EXCLUDED.roe,
         revenue_growth = EXCLUDED.revenue_growth,
         updated_at = NOW()`,
      [
        ticker, q.fiscalYear, q.fiscalQuarter, q.isEstimate, q.revenue, q.operatingIncome,
        q.netIncome, q.eps, q.bps, q.per, q.pbr, q.roe, q.revenueGrowth,
      ],
    );
  }

  // 이력 백필은 부가 작업이다 — 실패해도 이 함수를 실패시키지 않는다(fail-soft). 여기서 던지면
  // 호출측이 종목을 실패로 표시하고, 위에서 이미 적재를 마친 서프라이즈 집계(tally)까지 버린다.
  try {
    await backfillOlderQuarters(db, ticker, prevQuarterRows, quarters);
  } catch (e: any) {
    logger.warn(`분기 이력 백필 실패, 건너뜀 (${ticker}): ${e?.message}`);
  }

  return tally;
}

/** (연, 분기) → 비교용 단조 증가 키 */
function quarterKey(year: number, quarter: number): number {
  return year * 4 + (quarter - 1);
}

/**
 * 주 소스 창보다 **오래된** 분기만 보조 소스로 메운다 (스크리너 실적 개선 필터).
 *
 * 와이즈리포트는 확정 분기를 항상 4개만 준다 — 전년 동분기 비교(YoY)에 필요한 Q(t-4)가
 * 구조적으로 빠진다. 네이버 모바일 분기 API가 한 분기 더 과거를 주므로 그 차이만 채운다.
 *
 * 두 가지를 지킨다:
 * 1. **선단은 절대 건드리지 않는다.** 주 소스가 준 가장 오래된 분기보다 과거만 삽입한다.
 *    최신 분기를 이 소스가 (A)로 선삽입하면, 어닝 서프라이즈의 E→A 전환 감지가
 *    "이미 확정이던 분기"로 보고 그 분기의 서프라이즈를 영영 놓친다.
 * 2. **이미 메워졌으면 요청하지 않는다.** 저장된 확정 분기가 주 소스 창보다 과거까지
 *    닿아 있으면 백필이 끝난 것이므로 HTTP 요청을 아낀다(종목당 사실상 1회만 발생).
 */
async function backfillOlderQuarters(
  db: Db,
  ticker: string,
  storedRows: Array<{ fiscal_year: unknown; fiscal_quarter: unknown; is_estimate: unknown }>,
  fetched: Array<{ fiscalYear: number; fiscalQuarter: number }>,
): Promise<void> {
  if (fetched.length === 0) return; // 주 소스 실패 — 기준 창이 없으면 선단을 분간할 수 없다

  const oldestFetched = Math.min(...fetched.map((q) => quarterKey(q.fiscalYear, q.fiscalQuarter)));
  const storedKeys = storedRows
    .filter((r) => r.is_estimate !== true)
    .map((r) => quarterKey(Number(r.fiscal_year), Number(r.fiscal_quarter)))
    .filter((k) => Number.isFinite(k));
  if (storedKeys.length > 0 && Math.min(...storedKeys) < oldestFetched) return; // 백필 완료

  // 확정(A) 분기만 메운다 — 이 백필의 목적은 YoY 비교 기준점이 될 과거 실적 확보이고,
  // 판정은 확정 행만 비교 대상으로 삼으므로(earningsTrend.ts) 추정 행은 넣어봐야 쓰이지 않는다.
  const history = await fetchQuarterlyFinance(ticker);
  const older = history.filter(
    (q) => !q.isEstimate && quarterKey(q.fiscalYear, q.fiscalQuarter) < oldestFetched,
  );
  if (older.length === 0) return;

  for (const q of older) {
    // DO NOTHING — 이 소스는 이력 보강 전용이라 기존 행(주 소스의 더 풍부한 값)을 덮지 않는다.
    await db.query(
      `INSERT INTO stock_financials
         (ticker, fiscal_year, fiscal_quarter, is_estimate, revenue, operating_income, net_income,
          eps, bps, per, pbr, roe, updated_at)
       VALUES ($1, $2, $3, FALSE, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (ticker, fiscal_year, fiscal_quarter) WHERE fiscal_quarter IS NOT NULL
       DO NOTHING`,
      [
        ticker, q.fiscalYear, q.fiscalQuarter, q.revenue, q.operatingIncome,
        q.netIncome, q.eps, q.bps, q.per, q.pbr, q.roe,
      ],
    );
  }
}
