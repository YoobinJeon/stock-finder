import { Router, Request, Response } from 'express';
import { getDb } from '../../config/database';
import { asyncHandler } from '../../utils/asyncHandler';
import { fetchThemeListLive, refreshThemeSnapshot } from '../../pipeline/sources/naverThemes';
import { kstMarket, fetchStockQuotes } from './market.routes';
import { logger } from '../../utils/logger';
import { snapshotThemesDaily } from '../../pipeline/themeSnapshot';
import { calcThemeRotation, ThemeSnapRow } from '../../pipeline/themeRotation';

const router = Router();

// 로테이션 계산에 쓸 스냅샷일 수 (최근 3일 + 이전 5일)
const ROTATION_SNAP_DAYS = 8;
const ROTATION_TOP_N = 15;
const MIN_STREAK = 2;

/** 스냅샷 갱신 동시 실행 가드 (266요청 · 2~3분 소요 작업) */
let refreshing = false;

async function runRefresh(): Promise<{ themes: number; members: number }> {
  refreshing = true;
  try {
    return await refreshThemeSnapshot();
  } finally {
    refreshing = false;
  }
}

// 라이브 시세를 붙일 상위 테마 수 (266개 전체 대장주 시세는 과요청이라 상위만)
const LIVE_LEADER_THEMES = 20;

/**
 * 테마 레이더 — DB 스냅샷(테마·구성종목) + 점수 조인 + 네이버 라이브 등락률 오버레이.
 * 주도주: 테마 내 점수 50% + 시총 백분위 30% + 20일 수급 백분위 20% 상위 3종목.
 */
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const db = getDb();

  const [{ rows: themes }, { rows: leaders }, { rows: meta }] = await Promise.all([
    db.query(
      `SELECT t.theme_no, t.name,
              COUNT(m.ticker)::int AS member_count,
              COUNT(sc.ticker)::int AS scored_count,
              ROUND(AVG(sc.total_score))::int AS avg_score
       FROM themes t
       LEFT JOIN theme_members m ON m.theme_no = t.theme_no
       LEFT JOIN stocks s ON s.ticker = m.ticker AND s.is_active = TRUE
       LEFT JOIN stock_scores sc ON sc.ticker = s.ticker
       GROUP BY t.theme_no, t.name`,
    ),
    db.query(
      `WITH base AS (
         SELECT m.theme_no, s.ticker, s.name, s.market_cap,
                COALESCE(sc.total_score, 0) AS score,
                COALESCE(i.foreign_amt_20d, 0) + COALESCE(i.inst_amt_20d, 0) AS flow20
         FROM theme_members m
         JOIN stocks s ON s.ticker = m.ticker AND s.is_active = TRUE
         LEFT JOIN stock_scores sc ON sc.ticker = s.ticker
         LEFT JOIN stock_indicators i ON i.ticker = s.ticker
         WHERE s.market_cap IS NOT NULL
       ),
       scored AS (
         SELECT *,
                score * 0.5
                + PERCENT_RANK() OVER (PARTITION BY theme_no ORDER BY market_cap) * 100 * 0.3
                + PERCENT_RANK() OVER (PARTITION BY theme_no ORDER BY flow20) * 100 * 0.2 AS leader_score
         FROM base
       )
       SELECT theme_no, ticker, name, market_cap,
              ROUND(score)::int AS total_score, ROUND(leader_score)::int AS leader_score
       FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY theme_no ORDER BY leader_score DESC) AS rn FROM scored) x
       WHERE rn <= 3
       ORDER BY theme_no, leader_score DESC`,
    ),
    db.query(`SELECT to_char(MAX(updated_at), 'YYYY-MM-DD HH24:MI') AS updated_at FROM themes`),
  ]);

  // 스냅샷이 비어 있으면 백그라운드로 1회 자동 수집 (첫 방문 UX)
  if (themes.length === 0 && !refreshing) {
    runRefresh().catch((e) => logger.warn(`테마 자동 수집 실패: ${e?.message}`));
  }

  const leadersByTheme = new Map<number, any[]>();
  for (const l of leaders) {
    const list = leadersByTheme.get(l.theme_no) ?? [];
    list.push({
      ticker: l.ticker,
      name: l.name,
      marketCap: Number(l.market_cap),
      totalScore: l.total_score,
      leaderScore: l.leader_score,
    });
    leadersByTheme.set(l.theme_no, list);
  }

  // 라이브 등락률 오버레이 — 마감 후에도 네이버는 당일 최종치를 반환
  const live = await fetchThemeListLive();
  const liveByNo = new Map(live.map((t) => [t.no, t]));
  const { open, hhmm } = kstMarket();

  const rows = themes.map((t) => {
    const l = liveByNo.get(t.theme_no);
    return {
      no: t.theme_no,
      name: t.name,
      memberCount: t.member_count,
      scoredCount: t.scored_count, // 우리 점수가 있는 종목 수 (수집 범위 내)
      avgScore: t.avg_score,
      chgPct: l?.chgPct ?? null,
      up: l?.up ?? null,
      down: l?.down ?? null,
      leaders: leadersByTheme.get(t.theme_no) ?? [],
    };
  });

  rows.sort((a, b) => (b.chgPct ?? -999) - (a.chgPct ?? -999));

  // 장중이면 상위 테마의 주도주만 실시간 시세 부착 (요청량 절제)
  if (open) {
    const leaderTickers = rows
      .slice(0, LIVE_LEADER_THEMES)
      .flatMap((r) => r.leaders.map((l: { ticker: string }) => l.ticker));
    const quotes = await fetchStockQuotes(leaderTickers);
    for (const r of rows.slice(0, LIVE_LEADER_THEMES)) {
      r.leaders = r.leaders.map((l: any) => {
        const q = quotes.get(l.ticker);
        return { ...l, livePrice: q?.price ?? null, liveChgPct: q?.changePct ?? null };
      });
    }
  }

  res.json({
    intraday: open,
    asOf: live.length > 0 ? hhmm : null,
    updatedAt: meta[0]?.updated_at ?? null,
    refreshing,
    themes: rows,
  });
}));

/**
 * 오늘 테마 등락률을 즉시 스냅샷 적재 — 수동 트리거·크론 실패 시 보완용.
 * 주의: '/:no'보다 먼저 등록해야 함.
 */
router.post('/snapshot', asyncHandler(async (_req: Request, res: Response) => {
  const count = await snapshotThemesDaily();
  const date = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  res.json({ count, date });
}));

/**
 * 테마 로테이션 — theme_daily_snapshots 최근 8개 스냅샷일(최근 3일+이전 5일 모멘텀용) 기준 계산.
 * 스냅샷이 2일 미만 축적된 상태면 세 배열 모두 빈 배열 + snapDays만 반환 (200 유지).
 * 주의: '/:no'보다 먼저 등록해야 함.
 */
router.get('/rotation', asyncHandler(async (_req: Request, res: Response) => {
  const db = getDb();
  const { rows: dateRows } = await db.query(
    `SELECT DISTINCT to_char(snap_date, 'YYYY-MM-DD') AS d FROM theme_daily_snapshots
     ORDER BY d DESC LIMIT $1`,
    [ROTATION_SNAP_DAYS],
  );
  const snapDays = dateRows.length;
  const asOf = dateRows[0]?.d ?? null;

  if (snapDays < 2) {
    res.json({ asOf, snapDays, heating: [], cooling: [], streaks: [] });
    return;
  }

  const { rows } = await db.query(
    `SELECT theme_no, name, to_char(snap_date, 'YYYY-MM-DD') AS snap_date,
            chg_pct, up_cnt, total_cnt
     FROM theme_daily_snapshots
     WHERE snap_date IN (
       SELECT DISTINCT snap_date FROM theme_daily_snapshots ORDER BY snap_date DESC LIMIT $1
     )`,
    [ROTATION_SNAP_DAYS],
  );

  const snapRows: ThemeSnapRow[] = rows.map((r: any) => ({
    theme_no: r.theme_no,
    name: r.name,
    snap_date: String(r.snap_date),
    chg_pct: r.chg_pct,
    up_cnt: r.up_cnt,
    total_cnt: r.total_cnt,
  }));
  const rotation = calcThemeRotation(snapRows);

  const heating = [...rotation].sort((a, b) => b.momentum - a.momentum).slice(0, ROTATION_TOP_N);
  const cooling = [...rotation]
    .filter((r) => r.momentum < 0)
    .sort((a, b) => a.momentum - b.momentum)
    .slice(0, ROTATION_TOP_N);
  const streaks = [...rotation]
    .filter((r) => r.upStreak >= MIN_STREAK)
    .sort((a, b) => b.upStreak - a.upStreak)
    .slice(0, ROTATION_TOP_N);

  res.json({ asOf, snapDays, heating, cooling, streaks });
}));

// 테마 상세 — 구성종목 전체 + 점수 + (장중) 실시간 시세
router.get('/:no', asyncHandler(async (req: Request, res: Response) => {
  const no = Number(req.params.no);
  if (!Number.isInteger(no)) {
    res.status(400).json({ error: '테마 번호가 필요합니다.' });
    return;
  }

  const db = getDb();
  const { rows: themeRows } = await db.query('SELECT theme_no, name FROM themes WHERE theme_no = $1', [no]);
  if (!themeRows[0]) {
    res.status(404).json({ error: '테마를 찾을 수 없습니다.' });
    return;
  }

  const { rows: members } = await db.query(
    `SELECT m.ticker, s.name, s.market, s.sector, s.market_cap,
            ROUND(sc.total_score)::int AS total_score,
            i.last_close, i.day_change
     FROM theme_members m
     LEFT JOIN stocks s ON s.ticker = m.ticker AND s.is_active = TRUE
     LEFT JOIN stock_scores sc ON sc.ticker = m.ticker
     LEFT JOIN stock_indicators i ON i.ticker = m.ticker
     WHERE m.theme_no = $1
     ORDER BY sc.total_score DESC NULLS LAST, s.market_cap DESC NULLS LAST`,
    [no],
  );

  const { open, hhmm } = kstMarket();
  let quotes = new Map<string, { price: number; changePct: number }>();
  if (open) {
    quotes = await fetchStockQuotes(members.map((m) => m.ticker));
  }

  res.json({
    no,
    name: themeRows[0].name,
    intraday: open,
    asOf: open ? hhmm : null,
    members: members.map((m) => {
      const q = quotes.get(m.ticker);
      return {
        ticker: m.ticker,
        name: m.name,            // 수집 범위 밖(비활성) 종목은 null일 수 있음
        market: m.market,
        sector: m.sector,
        marketCap: m.market_cap != null ? Number(m.market_cap) : null,
        totalScore: m.total_score,
        lastClose: m.last_close != null ? Number(m.last_close) : null,
        dayChange: m.day_change != null ? Number(m.day_change) : null,
        livePrice: q?.price ?? null,
        liveChgPct: q?.changePct ?? null,
      };
    }),
  });
}));

// 테마 스냅샷 수동 갱신 (~266요청 · 2~3분). 실행 중이면 409.
router.post('/refresh', asyncHandler(async (_req: Request, res: Response) => {
  if (refreshing) {
    res.status(409).json({ error: '테마 수집이 이미 실행 중입니다.' });
    return;
  }
  const started = Date.now();
  const result = await runRefresh();
  res.json({ ok: true, ...result, tookMs: Date.now() - started });
}));

export default router;
