/**
 * 기업 액션(감자·액면병합·분할) 가격 재정합 — stock_prices는 매일 증분(EOD append)으로 쌓이므로,
 * 기업 액션이 소급 적용된 "수정주가" 계열을 뒤늦게 반영하지 못하면 과거에 저장해둔 낡은 스케일
 * 행이 남아 며칠치 종가가 실제로는 존재하지 않았던 폭등/폭락처럼 보인다(예: 10:1 감자 → +900%).
 * rsRanking.ts의 suspect_jump(+300%) 배제는 이런 오염 종목을 랭킹에서 걸러내는 안전망일 뿐이고,
 * 이 모듈은 근본 원인 — 낡은 스케일 데이터 자체 — 을 감지해 해당 종목만 수정주가로 재수집한다.
 */
import { getDb, type Db } from '../config/database';
import { logger } from '../utils/logger';
import { invalidateMonthlySnapshot } from '../utils/monthlySnapshotCache';
import { sleep } from './http';
import { fetchYahooChart, type DailyPrice } from './sources/yahooPrices';
import {
  diffAdjustmentSeries,
  fetchKisDailyPrices,
  type KisAdjustmentEvent,
} from './sources/kisDailyPrice';

// KRX 일일 상하한가는 ±30%(0.7~1.3배)다. 연속 "거래일" 종가 비율이 이 범위를 크게 벗어난
// [0.6, 1.4] 밖이면 하루 등락으로는 설명이 불가능하므로 기업 액션 미보정 또는 데이터 오류로 간주한다.
// (여유폭을 30%가 아닌 40%/60%로 둔 이유: 상하한가에 걸린 정상적인 이틀 연속 등락과 헷갈리지 않기 위한 마진.)
// 월간 상승률도 같은 기준으로 오염 구간을 걸러내므로 내보낸다 — 두 곳이 다른 기준을
// 쓰면 "여기선 파손, 저기선 정상"이 되어 화면끼리 어긋난다.
export const BREAK_RATIO_HIGH = 1.4;
export const BREAK_RATIO_LOW = 0.6;

// RS 랭킹이 참조하는 기간(12개월 수익률)을 커버하도록 13개월 룩백 — 그 이전 낡은 데이터는
// 랭킹에 영향을 주지 않으므로 스캔 범위에서 제외해 쿼리를 가볍게 유지한다.
const BREAK_LOOKBACK_MONTHS = 13;

// Yahoo 차트 API의 range 파라미터는 열거형(1y/2y/...)이라 "400일" 같은 임의 일수를 직접 지정할 수
// 없다. 여유를 두고 2y치를 조회한 뒤, 아래 일수만큼만 잘라 사용한다.
const REPAIR_LOOKBACK_DAYS = 400;
const REPAIR_FETCH_RANGE = '2y';
const MIN_REPAIR_ROWS = 30; // 이보다 적으면 Yahoo 응답이 불완전한 것으로 보고 복구를 건너뜀(fail-soft)
const REPAIR_CHUNK = 100; // ingestPrices와 동일한 멀티로우 INSERT 청크 크기
const REPAIR_REQUEST_DELAY_MS = 300; // 종목 간 politeness 딜레이 (ingest.ts의 BATCH_DELAY_MS와 동일 관례)

/**
 * 연속 거래일 종가 비율이 정상 범위를 벗어났는지 판정하는 순수 함수.
 * prev가 0 이하(상장 초기 등 의미 없는 값)이면 판정 불가로 보고 false.
 * 경계값(정확히 1.4배 또는 0.6배)은 "벗어난 것"에 포함하지 않는다 — 초과(>)/미만(<)만 이상으로 본다.
 */
export function isBreakRatio(prev: number, curr: number): boolean {
  if (prev <= 0) return false;
  const ratio = curr / prev;
  return ratio > BREAK_RATIO_HIGH || ratio < BREAK_RATIO_LOW;
}

/**
 * stock_prices에서 최근 13개월 내 연속 거래일 종가 비율이 이상 범위를 벗어난 종목 티커를 감지한다.
 * LAG(close)로 전일 종가를 구해 한 번의 SQL로 판정 — 애플리케이션 레벨 순회 없음.
 */
export async function detectPriceBreaks(): Promise<string[]> {
  const db = getDb();
  const { rows } = await db.query(
    `WITH recent AS (
       SELECT ticker, trade_date, close,
              LAG(close) OVER (PARTITION BY ticker ORDER BY trade_date) AS prev_close
       FROM stock_prices
       WHERE trade_date >= CURRENT_DATE - INTERVAL '${BREAK_LOOKBACK_MONTHS} months'
     )
     SELECT DISTINCT ticker FROM recent
     WHERE prev_close IS NOT NULL AND prev_close > 0 AND close IS NOT NULL
       AND (close::float / prev_close::float > $1 OR close::float / prev_close::float < $2)
     ORDER BY ticker`,
    [BREAK_RATIO_HIGH, BREAK_RATIO_LOW],
  );
  return rows.map((r: any) => r.ticker as string);
}

/**
 * **한 종목**에 파손이 남아 있는가 — 재정합 뒤 결과를 확인하는 데 쓴다.
 *
 * `detectPriceBreaks`와 같은 창·같은 기준을 쓴다. 두 판정이 갈리면 "고쳤다"고 보고한 종목이
 * 다음 실행에서 다시 감지되는 무한 루프가 된다.
 */
export async function tickerHasBreak(ticker: string): Promise<boolean> {
  const db = getDb();
  const { rows } = await db.query(
    `WITH recent AS (
       SELECT close, LAG(close) OVER (ORDER BY trade_date) AS prev_close
       FROM stock_prices
       WHERE ticker = $1 AND trade_date >= CURRENT_DATE - INTERVAL '${BREAK_LOOKBACK_MONTHS} months'
     )
     SELECT 1 FROM recent
     WHERE prev_close IS NOT NULL AND prev_close > 0 AND close IS NOT NULL
       AND (close::float / prev_close::float > $2 OR close::float / prev_close::float < $3)
     LIMIT 1`,
    [ticker, BREAK_RATIO_HIGH, BREAK_RATIO_LOW],
  );
  return rows.length > 0;
}

export interface TickerRepairOutcome {
  inserted: number;
  /** 실제로 재수집에 쓰인 원천 */
  source: 'kis' | 'yahoo';
  /**
   * KIS 수정주가·원주가 대조로 **확인된** 기업행위. `null`은 "확인 못 함"(Yahoo 폴백)이며
   * 빈 배열은 "확인했고 기업행위 없음"이다 — 후자는 감지가 오탐이었다는 뜻이라 구분해야 한다.
   */
  adjustments: KisAdjustmentEvent[] | null;
}

/** "시장이 거래한 날"로 인정할 최소 종목 수 — 재정합이 건드리는 수십 종목으로는 넘을 수 없다. */
const MIN_MARKET_DAY_TICKERS = 100;

/**
 * 이 일봉을 다시 써 넣을 구간에 포함할지 — 순수 판정.
 *
 * 위쪽 상한(`marketLastDay`)이 핵심이다. 원천은 장중에도 "오늘" 바를 주므로, 상한이 없으면
 * 재정합 대상 몇 종목만 하루 앞선 거래일을 갖게 되고 `MAX(trade_date)`로 계산하는 시세
 * 기준일이 시장 전체가 최신인 것처럼 거짓말한다.
 */
export function withinRepairWindow(
  tradeDate: string, cutoffIso: string, marketLastDay: string | null,
): boolean {
  if (tradeDate < cutoffIso) return false;
  return marketLastDay == null || tradeDate <= marketLastDay;
}

/**
 * **시장이 실제로 거래한** 마지막 날.
 *
 * 단순 `MAX(trade_date)`를 쓰면 안 된다 — 재정합이 소수 종목에 오늘 바를 넣어버리면 그 값이
 * 곧 최댓값이 되어, "거래일을 앞당기지 마라"는 규칙이 자기가 만든 날짜를 기준으로 삼는
 * 순환에 빠진다. 그래서 **일정 종목 수 이상이 값을 가진 날**만 거래일로 친다.
 */
async function lastMarketDay(db: Db): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT MAX(trade_date)::text AS d FROM (
       SELECT trade_date FROM stock_prices
        WHERE trade_date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY trade_date
       HAVING COUNT(*) >= ${MIN_MARKET_DAY_TICKERS}
     ) t`,
  );
  if (rows[0]?.d) return rows[0].d as string;
  // 종목이 적은 초기 상태 — 상한을 걸 근거가 없으니 걸지 않는다.
  const { rows: fallback } = await db.query('SELECT MAX(trade_date)::text AS d FROM stock_prices');
  return (fallback[0]?.d as string | null) ?? null;
}

/** KIS 수정주가·원주가를 함께 받아 기업행위를 사실로 확인한다. KIS 불가 시 null. */
async function fetchKisRepairSeries(
  ticker: string,
): Promise<{ rows: DailyPrice[]; adjustments: KisAdjustmentEvent[] } | null> {
  const opts = { days: REPAIR_LOOKBACK_DAYS };
  const [adjusted, original] = await Promise.all([
    fetchKisDailyPrices(ticker, { ...opts, mode: 'adjusted' as const }),
    fetchKisDailyPrices(ticker, { ...opts, mode: 'original' as const }),
  ]);
  if (!adjusted) return null;
  // 원주가 조회만 실패하면 기업행위 확인은 포기하되 수정주가로 복구는 진행한다.
  return { rows: adjusted, adjustments: original ? diffAdjustmentSeries(adjusted, original) : [] };
}

/**
 * 단일 종목의 최근 ~400일 수정주가 일봉을 재조회해 stock_prices를 교체한다.
 * 해당 구간을 DELETE한 뒤 신규 데이터를 청크 단위로 INSERT한다.
 * (참고: DELETE를 별도로 참조되지 않는 data-modifying CTE로 INSERT와 한 문장에 묶어 시도했으나,
 * PGlite가 미참조 CTE의 부수효과를 실행하지 않아 — 실제 PostgreSQL과 달리 — DELETE가 누락되고
 * 중복 키 오류가 발생함을 확인. 그래서 DELETE와 INSERT를 별도의 순차 쿼리로 분리한다.)
 *
 * 원천은 KIS가 정본이고 Yahoo는 폴백이다(2026-07-26 Phase 2). KIS 경로에서는 수정주가·원주가
 * 두 계열을 대조해 **기업행위를 사실로 확인**하므로, ±30% 휴리스틱은 "확인할 후보를 고르는"
 * 역할로 축소된다 — 판정 근거가 아니다.
 * 응답이 빈약하면(< MIN_REPAIR_ROWS) throw — 호출자(runPriceRepair)가 종목별로 catch한다.
 */
export async function repairTickerPrices(
  ticker: string,
  /** 'yahoo'를 주면 KIS를 건너뛴다 — KIS로 고쳐지지 않은 종목을 다른 원천으로 다시 시도할 때. */
  forceSource?: 'yahoo',
): Promise<TickerRepairOutcome> {
  const db = getDb();
  const { rows: stockRows } = await db.query('SELECT market FROM stocks WHERE ticker = $1', [ticker]);
  const market = stockRows[0]?.market as string | undefined;
  if (!market) throw new Error(`종목 정보 없음(stocks 테이블에 없음): ${ticker}`);

  const kis = forceSource === 'yahoo' ? null : await fetchKisRepairSeries(ticker);
  const source: 'kis' | 'yahoo' = kis ? 'kis' : 'yahoo';
  const chart = kis?.rows ?? (await fetchYahooChart(ticker, market, REPAIR_FETCH_RANGE, '1d'));
  const adjustments = kis?.adjustments ?? null;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - REPAIR_LOOKBACK_DAYS);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  /**
   * 재정합은 **거래일을 앞당기지 않는다.**
   *
   * 원천은 장중에도 "오늘" 바를 준다. 그걸 그대로 넣으면 재정합 대상 몇 종목만 하루 앞선
   * 거래일을 갖게 되고, `MAX(trade_date)`로 계산하는 시세 기준일·신선도 배지가 시장 전체가
   * 최신인 것처럼 거짓말한다. 실제로 14시에 수동 실행했더니 **거래정지 13종목에 거래량 0인
   * 2026-08-11 행**이 생겨 기준일이 08-11로 올라갔다(2026-08-11 확인).
   *
   * 시세 수집은 이 모듈보다 먼저 끝나므로(ingest 3.1단계), 정상 경로에서는 이 상한이
   * 이미 오늘이라 아무것도 잘리지 않는다.
   */
  const marketLastDay = await lastMarketDay(db);

  const fresh = chart.filter(
    (r) => r.close != null && withinRepairWindow(r.trade_date, cutoffIso, marketLastDay),
  );

  if (fresh.length < MIN_REPAIR_ROWS) {
    throw new Error(
      `재조회 데이터 부족(${source} ${fresh.length}행 < ${MIN_REPAIR_ROWS}) — 복구 건너뜀`,
    );
  }

  const dates = fresh.map((r) => r.trade_date).sort();
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];

  await db.query(
    'DELETE FROM stock_prices WHERE ticker = $1 AND trade_date BETWEEN $2 AND $3',
    [ticker, minDate, maxDate],
  );

  // 이전 실행이 남긴 "거래일 앞선" 행을 걷어낸다 — 상한을 걸기 전 만들어진 유령 바가 남아 있으면
  // 시세 기준일이 계속 앞당겨진 채로 굳는다.
  if (marketLastDay != null) {
    await db.query(
      'DELETE FROM stock_prices WHERE ticker = $1 AND trade_date > $2',
      [ticker, marketLastDay],
    );
  }

  let inserted = 0;
  for (let i = 0; i < fresh.length; i += REPAIR_CHUNK) {
    const chunk = fresh.slice(i, i + REPAIR_CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      const b = j * 7;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`);
      params.push(ticker, r.trade_date, r.open, r.high, r.low, r.close, r.volume);
    });

    await db.query(
      `INSERT INTO stock_prices (ticker, trade_date, open, high, low, close, volume)
       VALUES ${values.join(', ')}
       ON CONFLICT (ticker, trade_date) DO UPDATE
         SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
             close = EXCLUDED.close, volume = EXCLUDED.volume`,
      params,
    );
    inserted += chunk.length;
  }

  return { inserted, source, adjustments };
}

/**
 * 재정합 한 번의 결과를 어떻게 처리할지 — 순수 판정.
 *
 * 이 규칙이 이 모듈의 핵심이다: **재수집이 예외 없이 끝난 것과 파손이 사라진 것은 다르다.**
 * 원천에 불연속이 남아 있으면 같은 데이터를 다시 써 넣게 되므로, 확인한 뒤 원천을 바꿔 한 번
 * 더 시도하고, 그래도 남으면 "우리가 고칠 수 없다"고 말한다.
 */
export function nextRepairStep(
  stillBroken: boolean, source: 'kis' | 'yahoo',
): 'done' | 'retry-yahoo' | 'unfixable' {
  if (!stillBroken) return 'done';
  return source === 'kis' ? 'retry-yahoo' : 'unfixable';
}

export interface PriceRepairResult {
  detected: number;
  /** 재수집 후 **파손이 실제로 사라진** 종목 수. 재수집 성공 횟수가 아니다. */
  repaired: number;
  /**
   * 재수집했는데도 파손이 남은 종목 — **원천에도 불연속이 있어 우리가 고칠 수 없다.**
   * 감춰선 안 된다: 월간 상승률이 이 종목들의 해당 달을 제외하는 근거이고,
   * 목록이 늘어나는 것 자체가 원천 품질 신호다.
   */
  unfixable: string[];
  failed: string[];
  /** 기업행위가 KIS 두 계열 대조로 실제 확인된 종목 수 */
  adjustmentsConfirmed: number;
  /** 복구는 했으나 기업행위를 확인하지 못한 종목 수(Yahoo 폴백 경로) */
  unverified: number;
}

/**
 * 가격 재정합 오케스트레이션 — 감지 → 재수집 → **결과 확인**. 종목 하나 실패해도 계속 진행(fail-soft).
 * data.routes.ts의 POST /repair-prices(수동)와 ingest.ts의 전체 수집 스코프 종료 시(자동) 호출된다.
 *
 * ⚠️ **재수집 성공 = 복구 성공이 아니다.** 예전 구현은 재수집이 예외 없이 끝나면 `repaired++`만
 * 했다. 원천에도 불연속이 있으면 같은 파손 데이터를 다시 써 넣고 "복구 완료"로 보고하게 되는데,
 * 실제로 그런 상태가 몇 주 이어졌다 — 2026-08-11 확인 시 **감지 17개 / 보고 17개 복구 / 실제
 * 해소 0개**였다. 그래서 재수집 뒤 **같은 기준으로 다시 판정**하고, KIS로 안 고쳐졌으면 원천을
 * 바꿔(Yahoo) 한 번 더 시도한다. 그 확인이 없으면 이 잡은 영원히 성공을 보고하며 아무것도
 * 고치지 않는다.
 */
export async function runPriceRepair(): Promise<PriceRepairResult> {
  logger.info('가격 복구: 시작 — 기업 액션 미보정 의심 종목 스캔');

  const tickers = await detectPriceBreaks();
  logger.info(`가격 복구: 이상 종가 비율 감지 ${tickers.length}개 종목`);

  const failed: string[] = [];
  const unfixable: string[] = [];
  let repaired = 0;
  let adjustmentsConfirmed = 0;
  let unverified = 0;

  for (const ticker of tickers) {
    try {
      const outcome = await repairTickerPrices(ticker);
      let source = outcome.source;
      let stillBroken = await tickerHasBreak(ticker);

      // KIS 수정주가에도 불연속이 남아 있으면 다른 원천을 본다. 실제로 이 경로가 17개 중
      // 3개(진원생명과학·메디콕스·큐에이드)를 살렸다 — Yahoo는 소급 보정을 마친 상태였다.
      if (nextRepairStep(stillBroken, source) === 'retry-yahoo') {
        await sleep(REPAIR_REQUEST_DELAY_MS);
        try {
          const retry = await repairTickerPrices(ticker, 'yahoo');
          source = retry.source;
          stillBroken = await tickerHasBreak(ticker);
          logger.info(`가격 복구 재시도 (${ticker}): Yahoo ${retry.inserted}행`);
        } catch (e: any) {
          // 재시도 실패는 KIS 결과를 되돌리지 않는다 — 이미 써 넣은 데이터가 더 나쁘진 않다.
          logger.warn(`가격 복구 Yahoo 재시도 실패 (${ticker}): ${e?.message ?? String(e)}`);
        }
      }

      if (stillBroken) {
        unfixable.push(ticker);
        logger.warn(
          `가격 복구 불가 (${ticker}): 재수집했으나 불연속이 남음 — 원천(${source})에도 파손`,
        );
      } else {
        repaired++;
        if (outcome.adjustments == null) unverified++;
        else if (outcome.adjustments.length > 0) adjustmentsConfirmed++;
        logger.info(
          `가격 복구 완료 (${ticker}): ${outcome.inserted}행 재저장 · 원천 ${source}` +
            ` · ${describeAdjustments(outcome.adjustments)}`,
        );
      }
    } catch (e: any) {
      failed.push(ticker);
      logger.warn(`가격 복구 실패 (${ticker}): ${e?.message ?? String(e)}`);
    }
    await sleep(REPAIR_REQUEST_DELAY_MS);
  }

  logger.info(
    `가격 복구 요약: 감지 ${tickers.length}개, 해소 ${repaired}개, 복구 불가 ${unfixable.length}개` +
      `, 실패 ${failed.length}개 · 기업행위 확인 ${adjustmentsConfirmed}개, 미확인 ${unverified}개`,
  );
  if (unfixable.length > 0) {
    logger.warn(`가격 복구 불가 종목(원천 파손): ${unfixable.join(', ')}`);
  }

  // 가격을 다시 썼으므로 그 위에서 계산하는 월간 상승률 스냅샷은 낡았다. 거래일이 안 바뀌면
  // 캐시 키도 안 바뀌어 다음 거래일까지 옛 수치를 내보내게 된다.
  invalidateMonthlySnapshot();

  return { detected: tickers.length, repaired, unfixable, failed, adjustmentsConfirmed, unverified };
}

/** 기업행위 확인 결과를 로그 한 줄로 요약한다. "확인 못 함"과 "없음"을 말로 구분한다. */
function describeAdjustments(events: KisAdjustmentEvent[] | null): string {
  if (events == null) return '기업행위 미확인(원주가 대조 불가)';
  if (events.length === 0) return '기업행위 없음 — 감지는 오탐이거나 원천 데이터 오류';
  return `기업행위 ${events
    .map((e) => `${e.date} ${e.factor}배`)
    .join(', ')}`;
}
