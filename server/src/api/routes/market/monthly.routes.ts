/**
 * 월간 상승률 — 월간으로 많이 오른 **묶음(테마·산업)과 종목**을 본다.
 *
 * 세 갈래로 내려보낸다.
 *   GET /monthly/groups?axis=theme|sector — 묶음 × 월 매트릭스 (달이 지나면 열이 하나 늘어난다)
 *   GET /monthly/stocks?month=…           — 그 달 종목 상승률 상위 N
 *   GET /monthly/groups/:axis/:key        — 그 묶음 멤버 종목 × 월
 *
 * ⚠️ **묶음 구성에는 시점이 없다.** `theme_members`도 `stocks.sector`도 현재 구성 한 벌뿐이라
 * 과거 달도 오늘 구성으로 소급 계산된다(그달 상장 전이던 종목은 값이 없어 빠진다).
 * 화면에서 이 한계를 밝힌다.
 */
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { readMonthlySnapshot, writeMonthlySnapshot } from '../../../utils/monthlySnapshotCache';
import { getDb, type Db } from '../../../config/database';
import { BREAK_RATIO_HIGH, BREAK_RATIO_LOW } from '../../../pipeline/priceRepair';
import {
  START_MONTH, buildMonthlyReturns, isPartialMonth, monthIndexOf, monthKeyOf, monthsBetween,
  suspectKeyOf, type MonthEndClose, type ReturnsByTicker,
} from './monthly/monthlyReturns';
import { aggregateGroup, type GroupCell } from './monthly/groupAggregate';
import { buildGroups, parseAxis, DEFAULT_AXIS, type Axis, type Group } from './monthly/groupAxis';

const router = Router();

/** 종목 랭킹 기본·최대 노출 수. */
const DEFAULT_STOCK_LIMIT = 50;
const MAX_STOCK_LIMIT = 300;

interface StockMeta {
  name: string;
  market: string | null;
  marketCap: number | null;
  sector: string | null;
}

interface MonthlySnapshot {
  /** 시세의 마지막 거래일 (`YYYY-MM-DD`). 캐시 무효화 키이자 화면의 "기준일". */
  asOf: string;
  months: string[];
  partialMonth: string | null;
  returns: ReturnsByTicker;
  /** 달 → 기업 액션 미반영으로 제외한 활성 종목 수. 0을 숨기지 않기 위해 상시 노출한다. */
  excludedByMonth: Record<string, number>;
  stocks: Map<string, StockMeta>;
  /** 테마번호 → 멤버 티커. */
  members: Map<number, string[]>;
  themeNames: Map<number, string>;
}

const toNumber = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * 월말 종가·종목·테마 구성을 한 번 읽어 스냅샷을 만든다.
 *
 * 매 요청 2,700여 종목 × 열 달치를 다시 계산할 이유가 없어 **마지막 거래일을 키로 캐시**한다.
 * 새 일봉이 들어오면(평일 15:50·18:10 수집) 키가 바뀌어 자동으로 다시 계산된다.
 */
async function loadSnapshot(db: Db): Promise<MonthlySnapshot> {
  const { rows: asOfRows } = await db.query(
    'SELECT MAX(trade_date)::text AS as_of FROM stock_prices',
  );
  const asOf: string | null = asOfRows[0]?.as_of ?? null;
  if (!asOf) {
    return {
      asOf: '', months: [], partialMonth: null,
      returns: new Map(), excludedByMonth: {},
      stocks: new Map(), members: new Map(), themeNames: new Map(),
    };
  }
  const cached = readMonthlySnapshot<MonthlySnapshot>();
  // 캐시 키는 마지막 거래일이다. 종가가 **다시 쓰이는** 경우(priceRepair)는 거래일이 안 바뀌므로
  // 키로 잡히지 않는다 — 그쪽에서 `invalidateMonthlySnapshot()`을 직접 건다.
  if (cached && cached.asOf === asOf) return cached;

  // 첫 달의 수익률을 내려면 그 **직전 달** 월말 종가가 있어야 한다.
  const fromMonth = monthKeyOf(monthIndexOf(START_MONTH) - 1);
  const { rows: closeRows } = await db.query(
    `SELECT DISTINCT ON (ticker, to_char(trade_date, 'YYYY-MM'))
            ticker, to_char(trade_date, 'YYYY-MM') AS ym, close
       FROM stock_prices
      WHERE trade_date >= $1::date
      ORDER BY ticker, to_char(trade_date, 'YYYY-MM'), trade_date DESC`,
    [`${fromMonth}-01`],
  );

  const closes: MonthEndClose[] = [];
  for (const r of closeRows as Array<{ ticker: string; ym: string; close: unknown }>) {
    const close = toNumber(r.close);
    if (close == null) continue;
    closes.push({ ticker: r.ticker, ym: r.ym, close });
  }
  /**
   * 기업 액션(액면병합·감자·분할)이 소급 반영되지 않아 눈금이 튄 (종목, 달)을 찾는다.
   *
   * KRX 일일 상하한가는 ±30%다. 인접 **거래일** 종가 비율이 `priceRepair`와 같은 기준선
   * [0.6, 1.4]를 벗어나면 하루 등락으로 설명이 불가능하다. 실제로 2026-07에 다이나믹디자인이
   * 하루 만에 정확히 ×10(224 → 2,240)이 되어 월간 +900%로 1위에 올라 있었다.
   * 그 달의 수익률은 값이 아니라 잡음이므로 만들지 않는다 — 제외한 건수는 화면에 노출한다.
   */
  const { rows: breakRows } = await db.query(
    `WITH d AS (
       SELECT ticker, trade_date, close,
              LAG(close) OVER (PARTITION BY ticker ORDER BY trade_date) AS prev
         FROM stock_prices
        WHERE trade_date >= $1::date
     )
     SELECT DISTINCT ticker, to_char(trade_date, 'YYYY-MM') AS ym
       FROM d
      WHERE prev IS NOT NULL AND prev > 0
        AND (close / prev > $2 OR close / prev < $3)`,
    [`${fromMonth}-01`, BREAK_RATIO_HIGH, BREAK_RATIO_LOW],
  );
  const suspectKeys = new Set<string>();
  for (const r of breakRows as Array<{ ticker: string; ym: string }>) {
    suspectKeys.add(suspectKeyOf(r.ticker, r.ym));
  }

  const returns = buildMonthlyReturns(closes, suspectKeys);

  // 상장폐지 종목은 시세가 멈춘 채 낡은 값으로 상위에 남으므로 제외한다.
  // 시총·품질 필터는 두지 않는다 — 그건 사용자가 판단할 몫이다(설계 결정 2026-08-11).
  const { rows: stockRows } = await db.query(
    'SELECT ticker, name, market, market_cap, sector FROM stocks WHERE is_active = TRUE',
  );
  const stocks = new Map<string, StockMeta>();
  for (const r of stockRows as Array<Record<string, unknown>>) {
    stocks.set(String(r.ticker), {
      name: String(r.name),
      market: r.market == null ? null : String(r.market),
      marketCap: toNumber(r.market_cap),
      sector: r.sector == null ? null : String(r.sector),
    });
  }

  const { rows: memberRows } = await db.query(
    `SELECT m.theme_no, m.ticker, t.name
       FROM theme_members m JOIN themes t ON t.theme_no = m.theme_no`,
  );
  const members = new Map<number, string[]>();
  const themeNames = new Map<number, string>();
  for (const r of memberRows as Array<{ theme_no: number; ticker: string; name: string }>) {
    const no = Number(r.theme_no);
    themeNames.set(no, r.name);
    const list = members.get(no);
    if (list) list.push(r.ticker);
    else members.set(no, [r.ticker]);
  }

  const months = monthsBetween(START_MONTH, asOf.slice(0, 7));
  const latest = months[months.length - 1] ?? null;

  const excludedByMonth: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
  for (const key of suspectKeys) {
    const [ticker, ym] = key.split('|');
    if (excludedByMonth[ym] == null || !stocks.has(ticker)) continue;
    excludedByMonth[ym] += 1;
  }

  return writeMonthlySnapshot<MonthlySnapshot>({
    asOf,
    months,
    partialMonth: latest && isPartialMonth(latest, asOf) ? latest : null,
    returns, excludedByMonth, stocks, members, themeNames,
  });
}

/** 그 묶음·그 달에 값을 가진 멤버들의 수익률. 멤버는 이미 활성 종목만 걸러져 들어온다. */
function memberReturns(
  snap: MonthlySnapshot, tickers: readonly string[], month: string,
): number[] {
  const out: number[] = [];
  for (const ticker of tickers) {
    const value = snap.returns.get(ticker)?.get(month);
    if (value != null) out.push(value);
  }
  return out;
}

/** 요청의 `axis`를 읽는다. 값이 없으면 기본 축, 아는 값이 아니면 400. */
function readAxis(req: Request, res: Response, raw: unknown): Axis | null {
  if (raw == null || raw === '') return DEFAULT_AXIS;
  const axis = parseAxis(raw);
  if (!axis) {
    res.status(400).json({ error: "axis는 'theme' 또는 'sector'여야 합니다." });
    return null;
  }
  return axis;
}

/**
 * `GET /monthly/groups?axis=theme|sector` — 묶음 × 월 매트릭스.
 *
 * 266개 테마(또는 수십 개 산업) × 열 달치를 한 번에 내려보낸다(테마 축 약 200KB).
 * 화면에서 열 정렬·행 펼침이 재조회 없이 즉시 되도록 하기 위함이다.
 */
router.get('/monthly/groups', asyncHandler(async (req: Request, res: Response) => {
  const axis = readAxis(req, res, req.query.axis);
  if (!axis) return;
  const snap = await loadSnapshot(getDb());

  const rows = [];
  for (const group of buildGroups(axis, snap).values()) {
    const cells: Record<string, GroupCell> = {};
    for (const month of snap.months) {
      const cell = aggregateGroup(memberReturns(snap, group.tickers, month));
      if (cell) cells[month] = cell;
    }
    if (Object.keys(cells).length === 0) continue;
    rows.push({
      key: group.key,
      name: group.name,
      memberCount: group.tickers.length,
      cells,
    });
  }

  res.json({
    axis,
    startMonth: START_MONTH,
    asOf: snap.asOf,
    months: snap.months,
    partialMonth: snap.partialMonth,
    excludedByMonth: snap.excludedByMonth,
    rows,
  });
}));

/**
 * `GET /monthly/stocks?month=YYYY-MM&limit=50` — 그 달 상승률 상위 종목.
 * 시총·품질 필터 없이 있는 그대로 줄 세운다.
 */
router.get('/monthly/stocks', asyncHandler(async (req: Request, res: Response) => {
  const snap = await loadSnapshot(getDb());
  const month = String(req.query.month ?? snap.months[snap.months.length - 1] ?? '');
  if (!snap.months.includes(month)) {
    res.status(400).json({ error: `month는 ${START_MONTH} 이후의 YYYY-MM이어야 합니다.` });
    return;
  }
  const limit = Math.min(
    MAX_STOCK_LIMIT,
    Math.max(1, Number(req.query.limit) || DEFAULT_STOCK_LIMIT),
  );

  const rows = [];
  for (const [ticker, byMonth] of snap.returns) {
    const value = byMonth.get(month);
    if (value == null) continue;
    const meta = snap.stocks.get(ticker);
    if (!meta) continue; // 상장폐지 종목
    rows.push({
      ticker,
      name: meta.name,
      market: meta.market,
      marketCap: meta.marketCap,
      sector: meta.sector,
      changePct: value,
    });
  }
  rows.sort((a, b) => b.changePct - a.changePct);

  res.json({
    month,
    asOf: snap.asOf,
    isPartial: snap.partialMonth === month,
    // 기업 액션 미반영으로 제외한 종목 수 — 숨기면 "필터 없음"이 거짓말이 된다.
    excluded: snap.excludedByMonth[month] ?? 0,
    total: rows.length,
    items: rows.slice(0, limit),
  });
}));

/** `GET /monthly/groups/:axis/:key` — 그 묶음 멤버 종목 × 월 (매트릭스 행 펼침용). */
router.get('/monthly/groups/:axis/:key', asyncHandler(async (req: Request, res: Response) => {
  const axis = readAxis(req, res, req.params.axis);
  if (!axis) return;
  const snap = await loadSnapshot(getDb());
  // 산업명은 한글이라 URL 인코딩되어 온다 — express가 `req.params`를 이미 디코드해 준다.
  const group: Group | undefined = buildGroups(axis, snap).get(req.params.key);
  if (!group) {
    res.status(404).json({ error: axis === 'sector' ? '없는 산업입니다.' : '없는 테마입니다.' });
    return;
  }

  const items = [];
  for (const ticker of group.tickers) {
    const meta = snap.stocks.get(ticker);
    if (!meta) continue;
    const byMonth = snap.returns.get(ticker);
    const cells: Record<string, number> = {};
    for (const month of snap.months) {
      const value = byMonth?.get(month);
      if (value != null) cells[month] = value;
    }
    items.push({
      ticker, name: meta.name, market: meta.market, marketCap: meta.marketCap, cells,
    });
  }

  res.json({
    axis,
    key: group.key,
    name: group.name,
    months: snap.months,
    partialMonth: snap.partialMonth,
    asOf: snap.asOf,
    items,
  });
}));

export default router;
