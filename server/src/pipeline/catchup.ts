import { getDb } from '../config/database';
import { logger } from '../utils/logger';
import { jobRunner } from './JobRunner';
import { pollFlowsForDate, krxConfigured, runIngest, INGEST_SCOPES, type IngestScope } from './ingest';
import { snapshotEtfDaily } from './etfSnapshot';
import { snapshotEtfPhases } from './etfPhaseSnapshot';
import { snapshotThemesDaily } from './themeSnapshot';

const COLLECT_MINS = 15 * 60 + 50; // 마감 수집 크론(15:50 KST)과 동일 기준

const FLOWS_RETRY_DELAY_MS = 30 * 60 * 1000; // KRX 미발표 시 30분 간격 재시도
const FLOWS_RETRY_MAX = 6;                   // 15:50 발화 기준 최대 ~18:50까지

/** 지금 시점에 마감 수집이 이미 끝났어야 하는 가장 최근 거래일(KST, YYYY-MM-DD).
 *  평일 15:50 이후면 오늘, 그 외엔 직전 평일. (공휴일은 KRX 미발표 → pollFlowsForDate가 no-op) */
export function expectedFlowsDate(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const pastCollect = kst.getUTCHours() * 60 + kst.getUTCMinutes() >= COLLECT_MINS;
  const d = new Date(kst);
  if (!(d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && pastCollect)) {
    do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  }
  return d.toISOString().slice(0, 10);
}

/** 오늘 KST 날짜(YYYY-MM-DD) — ETF/테마 스냅샷은 당일치만 백필 대상이므로 별도 판정 필요. */
function todayKst(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * 지정 날짜 수급 수집을 KRX 발표까지 재시도 (30분 간격, 최대 6회; fail-soft).
 * 15:50 마감 크론이 발화해도 KRX [12010]이 아직 당일치를 게시하지 않은 경우가 있어,
 * 단발성 수집으로는 그날 수급이 영구 누락된다 — 발표될 때까지 최대 ~18:50까지 재시도.
 */
export function pollFlowsWithRetry(iso: string, attempt = 0): void {
  if (!krxConfigured()) {
    logger.info('KRX 미설정 — 마감 수급 재시도 없이 종료');
    return;
  }

  void (async () => {
    if (jobRunner.isRunning()) {
      logger.info('마감 수급 재시도 건너뜀: 전체 수집 진행 중');
      if (attempt >= FLOWS_RETRY_MAX) {
        logger.warn(`수급 재시도 소진 (${iso}) — 전체 수집과 계속 겹침`);
        return;
      }
      setTimeout(() => pollFlowsWithRetry(iso, attempt + 1), FLOWS_RETRY_DELAY_MS).unref();
      return;
    }

    try {
      const d = await pollFlowsForDate(iso);
      if (d) {
        logger.info(`마감 수급 수집 완료 (${d})`);
        return;
      }
    } catch (e: any) {
      logger.warn(`마감 수급 재시도 실패: ${e?.message}`);
    }

    if (attempt >= FLOWS_RETRY_MAX) {
      logger.warn(`KRX 미발표로 수급 재시도 소진 (${iso})`);
      return;
    }
    logger.info(`KRX 미발표 — 30분 후 재시도 (${attempt + 1}/${FLOWS_RETRY_MAX})`);
    setTimeout(() => pollFlowsWithRetry(iso, attempt + 1), FLOWS_RETRY_DELAY_MS).unref();
  })();
}

/**
 * 기본 수급(`stock_flows`) 누락 캐치업.
 *
 * `catchupRefresh`는 "오늘 전체 수집이 돌았는가"만 본다. 그래서 18:10 수집은 성공했는데 그 시점에
 * KRX·네이버가 당일 수급을 아직 확정하지 않은 날은 **수급만 통째로 비고 아무도 소급하지 않는다** —
 * 15:50 재시도 체인도 18:50이면 소진된다. 실제로 2026-08-10에 세부 수급(KRX)만 당일치가 있고
 * 기본 수급(외인·기관·개인)은 3거래일 전에 멈춰 있었다.
 *
 * 그래서 잡 실행 이력이 아니라 **데이터 존재 여부**로 판정한다. 19~23시 캐치업 크론이 매시 점검하므로
 * 늦게 확정되는 날도 그날 안에 채워진다.
 */
export async function catchupFlowsGap(now: Date = new Date()): Promise<boolean> {
  if (!process.env.CRON_FLOWS) return false;
  if (jobRunner.isRunning()) return false; // 전체 수집과 stock_flows 경합 방지

  const target = expectedFlowsDate(now);
  const { rows } = await getDb().query(
    'SELECT 1 FROM stock_flows WHERE trade_date = $1 LIMIT 1',
    [target],
  );
  if (rows.length > 0) return false;

  logger.warn(`기본 수급 누락 감지 — 캐치업 실행 (${target})`);
  const d = await pollFlowsForDate(target);
  if (!d) logger.warn(`기본 수급 캐치업 실패 (${target}) — 소스가 아직 당일치를 주지 않음`);
  return d !== null;
}

const REFRESH_DEFAULT_SCOPE: IngestScope = 'top200';

/** CRON_REFRESH_SCOPE 해석 — 미설정·미지원 값이면 기본 스코프. 스케줄러와 캐치업이 공유한다(DRY). */
export function refreshScope(): IngestScope {
  const raw = process.env.CRON_REFRESH_SCOPE ?? REFRESH_DEFAULT_SCOPE;
  return INGEST_SCOPES.includes(raw as IngestScope) ? (raw as IngestScope) : REFRESH_DEFAULT_SCOPE;
}

/**
 * 'M H * * ...' 크론식에서 예정 시각을 분 단위로 뽑는다 — 분·시가 고정 숫자가 아니면
 * (와일드카드·스텝·범위 표기) 누락 판정 기준을 세울 수 없으므로 null.
 */
export function cronTimeMinutes(expr: string): number | null {
  const [min, hour] = expr.trim().split(/\s+/);
  if (!/^\d{1,2}$/.test(min ?? '') || !/^\d{1,2}$/.test(hour ?? '')) return null;
  const h = Number(hour);
  const m = Number(min);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * 전체 수집(CRON_REFRESH) 누락 캐치업.
 * node-cron은 인프로세스 타이머라 예정 시각에 맥이 자고 있으면 그 슬롯을 건너뛰고 **소급 실행하지
 * 않는다** — 2026-08-03에 18:10 수집이 통째로 누락돼 하루 묵은 데이터가 화면에 남았다.
 * "평일 · 예정 시각은 지남 · 오늘 그 스코프 수집 이력 없음"이면 지금 돌린다.
 * 공휴일에도 한 번은 돌지만 그 실행이 ingest_runs에 행을 남기므로 이후 점검은 건너뛴다(1일 1회 보장).
 */
export async function catchupRefresh(now: Date = new Date()): Promise<boolean> {
  const expr = process.env.CRON_REFRESH;
  if (!expr) return false;

  const dueMins = cronTimeMinutes(expr);
  if (dueMins === null) {
    logger.warn(`CRON_REFRESH가 고정 시각이 아니라 누락 캐치업을 건너뜁니다: "${expr}"`);
    return false;
  }

  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const dow = kst.getUTCDay();
  if (dow === 0 || dow === 6) return false; // 주말은 수집 대상이 아님
  if (kst.getUTCHours() * 60 + kst.getUTCMinutes() < dueMins) return false; // 아직 예정 시각 전
  if (jobRunner.isRunning()) return false;

  const scope = refreshScope();
  const today = todayKst(now);
  // started_at은 UTC 저장 — 오늘(KST) 00:00에 해당하는 UTC 시각으로 비교한다.
  const cutoffUtc = new Date(Date.parse(`${today}T00:00:00Z`) - 9 * 3600 * 1000).toISOString();
  const { rows } = await getDb().query(
    'SELECT 1 FROM ingest_runs WHERE scope = $1 AND started_at >= $2 LIMIT 1',
    [scope, cutoffUtc],
  );
  if (rows.length > 0) return false; // 오늘 이미 돌았음

  const started = jobRunner.start(scope, (job) => runIngest(scope, job));
  if (started) logger.warn(`전체 수집 누락 감지 — 캐치업 실행 (scope=${scope}, 예정 "${expr}", ${today})`);
  return started;
}

/**
 * 서버 부팅 시 마감 수급·스냅샷 캐치업 — 15:50 크론이 실행될 때 서버가 꺼져 있었으면
 * 그날 수집이 영구 누락되므로, 부팅 시점에 "이미 끝났어야 할" 수집을 점검해 채운다.
 * 절대 부팅을 막지 않도록 전체를 try/catch로 감싸고, 각 블록도 개별 fail-soft.
 */
export async function runBootCatchup(): Promise<void> {
  try {
    if (jobRunner.isRunning()) {
      logger.info('부팅 캐치업 건너뜀: 이미 실행 중인 잡이 있음');
      return;
    }

    const now = new Date();

    if (process.env.CRON_FLOWS) {
      await catchupFlows(now);
    }

    const sameDayTarget = expectedFlowsDate(now) === todayKst(now);

    if (process.env.CRON_ETF_SNAPSHOT && sameDayTarget) {
      await catchupEtfSnapshot(now);
    }

    if (process.env.CRON_THEME_SNAPSHOT && sameDayTarget) {
      await catchupThemeSnapshot(now);
    }

    // 세부(KRX)는 있는데 기본(외인·기관·개인)만 빈 날을 잡는다 — catchupFlows는 stock_flows_krx만
    // 보므로 그 조합을 "이미 수집됨"으로 넘긴다.
    try {
      await catchupFlowsGap(now);
    } catch (e: any) {
      logger.warn(`기본 수급 부팅 캐치업 실패: ${e?.message}`);
    }

    // 전체 수집 캐치업은 마지막에 — 오래 걸리는 잡이라 앞의 가벼운 캐치업을 막지 않도록 한다.
    try {
      await catchupRefresh(now);
    } catch (e: any) {
      logger.warn(`전체 수집 부팅 캐치업 실패: ${e?.message}`);
    }
  } catch (e: any) {
    logger.warn(`부팅 캐치업 실패: ${e?.message}`);
  }
}

async function catchupFlows(now: Date): Promise<void> {
  try {
    const target = expectedFlowsDate(now);
    const db = getDb();
    const { rows } = await db.query(
      'SELECT 1 FROM stock_flows_krx WHERE trade_date = $1 LIMIT 1',
      [target],
    );
    if (rows.length === 0) {
      logger.info(`수급 부팅 캐치업 실행 (${target})`);
      if (target === todayKst(now)) {
        // 오늘치는 KRX가 아직 미발표일 수 있으므로 발표될 때까지 재시도 체인으로 넘긴다.
        pollFlowsWithRetry(target);
      } else {
        // 과거 날짜는 KRX가 이미 발표했거나 영영 발표하지 않을 데이터 — 단발 시도로 충분.
        await pollFlowsForDate(target);
      }
    } else {
      logger.info(`수급 부팅 캐치업 불필요 (${target}) — 이미 수집됨`);
    }
  } catch (e: any) {
    logger.warn(`수급 부팅 캐치업 실패: ${e?.message}`);
  }
}

async function catchupEtfSnapshot(now: Date): Promise<void> {
  try {
    const today = todayKst(now);
    const db = getDb();
    const { rows } = await db.query(
      'SELECT 1 FROM etf_daily_snapshots WHERE snap_date = $1 LIMIT 1',
      [today],
    );
    if (rows.length === 0) {
      logger.info(`ETF 스냅샷 부팅 캐치업 실행 (${today})`);
      const count = await snapshotEtfDaily();
      logger.info(`ETF 스냅샷 부팅 캐치업 완료 (${count}건)`);
      const phaseCount = await snapshotEtfPhases();
      logger.info(`ETF 국면 이력 부팅 캐치업 완료 (${phaseCount}건)`);
    } else {
      logger.info(`ETF 스냅샷 부팅 캐치업 불필요 (${today}) — 이미 수집됨`);
    }
  } catch (e: any) {
    logger.warn(`ETF 스냅샷 부팅 캐치업 실패: ${e?.message}`);
  }
}

async function catchupThemeSnapshot(now: Date): Promise<void> {
  try {
    const today = todayKst(now);
    const db = getDb();
    const { rows } = await db.query(
      'SELECT 1 FROM theme_daily_snapshots WHERE snap_date = $1 LIMIT 1',
      [today],
    );
    if (rows.length === 0) {
      logger.info(`테마 스냅샷 부팅 캐치업 실행 (${today})`);
      const count = await snapshotThemesDaily();
      logger.info(`테마 스냅샷 부팅 캐치업 완료 (${count}건)`);
    } else {
      logger.info(`테마 스냅샷 부팅 캐치업 불필요 (${today}) — 이미 수집됨`);
    }
  } catch (e: any) {
    logger.warn(`테마 스냅샷 부팅 캐치업 실패: ${e?.message}`);
  }
}
