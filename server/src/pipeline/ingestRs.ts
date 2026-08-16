import { type Db } from '../config/database';
import { JobRunner } from './JobRunner';
import {
  calcPeriodReturns,
  rankStocks,
  type StockRsRow,
  RS_OFFSET_TODAY,
  RS_OFFSET_1M,
  RS_OFFSET_3M,
  RS_OFFSET_6M,
  RS_OFFSET_12M,
} from './rsRanking';
import { isRsTopEntry } from './signalDetection';
import { SCORE_BATCH } from './ingestConfig';

/**
 * RS 백분위 크로스섹션 계산과 시그널 upsert — runIngest가 전 종목 종가를 모은 뒤 호출한다.
 * (2026-07-26 ingest.ts 분할 — 800줄 규칙. 로직은 그대로 옮겼다.)
 */

interface RsPivotRow {
  ticker: string;
  d0: string | null; // 최신(오늘) 거래일 — rs_top_entry 시그널의 signal_date로 사용
  c0: string | number | null;
  c1m: string | number | null;
  c3m: string | number | null;
  c6m: string | number | null;
  c12m: string | number | null;
}

const toNum = (v: string | number | null): number | null => (v == null ? null : Number(v));

/** 시그널 1건 upsert (기준일당 종목·타입별 1회 — ON CONFLICT DO NOTHING). computeIndicators()의
 *  종목별 감지와 updateRsPercentiles()의 크로스섹션 rs_top_entry 감지가 공유한다. */
export async function insertSignal(
  db: Db,
  signalDate: string,
  ticker: string,
  type: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `INSERT INTO signals (signal_date, ticker, type, detail)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (signal_date, ticker, type) DO NOTHING`,
    [signalDate, ticker, type, JSON.stringify(detail)],
  );
}

/**
 * stock_indicators.rs_percentile 갱신 — 통합 RS(기간별 백분위 가중평균, rsRanking.ts 순수 함수 재사용).
 * 갱신 전 현재값을 rs_percentile_prev로 옮겨 signals의 rs_top_entry가 비교할 수 있게 한다.
 * 1M·3M 종가가 모두 있어야 통합 RS가 나온다(calcIntegratedRsScore 최소 요건) — 상장 초기 등으로 둘 중
 * 하나라도 없으면 이번 갱신에서 건너뛴다(컬럼 유지). 기존 12M/6M 단순 순위 방식보다 필요 이력이 짧아
 * (6M/126거래일 → 3M/64거래일) 커버리지는 축소되지 않고 오히려 넓어진다.
 */
export async function updateRsPercentiles(db: Db, job: JobRunner): Promise<void> {
  const { rows: pivotRows } = await db.query(
    `WITH ranked AS (
       SELECT p.ticker, p.trade_date, p.close,
              ROW_NUMBER() OVER (PARTITION BY p.ticker ORDER BY p.trade_date DESC) AS rn
       FROM stock_prices p
       JOIN stocks s ON s.ticker = p.ticker AND s.is_active = TRUE
       WHERE p.close IS NOT NULL
     )
     SELECT ticker,
            to_char(MAX(CASE WHEN rn = $1 THEN trade_date END), 'YYYY-MM-DD') AS d0,
            MAX(CASE WHEN rn = $1 THEN close END) AS c0,
            MAX(CASE WHEN rn = $2 THEN close END) AS c1m,
            MAX(CASE WHEN rn = $3 THEN close END) AS c3m,
            MAX(CASE WHEN rn = $4 THEN close END) AS c6m,
            MAX(CASE WHEN rn = $5 THEN close END) AS c12m
     FROM ranked
     WHERE rn <= $5
     GROUP BY ticker
     HAVING MAX(CASE WHEN rn = $1 THEN close END) IS NOT NULL`,
    [RS_OFFSET_TODAY, RS_OFFSET_1M, RS_OFFSET_3M, RS_OFFSET_6M, RS_OFFSET_12M],
  );

  const dateByTicker = new Map<string, string>(
    (pivotRows as RsPivotRow[]).filter((r) => r.d0 != null).map((r) => [r.ticker, r.d0 as string]),
  );

  const rsRows: StockRsRow[] = (pivotRows as RsPivotRow[]).map((r) => ({
    ticker: r.ticker,
    name: '',
    sector: null,
    marketCap: null,
    market: '',
    ret: calcPeriodReturns({
      c0: toNum(r.c0),
      c1m: toNum(r.c1m),
      c3m: toNum(r.c3m),
      c6m: toNum(r.c6m),
      c12m: toNum(r.c12m),
    }),
  }));

  const ranked = rankStocks(rsRows);
  job.setPhase('RS 백분위 계산', ranked.length);
  for (let i = 0; i < ranked.length; i += SCORE_BATCH) {
    const batch = ranked.slice(i, i + SCORE_BATCH);
    await Promise.all(
      batch.map(async (r) => {
        if (r.rs.integrated != null) {
          try {
            // SET 절 우변은 UPDATE 전(직전 실행) 값 기준으로 평가되므로, RETURNING rs_percentile_prev는
            // 이번 갱신 직전의 rs_percentile — rs_top_entry가 비교할 "직전값"을 추가 쿼리 없이 얻는다.
            const { rows: updated } = await db.query(
              `UPDATE stock_indicators
               SET rs_percentile_prev = rs_percentile, rs_percentile = $2
               WHERE ticker = $1
               RETURNING rs_percentile_prev`,
              [r.ticker, r.rs.integrated],
            );
            const prevRs = toNum(updated[0]?.rs_percentile_prev ?? null);
            const signalDate = dateByTicker.get(r.ticker);
            if (signalDate && isRsTopEntry(r.rs.integrated, prevRs)) {
              await insertSignal(db, signalDate, r.ticker, 'rs_top_entry', {
                rs_percentile: r.rs.integrated,
                rs_percentile_prev: prevRs,
              });
            }
          } catch { /* 개별 종목 실패는 건너뜀 */ }
        }
        job.tick();
      }),
    );
  }
}
