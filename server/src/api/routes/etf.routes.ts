import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { fetchEtfList, ETF_TABS } from '../../pipeline/sources/naverEtf';
import {
  fetchEtfCandles,
  fetchEtfAnalysis,
  calcMaFlags,
} from '../../pipeline/sources/naverEtfDetail';
import { calcTrendState } from '../../pipeline/etfTrendState';
import { kstMarket } from './market.routes';
import { fetchTodayBar } from './market/shared';
import { mergeTodayBar } from '../../pipeline/mergeTodayBar';
import { snapshotEtfDaily } from '../../pipeline/etfSnapshot';
import { snapshotEtfPhases } from '../../pipeline/etfPhaseSnapshot';
import { calcEtfFlows, EtfSnapRow } from '../../pipeline/etfFlowCalc';
import { calcPhaseTransitions, PhaseRow } from '../../pipeline/etfPhaseTransitions';
import {
  REPRESENTATIVE_ETFS,
  getEffectiveBoardList,
  getBoardConfig,
  parseBoardConfig,
  mergeBoardList,
} from '../../pipeline/etfCuration';
import { getDb } from '../../config/database';
import { jobRunner } from '../../pipeline/JobRunner';

const router = Router();

const FLOW_DAYS_OPTIONS = [1, 5, 20] as const;
const DEFAULT_FLOW_DAYS = 5;
const TOP_N = 20;
const DEFAULT_PHASE_DAYS = 14;
const MAX_PHASE_DAYS = 30;

// 차트보드 일봉 수 — MA120·신고가(252봉) 계산분 확보 후 클라에서 최근 구간 표시
const BOARD_CANDLE_COUNT = 260;

/**
 * ETF 전종목/카테고리 시세 — 네이버 라이브 전용 (DB 저장 없음).
 * ?tab=1~7 (네이버 etfTabCode)로 필터. 마감 후에도 네이버가 당일 최종치를 반환.
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const tabNum = Number(req.query.tab);
  const tab = Number.isInteger(tabNum) && ETF_TABS[tabNum] ? tabNum : null;

  const all = await fetchEtfList();
  const items = tab ? all.filter((i) => i.tab === tab) : all;
  const { open, hhmm } = kstMarket();

  res.json({
    asOf: hhmm,
    intraday: open,
    tabs: ETF_TABS,
    count: items.length,
    items,
  });
}));

/**
 * 대표 ETF 차트보드 — 업종·테마별 대표 ETF의 일봉 + 정배열/20일선 플래그 + 국면(state).
 * 클라가 이평선(5·10·20·60·120)을 그릴 수 있게 일봉 200개를 그대로 내려준다.
 * 주의: '/:ticker'보다 먼저 등록해야 함.
 */
router.get('/board', asyncHandler(async (_req: Request, res: Response) => {
  const boardList = await getEffectiveBoardList(getDb());
  const list = await fetchEtfList();
  const byTicker = new Map(list.map((e) => [e.ticker, e]));
  const { open, hhmm } = kstMarket();

  // 큐레이션(기본 31종 + 사용자 커스텀) × 일봉 260개 — 4개씩 나눠 순차 요청 (첫 호출 후엔 2분 캐시)
  // 큐레이션 전 종목 오늘 봉 일괄 조회(30초 캐시). 실패해도 fail-soft.
  const todayBars = await fetchTodayBar(boardList.map((b) => b.ticker));

  const items: any[] = [];
  const CHUNK = 4;
  for (let i = 0; i < boardList.length; i += CHUNK) {
    const chunk = boardList.slice(i, i + CHUNK);
    const results = await Promise.all(
      chunk.map(async ({ ticker, group }) => {
        const rawCandles = await fetchEtfCandles(ticker, BOARD_CANDLE_COUNT);
        if (rawCandles.length === 0) return null; // 조회 실패 종목은 보드에서 제외
        const bar = todayBars.get(ticker);
        const gated = bar && (open || bar.volume > 0) ? bar : null; // TodayBar는 Candle과 동일 shape
        const candles = mergeTodayBar(rawCandles, gated, (c) => c.date);
        const live = byTicker.get(ticker);
        const trend = calcTrendState(candles);
        return {
          ticker,
          group,
          name: live?.name ?? ticker,
          price: live?.price ?? candles[candles.length - 1].close,
          changePct: live?.changePct ?? null,
          flags: calcMaFlags(candles),
          state: trend.state,
          alignedStreak: trend.alignedStreak,
          recentExit: trend.recentExit,
          candles,
        };
      }),
    );
    items.push(...results.filter((r) => r != null));
  }

  res.json({ asOf: hhmm, intraday: open, items });
}));

/**
 * 차트보드 커스텀 구성 조회 — 기본 큐레이션 31종 + 사용자 추가/제거 목록.
 * 주의: '/:ticker'보다 먼저 등록해야 함.
 */
router.get('/board-config', asyncHandler(async (_req: Request, res: Response) => {
  const config = await getBoardConfig(getDb());
  res.json({ defaults: REPRESENTATIVE_ETFS, added: config.added, removed: config.removed });
}));

/**
 * 차트보드 커스텀 구성 저장 — app_settings에 오버레이(added/removed)만 저장,
 * 기본 큐레이션(REPRESENTATIVE_ETFS)은 코드에 그대로 유지되어 충돌하지 않는다.
 * 주의: '/:ticker'보다 먼저 등록해야 함.
 */
router.put('/board-config', asyncHandler(async (req: Request, res: Response) => {
  const config = parseBoardConfig(req.body);
  if (!config) {
    res.status(400).json({
      error: '올바르지 않은 구성입니다. added는 최대 30개, ticker는 6자리 숫자/영문대문자, group은 1~20자여야 합니다.',
    });
    return;
  }

  const db = getDb();
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    ['etf_board_config', JSON.stringify(config)],
  );

  const merged = mergeBoardList(REPRESENTATIVE_ETFS, config);
  res.json({ ok: true, count: merged.length });
}));

/**
 * 오늘 ETF 시세 + 차트보드 큐레이션 종목 국면(state) 이력을 즉시 스냅샷 적재
 * 수동 트리거·크론 실패 시 보완용. 주의: '/:ticker'보다 먼저 등록해야 함.
 */
router.post('/snapshot', asyncHandler(async (_req: Request, res: Response) => {
  // 수집 잡과 동시에 돌면 같은 테이블을 두 곳에서 쓴다 — 다른 heavy 라우트와 동일하게 409.
  if (jobRunner.isRunning()) {
    res.status(409).json({ error: '이미 실행 중인 수집 작업이 있습니다.', status: jobRunner.getStatus() });
    return;
  }
  const count = await snapshotEtfDaily();
  const phases = await snapshotEtfPhases();
  const date = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  res.json({ count, phases, date });
}));

/**
 * 자금유입 추정·RS 순위 — etf_daily_snapshots 최근 (days+1)개 스냅샷일 기준 계산.
 * 스냅샷이 2일 미만 축적된 상태면 빈 배열 + snapDays만 반환 (200 유지, 클라가 안내 표시).
 * 주의: '/:ticker'보다 먼저 등록해야 함.
 */
router.get('/flows', asyncHandler(async (req: Request, res: Response) => {
  const daysNum = Number(req.query.days);
  const days = (FLOW_DAYS_OPTIONS as readonly number[]).includes(daysNum)
    ? daysNum
    : DEFAULT_FLOW_DAYS;

  const db = getDb();
  const { rows: dateRows } = await db.query(
    `SELECT DISTINCT to_char(snap_date, 'YYYY-MM-DD') AS d FROM etf_daily_snapshots
     ORDER BY d DESC LIMIT $1`,
    [days + 1],
  );
  const snapDays = dateRows.length;
  const asOf = dateRows[0]?.d ?? null;

  if (snapDays < 2) {
    res.json({ days, asOf, snapDays, inflow: [], outflow: [], rs: [] });
    return;
  }

  const { rows } = await db.query(
    `SELECT ticker, name, tab, to_char(snap_date, 'YYYY-MM-DD') AS snap_date,
            close, change_pct, market_cap
     FROM etf_daily_snapshots
     WHERE snap_date IN (
       SELECT DISTINCT snap_date FROM etf_daily_snapshots ORDER BY snap_date DESC LIMIT $1
     )`,
    [days + 1],
  );

  const snapRows: EtfSnapRow[] = rows.map((r: any) => ({
    ticker: r.ticker,
    name: r.name,
    tab: r.tab,
    snap_date: String(r.snap_date),
    close: r.close,
    change_pct: r.change_pct,
    market_cap: r.market_cap,
  }));
  const flows = calcEtfFlows(snapRows);

  const inflow = [...flows].sort((a, b) => b.flowEst - a.flowEst).slice(0, TOP_N);
  const outflow = [...flows]
    .filter((f) => f.flowEst < 0)
    .sort((a, b) => a.flowEst - b.flowEst)
    .slice(0, TOP_N);
  const rs = [...flows].sort((a, b) => b.rsPercentile - a.rsPercentile).slice(0, TOP_N);

  res.json({ days, asOf, snapDays, inflow, outflow, rs });
}));

/**
 * 국면 전환 타임라인 — etf_phase_history 최근 (days+1)개 snap_date 기준 인접 일자 전환 계산.
 * 스냅샷이 2일 미만 축적된 상태면 빈 배열 + snapDays만 반환 (200 유지, 클라가 안내 표시).
 * 주의: '/:ticker'보다 먼저 등록해야 함.
 */
router.get('/phase-transitions', asyncHandler(async (req: Request, res: Response) => {
  const daysNum = Number(req.query.days);
  const days = Number.isInteger(daysNum) && daysNum > 0
    ? Math.min(daysNum, MAX_PHASE_DAYS)
    : DEFAULT_PHASE_DAYS;

  const db = getDb();
  const { rows: dateRows } = await db.query(
    `SELECT DISTINCT to_char(snap_date, 'YYYY-MM-DD') AS d FROM etf_phase_history
     ORDER BY d DESC LIMIT $1`,
    [days + 1],
  );
  const snapDays = dateRows.length;
  const asOf = dateRows[0]?.d ?? null;

  if (snapDays < 2) {
    res.json({ asOf, snapDays, transitions: [] });
    return;
  }

  const { rows } = await db.query(
    `SELECT ticker, name, to_char(snap_date, 'YYYY-MM-DD') AS snap_date, state
     FROM etf_phase_history
     WHERE snap_date IN (
       SELECT DISTINCT snap_date FROM etf_phase_history ORDER BY snap_date DESC LIMIT $1
     )`,
    [days + 1],
  );

  const phaseRows: PhaseRow[] = rows.map((r: any) => ({
    ticker: r.ticker,
    name: r.name,
    snap_date: String(r.snap_date),
    state: r.state,
  }));
  const transitions = calcPhaseTransitions(phaseRows);

  res.json({ asOf, snapDays, transitions });
}));

// ETF 상세 — 기본정보·편입종목 top10·일봉(이평선용 280개)·정배열/20일선 플래그
router.get('/:ticker', asyncHandler(async (req: Request, res: Response) => {
  const ticker = String(req.params.ticker);
  if (!/^[0-9A-Z]{6}$/.test(ticker)) {
    res.status(400).json({ error: '올바른 종목코드가 아닙니다.' });
    return;
  }

  const [candles, analysis, list] = await Promise.all([
    fetchEtfCandles(ticker, 280),
    fetchEtfAnalysis(ticker),
    fetchEtfList(),
  ]);
  const live = list.find((e) => e.ticker === ticker) ?? null;

  if (candles.length === 0 && !live && !analysis) {
    res.status(404).json({ error: 'ETF를 찾을 수 없습니다.' });
    return;
  }

  const { open, hhmm } = kstMarket();
  res.json({
    ticker,
    name: live?.name ?? ticker,
    asOf: hhmm,
    intraday: open,
    quote: live, // 목록 API의 실시간 시세 (등락률·거래대금·시총·NAV괴리·3개월)
    info: analysis,
    flags: calcMaFlags(candles),
    candles,
  });
}));

export default router;
