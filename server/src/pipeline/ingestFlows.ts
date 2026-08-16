import { getDb, type Db } from '../config/database';
import { logger } from '../utils/logger';
import { sleep } from './http';
import { fetchInvestorFlows } from './sources/naverInvestorFlows';
import { krxConfigured, fetchDetailFlowsForDate } from './sources/krxInvestorFlows';
import { CONCURRENCY, BATCH_DELAY_MS } from './ingestConfig';

/**
 * 투자자 수급 — 네이버 종목별 수급, KRX 세부 주체 수급, 마감 직후·과거 날짜 폴링.
 * (2026-07-26 ingest.ts 분할 — 800줄 규칙. 로직은 그대로 옮겼다.)
 */

/** `fetchDetailFlowsForDate`가 돌려주는 행 — KRX [12010] 주체별 순매수. */
type KrxDetailRow = Awaited<ReturnType<typeof fetchDetailFlowsForDate>>[number];

/**
 * 마감 직후 수급 수집 (CRON_FLOWS) — KRX [12010]이 마감 후 바로 당일치를 주므로,
 * 세부주체(stock_flows_krx)와 기본(외인·기관·개인, stock_flows)을 함께 채운다.
 * 전체 수집(18:10)을 기다리지 않고 당일 수급 순위를 마감 직후 노출하기 위함.
 */
export async function pollTodayFlows(): Promise<string | null> {
  // 오늘 KST 거래일 (평일만)
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const dow = kst.getUTCDay();
  if (dow < 1 || dow > 5) return null;
  const iso = kst.toISOString().slice(0, 10);

  return pollFlowsForDate(iso);
}

/**
 * 지정 거래일(KST, YYYY-MM-DD)의 마감 수급 수집 — pollTodayFlows의 실 구현체.
 * 부팅 캐치업(catchup.ts)이 과거 특정 날짜를 재수집할 때도 재사용.
 */
export async function pollFlowsForDate(iso: string): Promise<string | null> {
  if (!krxConfigured()) {
    logger.info('KRX 미설정 — 마감 수급 수집 건너뜀');
    return null;
  }
  const db = getDb();
  const ymd = iso.replace(/-/g, '');

  const { rows: tickerRows } = await db.query('SELECT ticker FROM stocks');
  const known = new Set(tickerRows.map((r: any) => r.ticker));

  const rows = await fetchDetailFlowsForDate(ymd);
  if (rows.length === 0) {
    logger.info(`마감 수급 수집: ${iso} KRX 데이터 아직 없음 (마감 전이거나 미발표)`);
    return null;
  }

  const saved = await saveKrxFlows(db, iso, rows, known);
  const basicCount = await upsertBasicFlowsFromKrx(db, iso, rows, known);

  logger.info(`마감 수급 수집 완료 (${iso}): 세부 ${saved}행, 기본 ${basicCount}종목`);
  return iso;
}

/** KRX 세부 수급 행을 `stock_flows_krx`에 upsert하고 저장 행 수를 돌려준다. */
async function saveKrxFlows(
  db: Db, iso: string, rows: KrxDetailRow[], known: Set<string>,
): Promise<number> {
  let saved = 0;
  for (const r of rows) {
    if (!known.has(r.ticker)) continue;
    await db.query(
      `INSERT INTO stock_flows_krx (trade_date, ticker, investor, net_amt, net_qty, buy_amt, buy_qty)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (trade_date, ticker, investor) DO UPDATE
         SET net_amt = EXCLUDED.net_amt, net_qty = EXCLUDED.net_qty,
             buy_amt = EXCLUDED.buy_amt, buy_qty = EXCLUDED.buy_qty`,
      [iso, r.ticker, r.investor, r.netAmt, r.netQty, r.buyAmt, r.buyQty],
    );
    saved++;
  }
  return saved;
}

/**
 * KRX 세부 수급에서 외국인·기관합계·개인 공식 순매수 금액을 뽑아 기본 수급(`stock_flows`)에 반영한다.
 *
 * ⚠️ **UPDATE가 아니라 upsert여야 한다.** 예전에는 `ingestKrxDetailFlows`가 UPDATE만 해서,
 * 네이버 수급이 아직 확정되지 않은 날은 `stock_flows`에 행 자체가 없어 KRX 데이터가 있어도
 * 기본 수급 순위(외인·기관·개인)가 그 날짜를 통째로 건너뛰었다 — 세부 모드만 최신이고 기본
 * 모드는 며칠 전에 멈춰 보이는 증상(2026-08-10 발견).
 */
async function upsertBasicFlowsFromKrx(
  db: Db, iso: string, rows: KrxDetailRow[], known: Set<string>,
): Promise<number> {
  const basic = new Map<string, { f?: number; i?: number; p?: number }>();
  for (const r of rows) {
    if (!known.has(r.ticker)) continue;
    if (r.investor !== '외국인' && r.investor !== '기관합계' && r.investor !== '개인') continue;
    const e = basic.get(r.ticker) ?? {};
    if (r.investor === '외국인') e.f = r.netAmt;
    else if (r.investor === '기관합계') e.i = r.netAmt;
    else e.p = r.netAmt;
    basic.set(r.ticker, e);
  }

  for (const [ticker, v] of basic) {
    // COALESCE로 기존 값을 지키는 이유: 네이버가 먼저 채운 수량·보유율 컬럼을 KRX 금액으로
    // 덮어쓰면서 날리지 않기 위함. KRX가 못 준 주체는 기존 값을 그대로 둔다.
    await db.query(
      `INSERT INTO stock_flows (ticker, trade_date, foreign_amt, inst_amt, individual_amt)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ticker, trade_date) DO UPDATE SET
         foreign_amt    = COALESCE(EXCLUDED.foreign_amt,    stock_flows.foreign_amt),
         inst_amt       = COALESCE(EXCLUDED.inst_amt,       stock_flows.inst_amt),
         individual_amt = COALESCE(EXCLUDED.individual_amt, stock_flows.individual_amt)`,
      [ticker, iso, v.f ?? null, v.i ?? null, v.p ?? null],
    );
  }
  return basic.size;
}

/**
 * KRX 세부 투자자 수급 — 최근 20영업일(네이버 수급 보유일 기준) 중 미수집 날짜를
 * 오래된 것부터 최대 5일씩 수집 (하루 12요청 × 5일, 일일 크론이 점진 백필).
 */
export async function ingestKrxDetailFlows(): Promise<void> {
  if (!krxConfigured()) {
    logger.info('KRX_ID/KRX_PW 미설정 — 세부 수급 수집 건너뜀');
    return;
  }
  const db = getDb();

  // '외국인' 행 유무를 기준으로 미수집 판정 (투자자 목록이 늘어나면 자동 재수집).
  // 거래일 달력은 stock_prices 기준 — 네이버 수급(익일 확정)과 달리 시세는 당일 반영되므로
  // KRX 당일 데이터를 같은 날 저녁에 바로 수집할 수 있다.
  const { rows: missing } = await db.query(
    `SELECT to_char(d, 'YYYYMMDD') AS ymd, to_char(d, 'YYYY-MM-DD') AS iso
     FROM (SELECT DISTINCT trade_date AS d FROM stock_prices ORDER BY d DESC LIMIT 20) t
     WHERE d NOT IN (SELECT DISTINCT trade_date FROM stock_flows_krx WHERE investor = '외국인')
     ORDER BY d DESC LIMIT 5`,
  );
  if (missing.length === 0) {
    logger.info('KRX 세부 수급: 최근 20영업일 모두 수집됨');
    return;
  }

  const { rows: tickerRows } = await db.query('SELECT ticker FROM stocks');
  const known = new Set(tickerRows.map((r: any) => r.ticker));

  for (const day of missing) {
    const rows = await fetchDetailFlowsForDate(day.ymd);
    const saved = await saveKrxFlows(db, day.iso, rows, known);
    logger.info(`KRX 세부 수급 ${day.iso}: ${saved}행 저장`);

    // 공식 금액으로 네이버 근사치 대체 (지표·백테스트 정확도 향상).
    // 개인까지 세 주체를 함께 반영하고, 네이버가 아직 그 날짜를 안 준 경우엔 행을 새로 만든다.
    const basicCount = await upsertBasicFlowsFromKrx(db, day.iso, rows, known);
    logger.info(`KRX 기본 수급 반영 ${day.iso}: ${basicCount}종목`);
  }
}

/**
 * 수급 수량 백필 (수급 추정평균가 정확화수급 당일평단 정밀화) — net_qty/foreign_qty(마이그레이션 030),
 * buy_amt/buy_qty(마이그레이션 031) 등 컬럼 추가 이전에 이미 저장된 행은 값이 NULL이므로,
 * 최근 날짜를 소스에서 재조회해 UPDATE로 채운다. 1회성 소급 작업.
 * data.routes.ts의 `POST /refresh {"scope":"flow-qty"}`로 트리거.
 */
export async function backfillRecentFlowQty(): Promise<{ krxDates: number; basicDates: number }> {
  const db = getDb();
  let krxDates = 0;
  let basicDates = 0;

  // 1) KRX 세부 수급 — net_qty 또는 buy_amt가 NULL인 최근 날짜(최대 30일) 재조회
  //    (수급 당일평단 정밀화 — buy_amt/buy_qty 컬럼 추가 이후 기존 행은 buy_amt가 NULL이므로 함께 대상에 포함)
  if (krxConfigured()) {
    const { rows: missing } = await db.query(
      `SELECT DISTINCT to_char(trade_date, 'YYYYMMDD') AS ymd, to_char(trade_date, 'YYYY-MM-DD') AS iso
       FROM stock_flows_krx WHERE net_qty IS NULL OR buy_amt IS NULL ORDER BY iso DESC LIMIT 30`,
    );
    for (const day of missing) {
      try {
        const rows = await fetchDetailFlowsForDate(day.ymd);
        for (const r of rows) {
          await db.query(
            `UPDATE stock_flows_krx SET net_qty = $4, buy_amt = $5, buy_qty = $6
             WHERE trade_date = $1 AND ticker = $2 AND investor = $3`,
            [day.iso, r.ticker, r.investor, r.netQty, r.buyAmt, r.buyQty],
          );
        }
        krxDates++;
        logger.info(`수급 수량 백필 (KRX) ${day.iso}: ${rows.length}행 재조회`);
      } catch (e: any) {
        logger.warn(`수급 수량 백필 (KRX) ${day.iso} 실패, 건너뜀: ${e?.message}`);
      }
    }
  } else {
    logger.info('KRX_ID/KRX_PW 미설정 — 세부 수급 수량 백필 건너뜀');
  }

  // 2) 기본 수급(외인·기관·개인) — foreign_qty NULL인 최근 날짜의 종목만 네이버 재조회
  const { rows: missingDates } = await db.query(
    `SELECT DISTINCT to_char(trade_date, 'YYYY-MM-DD') AS iso
     FROM stock_flows WHERE foreign_qty IS NULL ORDER BY iso DESC LIMIT 30`,
  );
  if (missingDates.length > 0) {
    const missingSet = new Set<string>(missingDates.map((d: any) => d.iso));
    const { rows: tickerRows } = await db.query(
      `SELECT DISTINCT ticker FROM stock_flows WHERE trade_date = ANY($1) AND foreign_qty IS NULL`,
      [[...missingSet]],
    );
    for (let i = 0; i < tickerRows.length; i += CONCURRENCY) {
      const batch = tickerRows.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (t: any) => {
          try {
            const flows = await fetchInvestorFlows(t.ticker, 20);
            for (const f of flows) {
              if (!missingSet.has(f.date)) continue;
              await db.query(
                `UPDATE stock_flows SET foreign_qty = $3, inst_qty = $4, individual_qty = $5
                 WHERE ticker = $1 AND trade_date = $2`,
                [t.ticker, f.date, f.foreignNet, f.instNet, f.individualNet],
              );
            }
          } catch (e: any) {
            logger.warn(`수급 수량 백필 (기본, ${t.ticker}) 실패, 건너뜀: ${e?.message}`);
          }
        }),
      );
      await sleep(BATCH_DELAY_MS);
    }
    basicDates = missingDates.length;
  }

  logger.info(`수급 수량 백필 완료: KRX ${krxDates}일 재조회, 기본 ${basicDates}일 대상 (종목 단위 네이버 재조회)`);
  return { krxDates, basicDates };
}

/** 투자자별 매매동향 최근 20일 upsert */
export async function ingestFlows(ticker: string): Promise<void> {
  const flows = await fetchInvestorFlows(ticker, 20);
  if (flows.length === 0) return;
  const db = getDb();
  for (const f of flows) {
    await db.query(
      `INSERT INTO stock_flows
         (ticker, trade_date, foreign_net, inst_net, individual_net,
          foreign_amt, inst_amt, individual_amt, foreign_hold_ratio,
          foreign_qty, inst_qty, individual_qty)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (ticker, trade_date) DO UPDATE
         SET foreign_net = EXCLUDED.foreign_net, inst_net = EXCLUDED.inst_net,
             individual_net = EXCLUDED.individual_net,
             foreign_amt = EXCLUDED.foreign_amt, inst_amt = EXCLUDED.inst_amt,
             individual_amt = EXCLUDED.individual_amt,
             foreign_hold_ratio = EXCLUDED.foreign_hold_ratio,
             foreign_qty = EXCLUDED.foreign_qty, inst_qty = EXCLUDED.inst_qty,
             individual_qty = EXCLUDED.individual_qty`,
      // 네이버 foreignNet/instNet/individualNet은 이미 순매수 "수량"(주) — foreign_qty 등에도 그대로 저장
      [ticker, f.date, f.foreignNet, f.instNet, f.individualNet,
       f.foreignAmt, f.instAmt, f.individualAmt, f.foreignHoldRatio,
       f.foreignNet, f.instNet, f.individualNet],
    );
  }
}
