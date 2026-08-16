import { getDb, type Db } from '../config/database';
import { logger } from '../utils/logger';
import { sleep } from './http';
import type { JobRunner } from './JobRunner';
import { fetchCorpCodeMap, resolveCorpCode } from './sources/dartCorpCode';
import {
  fetchQuarterAmounts, deriveQ4, REPRT_CODE_BY_QUARTER, REPRT_CODE_ANNUAL, CORP_BATCH_SIZE,
  type AccountAmounts,
} from './sources/dartQuarterly';

/**
 * DART 분기 실적 이력 백필.
 *
 * 네이버 계열 소스가 분기 창을 4~5개로 고정해 놓아 "연속 몇 분기 개선인가"를 볼 수 없었다.
 * DART는 보고서 단위 조회라 연도를 거슬러 올라갈 수 있어 이력을 원하는 깊이까지 채운다.
 *
 * **알려진 한계 2개**:
 * - **비12월 결산 법인**은 분기 번호가 어긋날 수 있다. DART는 보고서 순번(1분기보고서 = 회계연도
 *   첫 3개월)이고 네이버는 결산월 기준이라, 3월 결산 법인이면 같은 기간이 서로 다른 분기 번호로
 *   적힌다. 국내 상장사 대부분이 12월 결산이라 허용 범위로 두고 기록만 남긴다.
 * - 최근 5분기는 네이버(억원 반올림), 그보다 과거는 DART(원 단위 정확값)이라 두 구간에 걸친
 *   증가율에 0.01% 수준의 반올림 오차가 섞인다 — 판정(증가/감소)을 뒤집을 크기가 아니다.
 *
 * **선단 불간섭 규칙** — `ingestFinancials.backfillOlderQuarters`와 같은 원칙을 지킨다:
 * 종목이 이미 보유한 **가장 오래된 확정 분기보다 과거만** 삽입한다. 최신 분기를 이 소스가
 * 먼저 (A)로 넣으면 어닝 서프라이즈의 E→A 전환 감지가 그 분기를 영구히 놓친다.
 * 보유 확정 분기가 아예 없는 종목은 건너뛴다(주 소스가 먼저 돌아야 기준 창이 생긴다).
 */

/** 백필할 과거 연수 (사용자 확정 2026-07-29: 3년 = 최대 12분기) */
export const BACKFILL_YEARS = 3;

/** DART 예절 — 배치 간 딜레이. 일일 한도(2만 건)에 비하면 호출 수는 미미하지만 버스트를 피한다. */
const DART_BATCH_DELAY_MS = 200;

export interface DartBackfillTally {
  /** corp_code를 새로 채운 종목 수 */
  mapped: number;
  /** 삽입한 분기 행 수 */
  inserted: number;
  /** 매출·영업이익이 모두 비어 건너뛴 분기 수 */
  empty: number;
}

/** (연, 분기) → 비교용 단조 증가 키 */
function quarterKey(year: number, quarter: number): number {
  return year * 4 + (quarter - 1);
}

/**
 * `stocks.corp_code`를 채운다. 매핑은 거의 변하지 않으므로 비어 있는 종목만 갱신한다.
 * 반환값은 이번에 채운 건수.
 */
async function syncCorpCodes(db: Db, apiKey: string): Promise<number> {
  // 비어 있는 종목이 없으면 30MB zip을 내려받지 않는다 — 매핑은 거의 변하지 않으므로
  // 재실행 때마다 다운로드·파싱을 반복할 이유가 없다.
  const { rows } = await db.query(
    'SELECT ticker FROM stocks WHERE is_active = TRUE AND corp_code IS NULL',
  );
  if (rows.length === 0) {
    logger.info('DART 고유번호 매핑: 채울 종목이 없어 건너뜁니다.');
    return 0;
  }

  const map = await fetchCorpCodeMap(apiKey);

  let mapped = 0;
  const unresolved: string[] = [];
  for (const row of rows as Array<{ ticker: string }>) {
    const corpCode = resolveCorpCode(map, row.ticker);
    if (!corpCode) {
      unresolved.push(row.ticker);
      continue;
    }
    await db.query('UPDATE stocks SET corp_code = $2 WHERE ticker = $1', [row.ticker, corpCode]);
    mapped += 1;
  }

  logger.info(
    `DART 고유번호 매핑 적재: ${mapped}건 신규` +
    (unresolved.length > 0 ? ` · 미매핑 ${unresolved.length}건 (${unresolved.slice(0, 10).join(', ')}${unresolved.length > 10 ? ' …' : ''})` : ''),
  );
  return mapped;
}

/** 종목별 "이 키보다 과거만 삽입 가능"한 경계 — 보유 확정 분기의 최솟값 */
async function loadInsertBoundary(db: Db): Promise<Map<string, number>> {
  const { rows } = await db.query(
    `SELECT ticker, MIN(fiscal_year * 4 + fiscal_quarter - 1) AS oldest
       FROM stock_financials
      WHERE fiscal_quarter IS NOT NULL AND is_estimate = FALSE
      GROUP BY ticker`,
  );
  const boundary = new Map<string, number>();
  for (const row of rows as Array<{ ticker: string; oldest: unknown }>) {
    const oldest = Number(row.oldest);
    if (Number.isFinite(oldest)) boundary.set(String(row.ticker), oldest);
  }
  return boundary;
}

/**
 * 한 연도의 네 분기를 배치 단위로 받아 삽입한다.
 * Q1~Q3는 각 보고서의 당기 3개월, Q4는 `연간 − (Q1+Q2+Q3)`로 유도한다.
 */
async function backfillYear(
  db: Db,
  apiKey: string,
  year: number,
  targets: Array<{ ticker: string; corpCode: string }>,
  boundary: Map<string, number>,
  tally: DartBackfillTally,
): Promise<void> {
  for (let i = 0; i < targets.length; i += CORP_BATCH_SIZE) {
    const batch = targets.slice(i, i + CORP_BATCH_SIZE);
    const codes = batch.map((t) => t.corpCode);

    const [q1, q2, q3, annual] = await Promise.all([
      fetchQuarterAmounts(apiKey, codes, year, REPRT_CODE_BY_QUARTER[1]),
      fetchQuarterAmounts(apiKey, codes, year, REPRT_CODE_BY_QUARTER[2]),
      fetchQuarterAmounts(apiKey, codes, year, REPRT_CODE_BY_QUARTER[3]),
      fetchQuarterAmounts(apiKey, codes, year, REPRT_CODE_ANNUAL),
    ]);

    for (const { ticker, corpCode } of batch) {
      const limit = boundary.get(ticker);
      if (limit == null) continue; // 주 소스가 아직 안 돈 종목 — 기준 창이 없어 건너뛴다

      const pick = (m: Map<string, AccountAmounts>) => m.get(corpCode) ?? null;
      const a1 = pick(q1), a2 = pick(q2), a3 = pick(q3), ay = pick(annual);

      const quarters: Array<{ quarter: number; amounts: AccountAmounts }> = [
        { quarter: 1, amounts: a1 ?? { revenue: null, operatingIncome: null } },
        { quarter: 2, amounts: a2 ?? { revenue: null, operatingIncome: null } },
        { quarter: 3, amounts: a3 ?? { revenue: null, operatingIncome: null } },
        {
          quarter: 4,
          amounts: {
            revenue: deriveQ4(a1?.revenue ?? null, a2?.revenue ?? null, a3?.revenue ?? null, ay?.revenue ?? null),
            operatingIncome: deriveQ4(
              a1?.operatingIncome ?? null, a2?.operatingIncome ?? null,
              a3?.operatingIncome ?? null, ay?.operatingIncome ?? null,
            ),
          },
        },
      ];

      for (const { quarter, amounts } of quarters) {
        if (quarterKey(year, quarter) >= limit) continue; // 선단 불간섭
        if (amounts.revenue == null && amounts.operatingIncome == null) {
          tally.empty += 1;
          continue;
        }
        // DO NOTHING — 이력 보강 전용. 기존 행(주 소스의 더 풍부한 값)을 덮지 않는다.
        const { rows } = await db.query(
          `INSERT INTO stock_financials
             (ticker, fiscal_year, fiscal_quarter, is_estimate, revenue, operating_income, updated_at)
           VALUES ($1, $2, $3, FALSE, $4, $5, NOW())
           ON CONFLICT (ticker, fiscal_year, fiscal_quarter) WHERE fiscal_quarter IS NOT NULL
           DO NOTHING
           RETURNING ticker`,
          [ticker, year, quarter, amounts.revenue, amounts.operatingIncome],
        );
        if (rows.length > 0) tally.inserted += 1;
      }
    }

    await sleep(DART_BATCH_DELAY_MS);
  }
}

/**
 * 활성 종목의 분기 실적 이력을 DART로 `BACKFILL_YEARS`년치 채운다.
 *
 * 경계(`boundary`)는 **루프 전에 한 번만** 읽는다. 삽입할수록 종목의 "가장 오래된 확정 분기"가
 * 과거로 내려가는데, 매 연도마다 다시 읽으면 경계가 같이 내려가 방금 넣은 것보다 과거를 넣지
 * 못하게 된다. 원래의 선단을 기준으로 고정해두는 것이 이 규칙의 요점이다.
 */
export async function backfillDartQuarterly(
  db: Db = getDb(),
  job?: JobRunner,
): Promise<DartBackfillTally> {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) {
    logger.warn('DART_API_KEY가 없어 분기 이력 백필을 건너뜁니다.');
    return { mapped: 0, inserted: 0, empty: 0 };
  }

  job?.setPhase('DART 고유번호 매핑');
  const mapped = await syncCorpCodes(db, apiKey);

  const { rows } = await db.query(
    `SELECT ticker, corp_code FROM stocks
      WHERE is_active = TRUE AND corp_code IS NOT NULL ORDER BY ticker`,
  );
  const targets = (rows as Array<{ ticker: string; corp_code: string }>).map((r) => ({
    ticker: String(r.ticker),
    corpCode: String(r.corp_code),
  }));

  const boundary = await loadInsertBoundary(db);
  const tally: DartBackfillTally = { mapped, inserted: 0, empty: 0 };

  // 기준 연도 = 종목별 "가장 오래된 확정 분기" 중 **가장 최근**(= 이력이 가장 얕은 종목).
  // 전역 최솟값을 쓰면 이력이 깊은 한 종목이 시작 연도를 과거로 끌어내려, 얕은 종목들은
  // 중간 연도가 통째로 비게 된다 — 이력에 구멍이 나면 연속 개선 판정이 그 지점에서 끊긴다.
  // 깊은 종목은 아래 종목별 경계 검사에서 자연히 건너뛰므로 낭비도 없다.
  const keys = [...boundary.values()];
  const shallowestKey = keys.length > 0 ? Math.max(...keys) : NaN;
  const baseYear = Number.isFinite(shallowestKey)
    ? Math.floor(shallowestKey / 4)
    : new Date().getFullYear();

  job?.setPhase('DART 분기 이력 백필', BACKFILL_YEARS);
  for (let offset = 0; offset < BACKFILL_YEARS; offset++) {
    const year = baseYear - offset;
    await backfillYear(db, apiKey, year, targets, boundary, tally);
    logger.info(`DART 분기 백필 ${year}년 완료 — 누적 삽입 ${tally.inserted}행`);
    job?.tick();
  }

  logger.info(
    `DART 분기 이력 백필 완료: 고유번호 ${tally.mapped}건 신규, 분기 ${tally.inserted}행 삽입, ` +
    `금액 결측 ${tally.empty}건 (대상 ${targets.length}종목 × ${BACKFILL_YEARS}년)`,
  );
  return tally;
}
