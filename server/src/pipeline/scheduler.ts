import cron from 'node-cron';
import { logger } from '../utils/logger';
import { jobRunner } from './JobRunner';
import { runIngest, IngestScope, pollDisclosures } from './ingest';
import { computeMarketRegime } from './marketRegime';
import { snapshotEtfDaily } from './etfSnapshot';
import { snapshotEtfPhases } from './etfPhaseSnapshot';
import { snapshotThemesDaily } from './themeSnapshot';
import { runBootCatchup, pollFlowsWithRetry, catchupRefresh, catchupFlowsGap, refreshScope } from './catchup';

/**
 * 선택적 자동 갱신 스케줄러.
 * - CRON_REFRESH:      전체 데이터 수집 (예: "10 18 * * 1-5" = 평일 18:10). CRON_REFRESH_SCOPE로 범위.
 *                      18:10인 이유는 네이버 투자자별 수급이 저녁에야 확정되기 때문.
 * - CRON_REFRESH_EARLY: 마감 직후 시세·점수 선반영 (예: "50 15 * * 1-5"). scope=prices 고정 —
 *                      수급·재무·공시는 걷지 않고 시세·지표·점수만 갱신한다. 수급은 18:10이 채운다.
 * - CRON_REFRESH_CATCHUP: 전체 수집 누락 점검 (예: "5 19-23 * * 1-5"). 맥이 자서 18:10 슬롯을
 *                      건너뛴 날을 저녁에 주기적으로 확인해 소급 실행한다 (node-cron은 소급 없음).
 * - CRON_REGIME:       시장 색깔만 재계산 (예: "40 8 * * 1-5" = 평일 오전 8:40). 가벼움.
 * - CRON_DISCLOSURES:  공시만 폴링 → 영향 종목 재채점 (예: 평일 8~20시 20분마다). 가벼움.
 * - CRON_FLOWS:        마감 직후 당일 수급만 수집 (예: 평일 15:50). KRX [12010] 기준.
 * - CRON_ETF_SNAPSHOT: ETF 일별 시세 스냅샷 적재 (예: 평일 15:50). 자금유입·RS 계산용.
 *                      차트보드 큐레이션 종목의 국면(state) 이력도 같은 스케줄에 함께 적재.
 * - CRON_THEME_SNAPSHOT: 테마 일별 등락률 스냅샷 적재 (예: 평일 15:50). 로테이션 계산용.
 */
export function startScheduler(): void {
  scheduleRefresh();
  scheduleRefreshEarly();
  scheduleRefreshCatchup();
  scheduleRegime();
  scheduleDisclosures();
  scheduleFlows();
  scheduleEtfSnapshot();
  scheduleThemeSnapshot();

  // 부팅 시 마감 수급·스냅샷 캐치업 — 15:50 크론이 실행될 때 서버가 꺼져 있었으면
  // 그날 수집이 영구 누락되므로 부팅 시점에 점검해 채운다 (fail-soft, 부팅 비차단).
  void runBootCatchup();
}

function scheduleRefresh(): void {
  const expr = process.env.CRON_REFRESH;
  if (!expr) return;
  if (!cron.validate(expr)) {
    logger.warn(`CRON_REFRESH 형식이 잘못되어 비활성화합니다: "${expr}"`);
    return;
  }

  const scope = refreshScope();

  cron.schedule(expr, () => {
    const started = jobRunner.start(scope, (job) => runIngest(scope, job));
    if (started) logger.info(`예약된 데이터 수집 시작 (scope=${scope})`);
    else logger.warn('예약된 수집 건너뜀: 이미 실행 중인 잡이 있음');
  }, { timezone: 'Asia/Seoul' });

  logger.info(`자동 데이터 갱신 스케줄 등록: "${expr}" (scope=${scope}, Asia/Seoul)`);
}

// 마감 직후 선반영 패스는 시세·지표·점수만 — 수급이 확정되는 저녁 수집(CRON_REFRESH)과 역할이 갈린다.
const EARLY_SCOPE: IngestScope = 'prices';

function scheduleRefreshEarly(): void {
  const expr = process.env.CRON_REFRESH_EARLY;
  if (!expr) return;
  if (!cron.validate(expr)) {
    logger.warn(`CRON_REFRESH_EARLY 형식이 잘못되어 비활성화합니다: "${expr}"`);
    return;
  }

  cron.schedule(expr, () => {
    const started = jobRunner.start(EARLY_SCOPE, (job) => runIngest(EARLY_SCOPE, job));
    if (started) logger.info(`마감 직후 시세·점수 수집 시작 (scope=${EARLY_SCOPE})`);
    else logger.warn('마감 직후 수집 건너뜀: 이미 실행 중인 잡이 있음');
  }, { timezone: 'Asia/Seoul' });

  logger.info(`마감 직후 시세·점수 스케줄 등록: "${expr}" (scope=${EARLY_SCOPE}, Asia/Seoul)`);
}

function scheduleRefreshCatchup(): void {
  const expr = process.env.CRON_REFRESH_CATCHUP;
  if (!expr) return;
  if (!cron.validate(expr)) {
    logger.warn(`CRON_REFRESH_CATCHUP 형식이 잘못되어 비활성화합니다: "${expr}"`);
    return;
  }

  cron.schedule(expr, () => {
    void (async () => {
      // 수급 점검을 먼저 — 가볍고, 전체 수집이 시작되면 경합 방지로 건너뛰게 된다.
      try {
        await catchupFlowsGap();
      } catch (e: any) {
        logger.warn(`기본 수급 캐치업 실패: ${e?.message}`);
      }
      try {
        await catchupRefresh();
      } catch (e: any) {
        logger.warn(`전체 수집 캐치업 실패: ${e?.message}`);
      }
    })();
  }, { timezone: 'Asia/Seoul' });

  logger.info(`전체 수집·수급 누락 점검 스케줄 등록: "${expr}" (Asia/Seoul)`);
}

function scheduleRegime(): void {
  const expr = process.env.CRON_REGIME;
  if (!expr) return;
  if (!cron.validate(expr)) {
    logger.warn(`CRON_REGIME 형식이 잘못되어 비활성화합니다: "${expr}"`);
    return;
  }

  cron.schedule(expr, async () => {
    try {
      const d = await computeMarketRegime();
      logger.info(`예약된 시장 색깔 계산 완료 (${d ?? '데이터 없음'})`);
    } catch (e: any) {
      logger.warn(`예약된 시장 색깔 계산 실패: ${e?.message}`);
    }
  }, { timezone: 'Asia/Seoul' });

  logger.info(`시장 색깔 오전 계산 스케줄 등록: "${expr}" (Asia/Seoul)`);
}

function scheduleDisclosures(): void {
  const expr = process.env.CRON_DISCLOSURES;
  if (!expr) return;
  if (!cron.validate(expr)) {
    logger.warn(`CRON_DISCLOSURES 형식이 잘못되어 비활성화합니다: "${expr}"`);
    return;
  }

  cron.schedule(expr, async () => {
    // 전체 수집(runIngest)이 돌고 있으면 스킵 — DART 중복 호출·재채점 경쟁 방지
    if (jobRunner.isRunning()) {
      logger.info('공시 폴링 건너뜀: 전체 수집 진행 중');
      return;
    }
    try {
      await pollDisclosures();
    } catch (e: any) {
      logger.warn(`예약된 공시 폴링 실패: ${e?.message}`);
    }
  }, { timezone: 'Asia/Seoul' });

  logger.info(`공시 폴링 스케줄 등록: "${expr}" (Asia/Seoul)`);
}

function scheduleFlows(): void {
  const expr = process.env.CRON_FLOWS;
  if (!expr) return;
  if (!cron.validate(expr)) {
    logger.warn(`CRON_FLOWS 형식이 잘못되어 비활성화합니다: "${expr}"`);
    return;
  }

  cron.schedule(expr, () => {
    if (jobRunner.isRunning()) {
      logger.info('마감 수급 수집 건너뜀: 전체 수집 진행 중');
      return;
    }
    // 오늘 KST 거래일 (평일만) — pollTodayFlows와 동일한 판정, KRX 미발표에 대비해
    // 단발 호출 대신 재시도 체인(pollFlowsWithRetry)에 위임한다.
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const dow = kst.getUTCDay();
    if (dow < 1 || dow > 5) return;
    const iso = kst.toISOString().slice(0, 10);

    logger.info('예약된 마감 수급 수집 시작');
    pollFlowsWithRetry(iso);
  }, { timezone: 'Asia/Seoul' });

  logger.info(`마감 수급 수집 스케줄 등록: "${expr}" (Asia/Seoul)`);
}

function scheduleEtfSnapshot(): void {
  const expr = process.env.CRON_ETF_SNAPSHOT;
  if (!expr) return;
  if (!cron.validate(expr)) {
    logger.warn(`CRON_ETF_SNAPSHOT 형식이 잘못되어 비활성화합니다: "${expr}"`);
    return;
  }

  cron.schedule(expr, async () => {
    if (jobRunner.isRunning()) {
      logger.info('ETF 스냅샷 건너뜀: 전체 수집 진행 중');
      return;
    }
    try {
      const count = await snapshotEtfDaily();
      logger.info(`예약된 ETF 스냅샷 저장 완료 (${count}건)`);
    } catch (e: any) {
      logger.warn(`예약된 ETF 스냅샷 저장 실패: ${e?.message}`);
    }
    try {
      const phaseCount = await snapshotEtfPhases();
      logger.info(`예약된 ETF 국면 이력 저장 완료 (${phaseCount}건)`);
    } catch (e: any) {
      logger.warn(`예약된 ETF 국면 이력 저장 실패: ${e?.message}`);
    }
  }, { timezone: 'Asia/Seoul' });

  logger.info(`ETF 스냅샷 저장 스케줄 등록: "${expr}" (Asia/Seoul)`);
}

function scheduleThemeSnapshot(): void {
  const expr = process.env.CRON_THEME_SNAPSHOT;
  if (!expr) return;
  if (!cron.validate(expr)) {
    logger.warn(`CRON_THEME_SNAPSHOT 형식이 잘못되어 비활성화합니다: "${expr}"`);
    return;
  }

  cron.schedule(expr, async () => {
    if (jobRunner.isRunning()) {
      logger.info('테마 스냅샷 건너뜀: 전체 수집 진행 중');
      return;
    }
    try {
      const count = await snapshotThemesDaily();
      logger.info(`예약된 테마 스냅샷 저장 완료 (${count}건)`);
    } catch (e: any) {
      logger.warn(`예약된 테마 스냅샷 저장 실패: ${e?.message}`);
    }
  }, { timezone: 'Asia/Seoul' });

  logger.info(`테마 스냅샷 저장 스케줄 등록: "${expr}" (Asia/Seoul)`);
}
