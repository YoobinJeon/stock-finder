import { Router, Request, Response } from 'express';
import { getDb } from '../../../config/database';
import { fetchSectorLive } from '../../../pipeline/sources/naverSectorsLive';
import { kstMarket, fetchStockQuotes, type Quote } from './shared';
import { asyncHandler } from '../../../utils/asyncHandler';

const router = Router();

// /quotes 한 요청에서 조회할 수 있는 티커 상한. fetchStockQuotes는 미캐시분을 100개씩
// 나눠 외부(네이버)에 순차 요청하므로 상한이 없으면 요청 하나로 서버를 수 분간 점유하고
// 외부 API에 대한 증폭 수단이 된다. 실제 최대 사용처(차트보드 큐레이션·포트폴리오)가
// 100종목 미만이라 200이면 충분하다.
const MAX_QUOTE_TICKERS = 200;

// 유망 산업 레이더 (경량판) — 섹터별 평균점수·추세 폭·수급을 집계하고 대장주 후보 3종을 뽑는다.
// 완전판(정책·특허·글로벌 CAGR)은 데이터 소스 확보 시 확장 가능.
router.get('/sectors', asyncHandler(async (_req: Request, res: Response) => {
  const db = getDb();

  const [{ rows: sectors }, { rows: leaders }] = await Promise.all([
    db.query(
      `SELECT s.sector,
              COUNT(*)::int AS stock_count,
              ROUND(AVG(sc.total_score))::int AS avg_score,
              ROUND(AVG(CASE WHEN i.above_ma20 THEN 100.0 WHEN i.above_ma20 = FALSE THEN 0.0 END))::int AS breadth_ma20,
              SUM(COALESCE(i.foreign_amt_20d, 0) + COALESCE(i.inst_amt_20d, 0))::bigint AS flow_amt_20d,
              SUM(COALESCE(s.market_cap, 0))::bigint AS total_cap
       FROM stocks s
       LEFT JOIN stock_scores sc ON sc.ticker = s.ticker
       LEFT JOIN stock_indicators i ON i.ticker = s.ticker
       WHERE s.is_active = TRUE AND s.sector IS NOT NULL
       GROUP BY s.sector
       HAVING COUNT(*) >= 3`,
    ),
    // 대장주 경량 공식: 종합점수 50% + 섹터 내 시총 백분위 30% + 섹터 내 20일 수급 백분위 20%
    db.query(
      `WITH base AS (
         SELECT s.ticker, s.name, s.sector, s.market_cap,
                COALESCE(sc.total_score, 0) AS score,
                COALESCE(i.foreign_amt_20d, 0) + COALESCE(i.inst_amt_20d, 0) AS flow20
         FROM stocks s
         LEFT JOIN stock_scores sc ON sc.ticker = s.ticker
         LEFT JOIN stock_indicators i ON i.ticker = s.ticker
         WHERE s.is_active = TRUE AND s.sector IS NOT NULL AND s.market_cap IS NOT NULL
       ),
       scored AS (
         SELECT *,
                score * 0.5
                + PERCENT_RANK() OVER (PARTITION BY sector ORDER BY market_cap) * 100 * 0.3
                + PERCENT_RANK() OVER (PARTITION BY sector ORDER BY flow20) * 100 * 0.2 AS leader_score
         FROM base
       )
       SELECT sector, ticker, name, market_cap,
              ROUND(score)::int AS total_score, ROUND(leader_score)::int AS leader_score
       FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY sector ORDER BY leader_score DESC) AS rn FROM scored) t
       WHERE rn <= 3
       ORDER BY sector, leader_score DESC`,
    ),
  ]);

  const leadersBySector = new Map<string, any[]>();
  for (const l of leaders) {
    const list = leadersBySector.get(l.sector) ?? [];
    list.push({ ticker: l.ticker, name: l.name, marketCap: Number(l.market_cap), totalScore: l.total_score, leaderScore: l.leader_score });
    leadersBySector.set(l.sector, list);
  }

  // 수급 강도는 섹터 시총 대비 비율의 순위 백분위로 정규화 (섹터 크기 편향 제거)
  const withRatio = sectors.map((s) => ({
    ...s,
    flowRatio: Number(s.total_cap) > 0 ? Number(s.flow_amt_20d) / Number(s.total_cap) : 0,
  }));
  const sortedRatios = [...withRatio].sort((a, b) => a.flowRatio - b.flowRatio);
  const flowPct = new Map(sortedRatios.map((s, idx) => [
    s.sector, sortedRatios.length > 1 ? Math.round((idx / (sortedRatios.length - 1)) * 100) : 50,
  ]));

  const base = withRatio.map((s) => {
    const flow = flowPct.get(s.sector) ?? 50;
    const trendScore = Math.round(
      (s.avg_score ?? 50) * 0.4 + (s.breadth_ma20 ?? 50) * 0.3 + flow * 0.3,
    );
    return {
      sector: s.sector,
      stockCount: s.stock_count,
      avgScore: s.avg_score,
      breadthMa20: s.breadth_ma20,       // MA20 상회 종목 비율 (%)
      flowAmt20d: Number(s.flow_amt_20d), // 외인+기관 20일 순매수 금액(원)
      flowStrength: flow,                 // 시총 대비 수급 백분위 (0~100)
      trendScore,                         // EOD 구조 추세
      leaders: (leadersBySector.get(s.sector) ?? []).map((l) => ({ ...l })),
    };
  });

  // 장중 오버레이: 네이버 업종 실시간 등락률·breadth로 순위를 재계산 (수급·재무 구조점수는 EOD 유지).
  const { open, hhmm } = kstMarket();
  if (!open) {
    res.json({ intraday: false, asOf: null, sectors: base.sort((a, b) => b.trendScore - a.trendScore) });
    return;
  }

  const live = await fetchSectorLive();
  // 오늘 등락률 백분위(모멘텀) — 실시간 값이 있는 섹터끼리 정규화
  const withChg = base
    .map((b) => ({ sector: b.sector, chg: live.get(b.sector)?.chgPct }))
    .filter((e): e is { sector: string; chg: number } => e.chg != null);
  const sortedChg = [...withChg].sort((a, b) => a.chg - b.chg);
  const momPct = new Map(sortedChg.map((e, i) => [
    e.sector, sortedChg.length > 1 ? Math.round((i / (sortedChg.length - 1)) * 100) : 50,
  ]));

  // 대장주 실시간 시세 (섹터당 ≤3, 총 ~100종목만 조회)
  const leaderTickers = base.flatMap((b) => b.leaders.map((l) => l.ticker));
  const quotes = await fetchStockQuotes(leaderTickers);

  const rankedSectors = base
    .map((b) => {
      const l = live.get(b.sector);
      const breadthToday = l && l.up + l.down > 0 ? Math.round((l.up / (l.up + l.down)) * 100) : null;
      const momentum = momPct.get(b.sector) ?? 50;
      const liveScore = Math.round(
        (b.avgScore ?? 50) * 0.4 + (breadthToday ?? b.breadthMa20 ?? 50) * 0.3 + momentum * 0.3,
      );
      return {
        ...b,
        todayChgPct: l?.chgPct ?? null,   // 섹터 오늘 등락률 (%)
        breadthToday,                     // 오늘 상승 종목 비율 (%)
        liveScore,                        // 장중 재계산 순위 점수
        leaders: b.leaders.map((ld) => {
          const q = quotes.get(ld.ticker);
          return { ...ld, livePrice: q?.price ?? null, liveChgPct: q?.changePct ?? null };
        }),
      };
    })
    .sort((a, b) => b.liveScore - a.liveScore);

  res.json({ intraday: true, asOf: hhmm, sectors: rankedSectors });
}));

/**
 * 산업 구성종목 — 산업 레이더·거래대금 화면에서 산업을 눌렀을 때 펼칠 목록.
 * 응답 모양을 테마 상세(`/themes/:no`)의 `members`와 **일부러 똑같이** 맞췄다 —
 * 두 화면이 같은 표시 컴포넌트를 공유해 "테마처럼 나오게" 하기 위해서다.
 */
router.get('/sectors/:sector/stocks', asyncHandler(async (req: Request, res: Response) => {
  const sector = String(req.params.sector ?? '').trim();
  if (sector === '') {
    res.status(400).json({ error: '산업명이 필요합니다.' });
    return;
  }

  const db = getDb();
  const { rows: members } = await db.query(
    `SELECT s.ticker, s.name, s.market, s.sector, s.market_cap,
            ROUND(sc.total_score)::int AS total_score,
            i.last_close, i.day_change
     FROM stocks s
     LEFT JOIN stock_scores sc ON sc.ticker = s.ticker
     LEFT JOIN stock_indicators i ON i.ticker = s.ticker
     WHERE s.is_active = TRUE AND s.sector = $1
     ORDER BY sc.total_score DESC NULLS LAST, s.market_cap DESC NULLS LAST`,
    [sector],
  );

  const { open, hhmm } = kstMarket();
  // 장중 실시간 시세는 요청당 상한을 지킨다 — 대형 업종은 200종목을 넘을 수 있다.
  let quotes = new Map<string, Quote>();
  if (open && members.length > 0) {
    quotes = await fetchStockQuotes(members.slice(0, MAX_QUOTE_TICKERS).map((m) => m.ticker));
  }

  res.json({
    sector,
    intraday: open,
    asOf: open ? hhmm : null,
    members: members.map((m) => {
      const q = quotes.get(m.ticker);
      return {
        ticker: m.ticker,
        name: m.name,
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

router.get('/quotes', asyncHandler(async (req: Request, res: Response) => {
  // 중복 제거 후 상한 초과면 400 — 조용히 잘라내면 클라이언트가 일부 종목의 시세만
  // 못 받은 것을 알 수 없어 "실시간인데 값이 없는" 상태로 보인다.
  const tickers = [...new Set(
    String(req.query.tickers ?? '')
      .split(',').map((t) => t.trim()).filter((t) => /^\d{6}$/.test(t)),
  )];
  if (tickers.length === 0) { res.json({}); return; }
  if (tickers.length > MAX_QUOTE_TICKERS) {
    res.status(400).json({ error: `tickers는 최대 ${MAX_QUOTE_TICKERS}개까지 조회할 수 있습니다.` });
    return;
  }

  const quotes = await fetchStockQuotes(tickers);
  const out: Record<string, Quote> = {};
  for (const [t, q] of quotes) out[t] = q;
  res.json(out);
}));

export default router;
