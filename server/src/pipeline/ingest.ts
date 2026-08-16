import { getDb, type Db } from '../config/database';
import { compositeScorer } from '../scoring/CompositeScorer';
import { logger } from '../utils/logger';
import { sleep, num, kstToday } from './http';
import { JobRunner } from './JobRunner';
import { fetchFinancials } from './sources/naverFinancials';
import { fetchConsensus, fetchQuarterlyConsensus } from './sources/naverConsensus';
import { mergeConsensusEstimates } from './financialsMerge';
import { fetchInvestorFlows } from './sources/naverInvestorFlows';
import { buildSectorMap } from './sources/naverSectors';
import { fetchStockList } from './sources/naverStockList';
import { fetchYahooChart } from './sources/yahooPrices';
import { fetchKisDailyPrices } from './sources/kisDailyPrice';
import { fetchDisclosures, classifyDisclosure } from './sources/dartDisclosures';
import { fetchDartDocumentText } from './sources/dartDocument';
import { parseFundingAmount, fundingDelta, fundingKindFromReportNm, type FundingKind } from './disclosureAmounts';
import { syncEarningsSchedules, reparseEarningsSchedules } from './earningsSchedule';
import { syncNewListings } from './newListings';
import { krxConfigured, fetchDetailFlowsForDate } from './sources/krxInvestorFlows';
import { computeMarketRegime } from './marketRegime';
import { runPriceRepair } from './priceRepair';
import { calcTrendMa } from './trendIndicators';
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
import { calcMACD, calcBollinger, calcATR, calcOBV, calcTurnoverSurge } from './technicalIndicators';
import { calcFscore, type FinYear } from './fscore';
import { isVolumeSurgeHigh, isInstNewAccum, isRsTopEntry } from './signalDetection';
import { decideDelistings, DELIST_MAX_PER_RUN } from './delisting';
import { decideSurprises, type QuarterRow, type SurpriseRecord } from './earningsSurprise';
import { recomputeEarningsTrends } from './earningsTrendStore';
import { backfillDartQuarterly } from './ingestDartQuarterly';

import { CONCURRENCY, BATCH_DELAY_MS, SCORE_BATCH } from './ingestConfig';
import { updateRsPercentiles } from './ingestRs';
import { ingestPrices } from './ingestPrices';
import { ingestFinancials } from './ingestFinancials';
import { ingestFlows, ingestKrxDetailFlows } from './ingestFlows';
import { computeIndicators } from './ingestIndicators';
import { ingestDisclosures } from './ingestDisclosures';

export { krxConfigured }; // catchup.ts의 재시도 체인이 KRX 설정 여부를 확인할 때 재사용

// 분할 전 `ingest.ts`가 직접 내보내던 진입점들 — 소비처(scheduler·catchup·data.routes)의
// import 경로를 그대로 두기 위해 여기서 다시 내보낸다. (2026-07-26 분할)
export { pollTodayFlows, pollFlowsForDate, backfillRecentFlowQty } from './ingestFlows';
export { pollDisclosures } from './ingestDisclosures';

export type IngestScope =
  | 'top200' | 'kospi' | 'all' | 'financials' | 'prices' | 'disclosures' | 'rescore'
  | 'earnings-trend' | 'quarterly-backfill' | 'schedule-reparse';
export const INGEST_SCOPES: IngestScope[] = [
  'top200', 'kospi', 'all', 'financials', 'prices', 'disclosures', 'rescore',
  'earnings-trend', 'quarterly-backfill', 'schedule-reparse',
];

/** 시세를 실제로 새로 쌓는 스코프 — 가격 재정합의 실행 조건. */
const PRICE_REFRESH_SCOPES: ReadonlySet<IngestScope> = new Set<IngestScope>([
  'top200', 'kospi', 'all', 'prices',
]);

/** 이 스코프가 시세를 새로 쌓는가. */
export function refreshesPrices(scope: IngestScope): boolean {
  return PRICE_REFRESH_SCOPES.has(scope);
}


interface TargetStock {
  ticker: string;
  market: string;
}

/**
 * 수집 오케스트레이션.
 * - top200/kospi/all: 종목 목록 → 업종 → 재무+시세 → 공시 → 점수
 * - financials:       (DB 보유 종목 대상) 재무만 재수집 → 점수
 * - prices:           (DB 보유 종목 대상) 시세만 재수집 → 지표·점수. 재무·수급·공시는 건너뛴다 —
 * 장 마감 직후(15:50) 시세·차트·점수를 먼저 보기 위한 경로. 네이버
 *                     투자자별 수급은 저녁에야 확정되므로 여기서 걷지 않고 18:10 전체 수집에 맡긴다.
 * - disclosures:      DART 공시만 수집 → 점수 재계산 (빠름)
 * - rescore:          점수만 재계산 (수집 없음 — 기준 변경 시)
 */
export async function runIngest(scope: IngestScope, job: JobRunner): Promise<void> {
  const db = getDb();
  const { rows: runRows } = await db.query(
    `INSERT INTO ingest_runs (scope, status) VALUES ($1, 'running') RETURNING id`,
    [scope],
  );
  const runId = runRows[0].id;

  try {
    // earnings-trend: 저장된 분기 재무만으로 실적 개선을 다시 판정한다. 네트워크·점수 계산이
    // 없어 수십 초면 끝나므로, 판정 규칙(earningsTrend.ts)을 고친 뒤 전체 수집 없이 소급할 때 쓴다.
    if (scope === 'earnings-trend') {
      job.setPhase('실적 개선 판정');
      const tally = await recomputeEarningsTrends(db);
      await db.query(
        `UPDATE ingest_runs SET status = 'done', total = $2, done = $2, finished_at = NOW()
         WHERE id = $1`,
        [runId, tally.computed],
      );
      return;
    }

    // schedule-reparse: 이미 적재된 IR·실적 예정일을 원문에서 다시 파싱한다. 시간 파싱 규칙을
    // 고친 뒤 소급 적용하는 경로 — sync는 ON CONFLICT DO NOTHING이라 기존 행을 고치지 못한다.
    if (scope === 'schedule-reparse') {
      const apiKey = process.env.DART_API_KEY;
      if (!apiKey) throw new Error('DART_API_KEY가 설정되지 않았습니다.');

      // 대상 건수는 조회 후에야 알 수 있어 첫 진행 콜백에서 총량을 세팅한다(setPhase가 done을 0으로 되돌림).
      job.setPhase('예정일 재파싱');
      let totalSet = false;
      const tally = await reparseEarningsSchedules(db, apiKey, (_done, total) => {
        if (!totalSet) {
          job.setPhase('예정일 재파싱', total);
          totalSet = true;
        }
        job.tick();
      });
      await db.query(
        `UPDATE ingest_runs SET status = 'done', total = $2, done = $2, finished_at = NOW()
         WHERE id = $1`,
        [runId, tally.scanned],
      );
      job.setPhase(`완료 — ${tally.scanned}건 재파싱, ${tally.updated}건 갱신`);
      return;
    }

    // quarterly-backfill: DART로 분기 실적 이력을 BACKFILL_YEARS년치 채운 뒤 다시 판정한다.
    // 시세·점수는 건드리지 않는다 — 이력이 늘어나면 연속 개선 분기 수만 달라진다.
    if (scope === 'quarterly-backfill') {
      const backfill = await backfillDartQuarterly(db, job);
      job.setPhase('실적 개선 판정');
      const trend = await recomputeEarningsTrends(db);
      await db.query(
        `UPDATE ingest_runs SET status = 'done', total = $2, done = $2, finished_at = NOW()
         WHERE id = $1`,
        [runId, backfill.inserted],
      );
      // setPhase가 진행률을 0으로 되돌리므로 최종 수치를 단계 이름에 남긴다 —
      // 그러지 않으면 상태 폴링에 total=0으로 보여 "아무것도 안 됨"처럼 읽힌다.
      job.setPhase(
        `완료 — 분기 ${backfill.inserted}행 백필, ${trend.computed}종목 재판정`,
      );
      logger.info(`분기 이력 백필 후 재판정: ${trend.computed}개 종목`);
      return;
    }

    let targets: TargetStock[] = [];
    let deactivatedCount = 0;

    if (scope === 'top200' || scope === 'kospi' || scope === 'all') {
      // 1) 종목 목록
      job.setPhase('종목 목록 수집');
      const listed = await fetchStockList(scope);
      if (listed.length === 0) throw new Error('종목 목록을 가져오지 못했습니다 (네이버 API 응답 없음)');

      // 상장폐지 자동 감지를 위해 upsert 전 현재 활성 종목 목록을 확보해둔다 — upsert가
      // 재등장 종목을 is_active=TRUE로 되돌리므로(아래 ON CONFLICT), upsert 이후에는 "목록에서
      // 빠진" 종목을 알아낼 수 없다.
      const { rows: activeBeforeRows } = await db.query(
        'SELECT ticker, name FROM stocks WHERE is_active = TRUE',
      );

      for (const s of listed) {
        await db.query(
          `INSERT INTO stocks (ticker, name, market, market_cap)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (ticker) DO UPDATE
             SET name = EXCLUDED.name, market = EXCLUDED.market,
                 market_cap = EXCLUDED.market_cap, is_active = TRUE, updated_at = NOW()`,
          [s.ticker, s.name, s.market, s.marketCap],
        );
      }
      logger.info(`종목 목록 갱신: ${listed.length}개 (scope=${scope})`);
      targets = listed;

      // 1.5) 상장폐지 자동 감지 — scope=all에서만, 안전 가드(급감/상한) 통과 시에만 비활성화.
      const delisting = decideDelistings(
        scope,
        activeBeforeRows.map((r: any) => r.ticker as string),
        listed.map((s) => s.ticker),
      );
      if (delisting.skipReason === 'fetch_count_drop') {
        logger.warn(
          `종목 목록 급감 — 상폐 처리 건너뜀 (활성 ${activeBeforeRows.length}개 대비 수집 ${listed.length}개)`,
        );
      } else if (delisting.skipReason === 'cap_exceeded') {
        logger.warn(`상폐 후보가 1회 상한(${DELIST_MAX_PER_RUN}건)을 초과 — 상폐 처리 건너뜀`);
      } else if (delisting.toDeactivate.length > 0) {
        await db.query(
          'UPDATE stocks SET is_active = FALSE, updated_at = NOW() WHERE ticker = ANY($1)',
          [delisting.toDeactivate],
        );
        const nameByTicker = new Map(activeBeforeRows.map((r: any) => [r.ticker, r.name]));
        const detail = delisting.toDeactivate
          .map((t) => `${t}(${nameByTicker.get(t) ?? '?'})`)
          .join(', ');
        deactivatedCount = delisting.toDeactivate.length;
        logger.info(`상장폐지 감지 — ${deactivatedCount}개 종목 비활성화: ${detail}`);
      }

      // 2) 업종(섹터) — 실패해도 계속 진행
      job.setPhase('업종 정보 수집');
      try {
        const sectorMap = await buildSectorMap();
        for (const [ticker, sector] of sectorMap) {
          await db.query('UPDATE stocks SET sector = $2 WHERE ticker = $1', [ticker, sector]);
        }
        logger.info(`업종 매핑: ${sectorMap.size}개`);
      } catch (e: any) {
        logger.warn(`업종 수집 실패, 건너뜀: ${e?.message}`);
      }
    } else if (scope === 'financials' || scope === 'prices') {
      const { rows } = await db.query(
        'SELECT ticker, market FROM stocks WHERE is_active = TRUE',
      );
      targets = rows;
    }

    // 3) 재무·시세 — 스코프별로 걷는 대상이 다르다.
    //    financials: 재무만 / prices: 시세만 / 전체 수집: 재무+시세+수급.
    // 수급(ingestFlows, 네이버 투자자별)은 저녁에 확정되므로 prices 패스에서 제외한다
    //    15:50에 걷으면 미확정치가 들어가 점수·시그널이 잘못된 수급으로 매겨진다.
    const withFinancials = scope !== 'rescore' && scope !== 'prices';
    const withPrices = scope !== 'rescore' && scope !== 'financials';
    const withFlows = withPrices && scope !== 'prices';

    if (withFinancials || withPrices) {
      const phaseLabel = withFinancials && withPrices ? '재무·시세 수집'
        : withFinancials ? '재무 수집' : '시세 수집';
      job.setPhase(phaseLabel, targets.length);
      // 어닝 서프라이즈 실행 단위 집계 — 0건이어도 "배선이 살아 있다"는 신호를 남긴다.
      let surpriseRecorded = 0;
      let surpriseFailedTickers = 0;
      for (let i = 0; i < targets.length; i += CONCURRENCY) {
        const batch = targets.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (s) => {
            let ok = true;
            if (withFinancials) {
              try {
                const tally = await ingestFinancials(s.ticker);
                surpriseRecorded += tally.recorded;
                if (tally.failed > 0) surpriseFailedTickers += 1;
              } catch {
                ok = false;
              }
            }
            if (withPrices) {
              try {
                await ingestPrices(s.ticker, s.market);
              } catch {
                ok = false;
              }
            }
            if (withFlows) {
              try {
                await ingestFlows(s.ticker);
              } catch {
                ok = false;
              }
            }
            job.tick(ok ? undefined : s.ticker);
          }),
        );
        await sleep(BATCH_DELAY_MS);
      }
      if (withFinancials) {
        logger.info(
          `어닝 서프라이즈 포착 — ${surpriseRecorded}건 기록, 기록 실패 ${surpriseFailedTickers}개 종목 ` +
          `(대상 ${targets.length}개, scope=${scope})`,
        );
      }
    }

    // 3.1) 가격 재정합 — 기업 액션(감자·액면병합·분할) 미보정 종목만 수정주가 재수집.
    // 시세를 실제로 새로 쌓는 스코프(top200/kospi/all/prices)에서만 실행 — financials/disclosures/
    // rescore는 시세를 새로 수집하지 않으므로 대상이 아님. 실패해도 수집 자체는 계속 진행(fail-soft).
    if (refreshesPrices(scope)) {
      job.setPhase('가격 재정합 (기업 액션)');
      try {
        const repair = await runPriceRepair();
        logger.info(
          `가격 재정합 완료: 감지 ${repair.detected}개, 복구 ${repair.repaired}개, 실패 ${repair.failed.length}개`,
        );
      } catch (e: any) {
        logger.warn(`가격 재정합 실패, 건너뜀: ${e?.message}`);
      }
    }

    // 3.5) DART 공시 수집 (키 없으면 건너뜀 — rescore·prices 제외 모든 스코프).
    // prices는 20분 공시 폴링 크론과 18:10 전체 수집이 이미 덮으므로 중복 수집하지 않는다.
    if (scope !== 'rescore' && scope !== 'prices') {
      job.setPhase('공시 수집 (DART)');
      try {
        await ingestDisclosures();
      } catch (e: any) {
        logger.warn(`공시 수집 실패, 건너뜀: ${e?.message}`);
      }
    }

    // 3.6) KRX 세부 투자자 수급 (연기금·투신·사모 등 — 로그인 필요, 없으면 건너뜀).
    // prices는 수급을 다루지 않는다 — 15:50엔 KRX가 당일치를 아직 안 올리는 날이 많다(catchup.ts 재시도 체인).
    if (scope !== 'rescore' && scope !== 'prices') {
      job.setPhase('세부 수급 수집 (KRX)');
      try {
        await ingestKrxDetailFlows();
      } catch (e: any) {
        logger.warn(`KRX 세부 수급 수집 실패, 건너뜀: ${e?.message}`);
      }
    }

    // 4) 기술지표·수급 집계 (저장된 시세/수급 기반 — rescore 포함 모든 스코프에서 재계산)
    const { rows: allActive } = await db.query(
      'SELECT ticker FROM stocks WHERE is_active = TRUE',
    );
    job.setPhase('지표 계산', allActive.length);
    for (let i = 0; i < allActive.length; i += SCORE_BATCH) {
      const batch = allActive.slice(i, i + SCORE_BATCH);
      await Promise.all(
        batch.map(async (s: any) => {
          try {
            await computeIndicators(s.ticker);
          } catch {
            /* 지표 실패는 개별 종목만 건너뜀 */
          } finally {
            job.tick();
          }
        }),
      );
    }

    // 4.5) RS 백분위 — 통합 RS(1M40%/3M30%/6M20%/12M10% 기간별 백분위 가중평균, rsRanking.ts 순수
    // 함수 재사용 — DRY, RS 랭킹 페이지와 산식 통일). 갱신 전 현재값을 rs_percentile_prev로 보존한다.
    // RS 랭킹 페이지(/rs)의 시총 필터·거래정지(isRankable)·가격불연속 가드는 그 페이지 고유 정책이라
    // 여기서는 적용하지 않는다 — 스크리너 저장값은 계산 가능한 전 종목에 부여해 커버리지를 유지한다.
    await updateRsPercentiles(db, job);

    // 4.6) 분기 실적 개선 판정 (저장된 분기 재무 기반 — rescore 포함 모든 스코프에서 재계산).
    // 실패해도 점수 계산까지 막지 않는다(fail-soft) — 스크리너의 부가 필터라 없으면 그 조건만
    // 결과가 비고, 다음 실행이나 earnings-trend 스코프로 복구된다.
    job.setPhase('실적 개선 판정');
    try {
      await recomputeEarningsTrends(db);
    } catch (e: any) {
      logger.warn(`실적 개선 판정 실패, 건너뜀: ${e?.message}`);
    }

    // 5) 점수 계산 (DB의 활성 종목 전체 대상 — market_cap 포함해 규모 보정 반영)
    const { rows: stocks } = await db.query(
      'SELECT ticker, name, market, sector, market_cap FROM stocks WHERE is_active = TRUE',
    );
    // 점수 이력 기준일 = 현재 보유한 최신 거래일
    const { rows: asOfRows } = await db.query(
      `SELECT to_char(MAX(trade_date), 'YYYY-MM-DD') AS d FROM stock_prices`,
    );
    const asOf: string | null = asOfRows[0]?.d ?? null;

    job.setPhase('점수 계산', stocks.length);
    for (let i = 0; i < stocks.length; i += SCORE_BATCH) {
      const batch = stocks.slice(i, i + SCORE_BATCH);
      await Promise.all(
        batch.map(async (stock: any) => {
          const result = await compositeScorer.score(stock, {});
          await db.query(
            `INSERT INTO stock_scores (ticker, total_score, breakdown, scored_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (ticker) DO UPDATE
               SET total_score = EXCLUDED.total_score,
                   breakdown = EXCLUDED.breakdown, scored_at = NOW()`,
            [stock.ticker, result.total, JSON.stringify(result.breakdown)],
          );

          // 점수 이력 스냅샷 (기록 기반 백테스트·추이 분석용)
          if (asOf) {
            const factors: Record<string, number> = {};
            for (const b of result.breakdown) {
              if (b.category === 'adjustment') continue;
              factors[b.category] = b.score;
            }
            await db.query(
              `INSERT INTO score_history (as_of, ticker, total_score, factors)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (as_of, ticker) DO UPDATE
                 SET total_score = EXCLUDED.total_score, factors = EXCLUDED.factors`,
              [asOf, stock.ticker, result.total, JSON.stringify(factors)],
            );
          }
          job.tick();
        }),
      );
    }

    const s = job.getStatus();

    await db.query(
      `UPDATE ingest_runs
       SET status = 'done', total = $2, done = $3, failed = $4, deactivated = $5, finished_at = NOW()
       WHERE id = $1`,
      [runId, s.total, s.done, JSON.stringify(s.failed), deactivatedCount],
    );

    // 5.5) 시장 색깔 계산 (수집한 지수·수급 데이터 기반)
    try {
      await computeMarketRegime();
    } catch (e: any) {
      logger.warn(`시장 색깔 계산 실패, 건너뜀: ${e?.message}`);
    }
  } catch (err: any) {
    await db
      .query(
        `UPDATE ingest_runs SET status = 'error', error = $2, finished_at = NOW() WHERE id = $1`,
        [runId, err?.message ?? String(err)],
      )
      .catch(() => {});
    throw err;
  }
}

