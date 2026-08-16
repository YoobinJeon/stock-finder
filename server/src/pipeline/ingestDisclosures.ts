import { getDb, type Db } from '../config/database';
import { logger } from '../utils/logger';
import { sleep } from './http';
import { fetchDisclosures, classifyDisclosure } from './sources/dartDisclosures';
import { fetchDartDocumentText } from './sources/dartDocument';
import {
  parseFundingAmount,
  fundingDelta,
  parseContractRatioPct,
  contractDelta,
  parseOwnershipChange,
  ownershipDelta,
  docRefineKindFromReportNm,
  type DocRefineKind,
} from './disclosureAmounts';
import { syncEarningsSchedules } from './earningsSchedule';
import { syncNewListings } from './newListings';
import { rescoreTickers } from './rescore';

/**
 * DART 공시 수집과 유상증자 금액 재평가, 장중 공시 폴링.
 * (2026-07-26 ingest.ts 분할 — 800줄 규칙. 로직은 그대로 옮겼다.)
 */

const FUNDING_REQUEST_DELAY_MS = 300; // DART document.xml 호출 politeness
const FUNDING_LOOKBACK_DAYS = 60;
const FUNDING_MAX_PER_RUN = 30;

interface FundingEvaluation {
  delta: number;
  label: string;
  amount: number; // 파싱 성공 시 실제 금액, 실패 시 0(재시도 방지 마커)
}

/**
 * 유상증자·CB 공시 원문에서 조달금액을 파싱해 시총 대비 비율로 감점을 정교화한다(정교화).
 * 점수 엔진 관련 변경이므로 보수적으로 동작 — 원문 조회·파싱·시총 조회 중 무엇이든 실패하면
 * 반드시 기존 고정 delta·label을 그대로 반환한다(fail-soft). 이 함수는 절대 throw하지 않는다.
 */
/**
 * 공시 원문을 열어 점수를 정교화한다.
 *
 * 네 종류를 다루며, **어떤 이유로든 실패하면 제목 기준 고정값(fallback)으로 되돌린다** —
 * 원문 미제공·서식 변형·금액 비공개가 실제로 있기 때문이다(예: 국가기관 수주는
 * `계약금액 총액(원) -`으로 내려온다).
 *
 * `amount` 반환값은 "재평가를 마쳤다"는 표식도 겸한다 — 0이면 다음 실행에서 다시 시도하지
 * 않도록 호출측이 마킹한다. 비율만 쓰는 종류(수주·최대주주)는 비율을 정수화해 넣는다.
 */
async function evaluateDocumentEvent(
  db: Db,
  apiKey: string,
  ticker: string,
  rceptNo: string,
  kind: DocRefineKind,
  fallbackDelta: number,
  fallbackLabel: string,
): Promise<FundingEvaluation> {
  const fallback = { delta: fallbackDelta, label: fallbackLabel, amount: 0 };
  try {
    const text = await fetchDartDocumentText(apiKey, rceptNo);
    if (!text) return fallback;

    if (kind === 'contract') {
      const ratioPct = parseContractRatioPct(text);
      if (ratioPct === null) return fallback; // 금액 비공개 — 기존 고정 가점 유지
      return {
        delta: contractDelta(ratioPct),
        label: `${fallbackLabel} (매출액 대비 ${ratioPct.toFixed(1)}%)`,
        amount: Math.round(ratioPct * 100),
      };
    }

    if (kind === 'ownership') {
      const change = parseOwnershipChange(text);
      if (change === null) return fallback;
      const delta = ownershipDelta(change);
      const label =
        delta === 0
          ? `최대주주 지분 ${change.netRatioPct >= 0 ? '증가' : '변동'} (${change.netRatioPct.toFixed(2)}%p)`
          : `최대주주 지분 매각 (${change.netRatioPct.toFixed(2)}%p)`;
      // 증감이 정확히 0이어도 재평가를 마친 건이므로 amount를 1로 마킹해 재시도를 막는다
      return { delta, label, amount: Math.round(Math.abs(change.netRatioPct) * 100) || 1 };
    }

    const amount = parseFundingAmount(text, kind);
    if (amount === null) return fallback;

    const { rows } = await db.query('SELECT market_cap FROM stocks WHERE ticker = $1', [ticker]);
    const marketCap = rows[0]?.market_cap as number | null | undefined;
    const scored = fundingDelta(kind, amount, marketCap);
    if (!scored) return { delta: fallbackDelta, label: fallbackLabel, amount }; // 시총 없음 — 금액은 보존, 점수는 기존 유지

    return {
      delta: scored.delta,
      label: `${fallbackLabel} (시총 대비 ${scored.ratioPct.toFixed(1)}%)`,
      amount,
    };
  } catch (e: any) {
    logger.warn(`공시 원문 평가 실패 (rcept_no=${rceptNo}): ${e?.message}`);
    return fallback;
  }
}

/**
 * 이미 저장된 '정보성' 공시를 **현재 룰로 다시 분류**한다.
 *
 * 공시는 `rcept_no` PK + `ON CONFLICT DO NOTHING`으로 적재되므로, 새 룰을 추가해도 이미
 * 들어와 있던 건은 영영 정보성으로 남는다 — 최대주주 지분 변동 룰을 넣고 나서 피드에
 * 아무것도 안 뜬 이유가 이것이었다. 룰은 앞으로도 계속 늘어나므로 개별 룰마다 마이그레이션을
 * 쓰는 대신 이 단계를 상시로 둔다.
 *
 * 문자열 매칭뿐이라 DART를 호출하지 않는다. 새로 이벤트가 된 건은 이어지는 원문 정교화
 * 단계가 집어간다. 반환: 재분류로 점수가 바뀔 수 있는 종목(재채점 대상).
 */
async function reclassifyStoredDisclosures(db: Db): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT rcept_no, ticker, report_nm FROM disclosure_events
      WHERE event_type IS NULL AND rcept_dt >= NOW() - INTERVAL '${FUNDING_LOOKBACK_DAYS} days'`,
  );

  const affected = new Set<string>();
  for (const r of rows as Array<{ rcept_no: string; ticker: string; report_nm: string }>) {
    const cls = classifyDisclosure(r.report_nm);
    if (!cls) continue;
    await db.query(
      `UPDATE disclosure_events SET event_type = $2, score_delta = $3, detail = $4 WHERE rcept_no = $1`,
      [r.rcept_no, cls.type, cls.delta, cls.label],
    );
    affected.add(r.ticker);
  }
  if (affected.size > 0) {
    logger.info(`공시 재분류: 정보성 ${rows.length}건 중 ${affected.size}개 종목이 이벤트로 승격`);
  }
  return [...affected];
}

interface FundingCandidateRow {
  rcept_no: string;
  ticker: string;
  report_nm: string;
  score_delta: number;
  detail: string | null;
}

/**
 * 최근 60일 disclosure_events 중 유상증자/CB 이벤트이고 amount가 아직 파싱되지 않은(NULL) 건을
 * 재평가해 UPDATE한다 (멱등 — rcept_no PK, 1회 최대 30건). 파싱 실패 건은 amount=0으로 마킹해
 * 다음 실행에서 재시도하지 않는다.
 */
export async function reevaluateFundingAmounts(db: Db, apiKey: string): Promise<{ scanned: number; updated: number }> {
  const { rows } = await db.query(
    `SELECT rcept_no, ticker, report_nm, score_delta, detail
     FROM disclosure_events
     WHERE event_type IN ('penalty', 'bonus') AND amount IS NULL
       AND rcept_dt >= NOW() - INTERVAL '${FUNDING_LOOKBACK_DAYS} days'
     ORDER BY rcept_dt DESC`,
  );

  // bonus까지 훑는 이유: 수주 계약이 가점 이벤트라 penalty만 보면 영원히 재평가되지
  // 않는다. 종류 판정에서 걸러지므로 자사주 취득 같은 다른 가점은 그대로 지나간다.
  const candidates = (rows as FundingCandidateRow[])
    .map((row) => ({ row, kind: docRefineKindFromReportNm(row.report_nm) }))
    .filter((c): c is { row: FundingCandidateRow; kind: DocRefineKind } => c.kind !== null)
    .slice(0, FUNDING_MAX_PER_RUN);

  let updated = 0;
  for (const { row, kind } of candidates) {
    const refined = await evaluateDocumentEvent(db, apiKey, row.ticker, row.rcept_no, kind, row.score_delta, row.detail ?? '');
    await db.query(
      `UPDATE disclosure_events SET score_delta = $2, detail = $3, amount = $4 WHERE rcept_no = $1`,
      [row.rcept_no, refined.delta, refined.label, refined.amount],
    );
    if (refined.amount > 0) updated++;
    await sleep(FUNDING_REQUEST_DELAY_MS);
  }
  logger.info(`유상증자/CB 금액 소급 재평가: ${candidates.length}건 대상, ${updated}건 파싱 성공`);
  return { scanned: candidates.length, updated };
}

/** 연간 재무를 (ticker, fiscal_year) 기준 upsert — 컨센서스 연도 포함 */
/** DART 공시 수집 — 최초 60일 백필, 이후 최근 7일 증분 (rcept_no 중복 무시) */
/** 공시 수집. 반환: 새로 저장된 '이벤트 분류' 공시가 있는 종목 목록 (점수 영향 → 재채점 대상) */
export async function ingestDisclosures(): Promise<string[]> {
  const apiKey = process.env.DART_API_KEY;
  if (!apiKey) {
    logger.info('DART_API_KEY 미설정 — 공시 수집 건너뜀');
    return [];
  }
  const db = getDb();

  const { rows: lastRows } = await db.query('SELECT MAX(rcept_dt) AS last FROM disclosure_events');
  const backfillDays = lastRows[0]?.last ? 7 : 60;
  const bgn = new Date();
  bgn.setDate(bgn.getDate() - backfillDays);
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

  const disclosures = await fetchDisclosures(apiKey, fmt(bgn), fmt(new Date()));

  // 우리 DB에 있는 종목만 저장
  const { rows: tickerRows } = await db.query('SELECT ticker FROM stocks');
  const known = new Set(tickerRows.map((r: any) => r.ticker));

  const affected = new Set<string>();
  let saved = 0;
  for (const d of disclosures) {
    if (!known.has(d.ticker)) continue;
    const cls = classifyDisclosure(d.reportNm);
    const { rows: ins } = await db.query(
      `INSERT INTO disclosure_events (rcept_no, ticker, rcept_dt, report_nm, event_type, score_delta, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (rcept_no) DO NOTHING
       RETURNING rcept_no`,
      [d.rceptNo, d.ticker, d.date, d.reportNm.slice(0, 300), cls?.type ?? null, cls?.delta ?? 0, cls?.label ?? null],
    );
    if (ins.length === 0) continue;
    saved++;
    if (cls) affected.add(d.ticker);

    // 원문을 열어야 점수가 정해지는 공시(유상증자·CB 조달금액, 수주 매출액 대비, 최대주주
    // 지분 순증감)는 여기서 정교화한다. 실패 시 evaluateDocumentEvent가 제목 기준
    // 고정 delta를 그대로 반환(fail-soft).
    const refineKind = cls ? docRefineKindFromReportNm(d.reportNm) : null;
    if (refineKind && cls) {
      const refined = await evaluateDocumentEvent(db, apiKey, d.ticker, d.rceptNo, refineKind, cls.delta, cls.label);
      await db.query(
        `UPDATE disclosure_events SET score_delta = $2, detail = $3, amount = $4 WHERE rcept_no = $1`,
        [d.rceptNo, refined.delta, refined.label, refined.amount],
      );
      await sleep(FUNDING_REQUEST_DELAY_MS);
    }
  }
  logger.info(`공시 수집: ${disclosures.length}건 조회, ${saved}건 신규 저장 (이벤트 종목 ${affected.size}개, ${backfillDays}일 범위)`);

  // 새 룰이 추가됐을 수 있으니 저장된 정보성 공시를 먼저 다시 분류한다.
  // 여기서 이벤트로 승격된 건은 바로 아래 원문 정교화 단계가 이어받는다.
  try {
    for (const t of await reclassifyStoredDisclosures(db)) affected.add(t);
  } catch (e: any) {
    logger.warn(`공시 재분류 실패, 건너뜀: ${e?.message}`);
  }

  // 원문 조회로 점수 정교화 — 실패해도 공시 수집 자체는 성공 처리
  try {
    await reevaluateFundingAmounts(db, apiKey);
  } catch (e: any) {
    logger.warn(`공시 원문 소급 재평가 실패, 건너뜀: ${e?.message}`);
  }

  // 실적 발표·IR 예정일 원문 파싱 — 실패해도 공시 수집 자체는 성공 처리
  try {
    await syncEarningsSchedules(db, apiKey);
  } catch (e: any) {
    logger.warn(`실적 예정일 동기화 실패, 건너뜀: ${e?.message}`);
  }

  // 신규상장 상장일 동기화 — 네이버 요청 2번뿐이라 가벼움, 20분 공시 폴링에 편승
  try {
    await syncNewListings(db);
  } catch (e: any) {
    logger.warn(`신규상장 동기화 실패, 건너뜀: ${e?.message}`);
  }

  return [...affected];
}

/**
 * 장중 공시 폴링 (CRON_DISCLOSURES) — 새 공시 수집 → 영향 종목만 재채점.
 * 수집 잡과 별개로 가볍게 자주 실행.
 */
export async function pollDisclosures(): Promise<void> {
  const affected = await ingestDisclosures();
  if (affected.length === 0) return;
  await rescoreTickers(affected);
}
