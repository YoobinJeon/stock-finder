import { Router, Request, Response, NextFunction } from 'express';
import { getDb } from '../../config/database';
import { asyncHandler } from '../../utils/asyncHandler';
import { UUID_RE } from '../../utils/uuid';

const router = Router();

// 프리셋 id는 UUID 컬럼 — 형식 오류를 Postgres까지 흘려 500이 되지 않도록 400으로 거른다.
router.param('id', (_req: Request, res: Response, next: NextFunction, id: string) => {
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: '잘못된 전략 id 형식' });
    return;
  }
  next();
});

// 발굴 서브점수(discovery_score) —. 모멘텀·수급(flow) 카테고리 엔진 점수를 breakdown
// JSONB에서 뽑아 재정규화. flow가 없는 과거 점수(rescore 이전)는 모멘텀 단독으로 폴백한다.
const DISCOVERY_MOMENTUM_WEIGHT = 0.7;
const DISCOVERY_FLOW_WEIGHT = 0.3;
/** stock_scores.breakdown(JSONB 배열)에서 category별 점수를 뽑아 발굴 서브점수를 계산하는 SQL 식.
 * SELECT 목록과 ORDER BY(SORT_MAP)가 동일 문자열을 공유 — 컬럼 별칭 의존 없이 그대로 재사용 가능. */
const DISCOVERY_SCORE_SQL = `
  CASE
    WHEN ds.momentum_score IS NULL THEN NULL
    WHEN ds.flow_score IS NULL THEN ROUND(ds.momentum_score)
    ELSE ROUND(ds.momentum_score * ${DISCOVERY_MOMENTUM_WEIGHT} + ds.flow_score * ${DISCOVERY_FLOW_WEIGHT})
  END
`;

/**
 * 분기 실적 개선 조건(스크리너 실적 개선 필터) — 기간별 SQL 조각.
 *
 * "개선" 자체의 판정(매출·영업이익 동반 증가, 흑자전환 인정)은 `earningsTrend.ts` 순수 함수가
 * 내려 `*_improving` 불리언으로 적재돼 있다. 여기서는 그 불리언을 그대로 쓰고, 사용자가 최소
 * 증가율을 지정했을 때만 저장된 증가율에 추가 조건을 건다 — 판정 규칙을 SQL에 다시 쓰지 않는다.
 *
 * 흑자전환은 직전 값이 0 이하라 증가율(%)이 존재하지 않으므로, 임계값을 걸어도 통과시킨다
 * (적자 → 흑자는 어떤 증가율보다 큰 개선으로 본다).
 */
const EARNINGS_TREND_PERIODS = {
  yoy: { improving: 'et.yoy_improving', revenue: 'et.revenue_yoy', op: 'et.op_yoy', turnaround: 'et.op_yoy_turnaround' },
  qoq: { improving: 'et.qoq_improving', revenue: 'et.revenue_qoq', op: 'et.op_qoq', turnaround: 'et.op_qoq_turnaround' },
} as const;

export type EarningsTrendPeriod = keyof typeof EARNINGS_TREND_PERIODS;

/**
 * 필터 모드 → 적용할 기간 목록 (화이트리스트 — 알 수 없는 값은 조건 없음).
 * 평범한 객체가 아니라 Map인 이유: `modes['constructor']`는 프로토타입 체인을 타고
 * `Object`를 돌려주므로 `?? []` 폴백이 먹지 않는다(그 값이 그대로 순회 대상이 되어 500).
 */
const EARNINGS_TREND_MODES = new Map<string, EarningsTrendPeriod[]>([
  ['yoy', ['yoy']],
  ['qoq', ['qoq']],
  ['both', ['yoy', 'qoq']],
]);

/**
 * 신뢰하지 않는 요청 바디 → 적용할 기간과 최소 증가율.
 *
 * 모드 문자열은 **화이트리스트 조회로만** 기간으로 바뀐다 — 이 값이 SQL 컬럼명을 고르므로
 * 임의 문자열이 새면 안 된다. 임계값은 유한한 수가 아니면 무시한다(NaN이 파라미터로 들어가면
 * 비교가 전부 false가 되어 조용히 0건이 나온다).
 */
export function resolveEarningsTrendFilter(
  mode: unknown,
  minGrowth: unknown,
): { periods: EarningsTrendPeriod[]; growthFloor: number | null } {
  const periods = typeof mode === 'string' ? EARNINGS_TREND_MODES.get(mode) ?? [] : [];
  const n = Number(minGrowth);
  return {
    periods,
    growthFloor: minGrowth != null && minGrowth !== '' && Number.isFinite(n) ? n : null,
  };
}

/**
 * 스크리닝 검색.
 * 필터: market, sector, minScore + 재무 조건(maxPer, minOpMargin %, minRevenueGrowth %,
 *       minDivYield %, minMarketCap 원) — 재무 조건은 최신 확정 연간 실적(f) 기준.
 *       실적 개선 조건(earningsTrend, minEarningsGrowth %)만 분기 기준(et).
 */
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const {
    market,
    sector,
    minScore,
    maxPer,
    minOpMargin,
    minRevenueGrowth,
    minDivYield,
    minMarketCap,
    // 분기 실적 개선 조건 (stock_earnings_trend)
    earningsTrend,
    minEarningsGrowth,
    minEarningsStreak,   // 연속 개선 분기 수 (YoY 기준)
    estImproving,        // 다음 분기 컨센서스도 개선인 종목만
    // 수급 조건 (stock_indicators)
    foreignNetBuy5d,
    instNetBuy5d,
    minForeignStreak,
    // 기술 조건
    goldenCross,
    aboveMa20,
    earlyTrend,
    maxPctFrom52wHigh,
    rsiMin,
    rsiMax,
    minVolRatio,
    // 추세 지표 확장 (거장 전략 정밀화 — MA150/200·52주 저점 대비·RS 백분위)
    aboveMa150,
    aboveMa200,
    ma150AboveMa200,
    ma200Up,
    minPctFrom52wLow,
    minRsPercentile,
    q,               // 종목명/코드 검색
    sort,            // 정렬 컬럼 (SORT_MAP 화이트리스트)
    order,           // asc | desc
    page = 1,
    pageSize = 20,
  } = req.body;

  const conditions: string[] = ['s.is_active = TRUE'];
  const params: any[] = [];
  const add = (value: any, sql: (n: number) => string) => {
    params.push(value);
    conditions.push(sql(params.length));
  };

  if (q && String(q).trim()) {
    add(`%${String(q).trim()}%`, (n) => `(s.name ILIKE $${n} OR s.ticker LIKE $${n})`);
  }
  if (market)                { add(market, (n) => `s.market = $${n}`); }
  if (sector)                { add(`%${sector}%`, (n) => `s.sector ILIKE $${n}`); }
  if (minScore != null)      { add(Number(minScore), (n) => `sc.total_score >= $${n}`); }
  if (minMarketCap != null)  { add(Number(minMarketCap), (n) => `s.market_cap >= $${n}`); }
  if (maxPer != null)        { add(Number(maxPer), (n) => `f.per > 0 AND f.per <= $${n}`); }
  if (minOpMargin != null) {
    add(Number(minOpMargin), (n) =>
      `(CASE WHEN f.revenue > 0 THEN f.operating_income::numeric * 100 / f.revenue END) >= $${n}`);
  }
  if (minRevenueGrowth != null) { add(Number(minRevenueGrowth), (n) => `f.revenue_growth * 100 >= $${n}`); }
  if (minDivYield != null)      { add(Number(minDivYield), (n) => `f.div_yield * 100 >= $${n}`); }

  // 분기 실적 개선 — 판정 행이 없는 종목은 LEFT JOIN으로 NULL이 되어 자연히 제외된다.
  const { periods: trendPeriods, growthFloor } =
    resolveEarningsTrendFilter(earningsTrend, minEarningsGrowth);
  // 연속 개선·컨센서스 조건은 기간 모드와 독립이다 — 모드를 안 골라도 단독으로 걸 수 있다.
  if (minEarningsStreak != null && Number.isFinite(Number(minEarningsStreak))) {
    add(Number(minEarningsStreak), (n) => `et.yoy_streak >= $${n}`);
  }
  if (estImproving === true) {
    // 확정 판정에서 고른 기준(YoY/QoQ/둘 다)을 컨센서스에도 그대로 적용한다 — 표에는 두 기준이
    // 다 보이는데 필터만 YoY를 보면 결과와 화면이 어긋난다. 기준 미선택 시엔 YoY로 본다.
    const estColumns = (trendPeriods.length > 0 ? trendPeriods : (['yoy'] as const))
      .map((p) => (p === 'yoy' ? 'et.est_yoy_improving' : 'et.est_qoq_improving'));
    for (const col of estColumns) conditions.push(`${col} = TRUE`);
  }
  for (const period of trendPeriods) {
    const col = EARNINGS_TREND_PERIODS[period];
    conditions.push(`${col.improving} = TRUE`);
    if (growthFloor != null) {
      add(growthFloor, (n) =>
        `(${col.revenue} * 100 >= $${n} AND (${col.turnaround} = TRUE OR ${col.op} * 100 >= $${n}))`);
    }
  }

  // 수급 조건 (금액 기준)
  if (foreignNetBuy5d === true)  { conditions.push('i.foreign_amt_5d > 0'); }
  if (instNetBuy5d === true)     { conditions.push('i.inst_amt_5d > 0'); }
  if (minForeignStreak != null)  { add(Number(minForeignStreak), (n) => `i.foreign_buy_streak >= $${n}`); }

  // 기술 조건
  if (goldenCross === true)      { conditions.push('i.golden_cross = TRUE'); }
  if (aboveMa20 === true)        { conditions.push('i.above_ma20 = TRUE'); }
  if (earlyTrend === true)       { conditions.push('i.early_trend = TRUE'); }
  if (maxPctFrom52wHigh != null) { add(-Math.abs(Number(maxPctFrom52wHigh)), (n) => `i.pct_from_52w_high >= $${n}`); }
  if (rsiMin != null)            { add(Number(rsiMin), (n) => `i.rsi14 >= $${n}`); }
  if (rsiMax != null)            { add(Number(rsiMax), (n) => `i.rsi14 <= $${n}`); }
  if (minVolRatio != null)       { add(Number(minVolRatio), (n) => `i.vol_ratio >= $${n}`); }

  // 추세 지표 확장 조건 (above/ma150AboveMa200은 저장된 불리언 없이 컬럼 비교로 판정 — NULL 비교는
  // 자연히 false 취급되어 이평 봉 수 부족 종목은 자동 제외됨)
  if (aboveMa150 === true)       { conditions.push('i.last_close > i.ma150'); }
  if (aboveMa200 === true)       { conditions.push('i.last_close > i.ma200'); }
  if (ma150AboveMa200 === true)  { conditions.push('i.ma150 > i.ma200'); }
  if (ma200Up === true)          { conditions.push('i.ma200_up = TRUE'); }
  if (minPctFrom52wLow != null)  { add(Number(minPctFrom52wLow), (n) => `i.pct_from_52w_low >= $${n}`); }
  if (minRsPercentile != null)   { add(Number(minRsPercentile), (n) => `i.rs_percentile >= $${n}`); }

  const where = conditions.join(' AND ');
  // 비정상 입력(NaN·음수) 클램프 — malformed 페이지네이션으로 SQL 오류(500) 방지
  const pageNum = Number.isFinite(Number(page)) ? Math.max(1, Math.floor(Number(page))) : 1;
  const sizeNum = Number.isFinite(Number(pageSize))
    ? Math.min(Math.max(1, Math.floor(Number(pageSize))), 3000)
    : 20;
  const offset = (pageNum - 1) * sizeNum;

  const scoreSubquery = `
    LEFT JOIN LATERAL (
      SELECT total_score, breakdown FROM stock_scores
      WHERE ticker = s.ticker ORDER BY scored_at DESC LIMIT 1
    ) sc ON TRUE
  `;

  // 최신 확정 실적 (tPER·매출·영업이익·성장률·배당) + 첫 컨센서스 연도 (fPER·가이던스)
  const financialSubqueries = `
    LEFT JOIN LATERAL (
      SELECT fiscal_year, revenue, operating_income, per, revenue_growth, div_yield
      FROM stock_financials
      WHERE ticker = s.ticker AND fiscal_quarter IS NULL AND is_estimate = FALSE
      ORDER BY fiscal_year DESC LIMIT 1
    ) f ON TRUE
    LEFT JOIN LATERAL (
      SELECT fiscal_year, revenue, operating_income, per
      FROM stock_financials
      WHERE ticker = s.ticker AND fiscal_quarter IS NULL AND is_estimate = TRUE
      ORDER BY fiscal_year ASC LIMIT 1
    ) e ON TRUE
    LEFT JOIN stock_indicators i ON i.ticker = s.ticker
    LEFT JOIN stock_earnings_trend et ON et.ticker = s.ticker
  `;

  // 발굴 서브점수 원료 — sc.breakdown(JSONB 배열)에서 momentum/flow 카테고리 점수만 뽑아낸다.
  // COUNT 쿼리에는 불필요(정렬에만 쓰임)해 메인 SELECT에서만 조인한다.
  const discoveryScoreSubquery = `
    LEFT JOIN LATERAL (
      SELECT
        MAX(CASE WHEN elem->>'category' = 'momentum' THEN (elem->>'score')::numeric END) AS momentum_score,
        MAX(CASE WHEN elem->>'category' = 'flow'     THEN (elem->>'score')::numeric END) AS flow_score
      FROM jsonb_array_elements(COALESCE(sc.breakdown, '[]'::jsonb)) elem
    ) ds ON TRUE
  `;

  // 정렬 화이트리스트 (SQL 인젝션 방지 — 키만 허용)
  const SORT_MAP: Record<string, string> = {
    score:          'sc.total_score',
    discovery_score: DISCOVERY_SCORE_SQL,
    market_cap:     's.market_cap',
    revenue:        'f.revenue',
    operating_income: 'f.operating_income',
    op_margin:      '(CASE WHEN f.revenue > 0 THEN f.operating_income::numeric / f.revenue END)',
    trailing_per:   'f.per',
    forward_per:    'e.per',
    div_yield:      'f.div_yield',
    revenue_growth: 'f.revenue_growth',
    yoy_prev_revenue: 'et.yoy_prev_revenue',
    qoq_prev_revenue: 'et.qoq_prev_revenue',
    eq_yoy_prev_revenue: 'et.est_yoy_prev_revenue',
    eq_revenue:     'et.est_revenue',
    trend_revenue:  'et.base_revenue',
    trend_op:       'et.base_operating_income',
    revenue_yoy:    'et.revenue_yoy',
    op_yoy:         'et.op_yoy',
    revenue_qoq:    'et.revenue_qoq',
    op_qoq:         'et.op_qoq',
    yoy_streak:     'et.yoy_streak',
    qoq_streak:     'et.qoq_streak',
    eq_revenue_yoy: 'et.est_revenue_yoy',
    eq_op_yoy:      'et.est_op_yoy',
    eq_revenue_qoq: 'et.est_revenue_qoq',
    eq_op_qoq:      'et.est_op_qoq',
    close:          'i.last_close',
    day_change:     'i.day_change',
    pct_52w:        'i.pct_from_52w_high',
    pct_52w_low:    'i.pct_from_52w_low',
    rs_percentile:  'i.rs_percentile',
    foreign_5d:     'i.foreign_amt_5d',
    macd_hist:      'i.macd_hist',
    atr_pct:        'i.atr_pct',
    turnover_surge: 'i.turnover_surge',
    f_score:        'i.f_score',
    name:           's.name',
  };
  const sortExpr = SORT_MAP[String(sort)] ?? SORT_MAP.score;
  const dir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const { rows: countRows } = await getDb().query(
    `SELECT COUNT(*) as total FROM stocks s ${scoreSubquery} ${financialSubqueries} WHERE ${where}`,
    params,
  );
  const total = Number(countRows[0].total);

  params.push(sizeNum, offset);

  const { rows } = await getDb().query(
    `SELECT s.ticker, s.name, s.market, s.sector, s.market_cap,
            ROUND(sc.total_score)::int AS total_score, sc.breakdown,
            ${DISCOVERY_SCORE_SQL}::int AS discovery_score,
            f.fiscal_year   AS fin_year,
            f.revenue       AS revenue,
            f.operating_income AS operating_income,
            f.per           AS trailing_per,
            e.fiscal_year   AS est_year,
            e.revenue       AS est_revenue,
            e.operating_income AS est_operating_income,
            e.per           AS forward_per,
            i.foreign_amt_5d, i.inst_amt_5d, i.foreign_buy_streak,
            i.rsi14, i.pct_from_52w_high, i.golden_cross,
            i.last_close, i.day_change,
            i.ma150, i.ma200, i.ma200_up, i.pct_from_52w_low, i.rs_percentile,
            i.macd_hist, i.atr_pct, i.turnover_surge, i.f_score, i.f_score_max,
            et.base_year AS trend_year, et.base_quarter AS trend_quarter,
            et.base_revenue AS trend_revenue,
            et.base_operating_income AS trend_operating_income,
            et.yoy_prev_revenue, et.yoy_prev_operating_income,
            et.qoq_prev_revenue, et.qoq_prev_operating_income,
            et.revenue_yoy, et.op_yoy, et.op_yoy_turnaround, et.yoy_improving,
            et.revenue_qoq, et.op_qoq, et.op_qoq_turnaround, et.qoq_improving,
            et.yoy_streak, et.qoq_streak,
            et.est_yoy_improving, et.est_qoq_improving,
            -- eq_* = 분기 컨센서스. 접두어를 나눈 이유: 위의 est_*는 이미 **연간** 가이던스
            -- (e.fiscal_year/e.revenue 등)에 쓰여, 같은 이름을 쓰면 한 SELECT 안에서 중복
            -- 컬럼이 되어 뒤 값이 앞 값을 조용히 덮는다.
            et.est_year AS eq_year, et.est_quarter AS eq_quarter,
            et.est_revenue AS eq_revenue, et.est_operating_income AS eq_operating_income,
            et.est_revenue_yoy AS eq_revenue_yoy, et.est_op_yoy AS eq_op_yoy,
            et.est_op_yoy_turnaround AS eq_op_yoy_turnaround,
            et.est_revenue_qoq AS eq_revenue_qoq, et.est_op_qoq AS eq_op_qoq,
            et.est_op_qoq_turnaround AS eq_op_qoq_turnaround,
            et.est_yoy_prev_revenue AS eq_yoy_prev_revenue,
            et.est_yoy_prev_operating_income AS eq_yoy_prev_operating_income,
            et.est_qoq_prev_revenue AS eq_qoq_prev_revenue,
            et.est_qoq_prev_operating_income AS eq_qoq_prev_operating_income
     FROM stocks s
     ${scoreSubquery}
     ${financialSubqueries}
     ${discoveryScoreSubquery}
     WHERE ${where}
     ORDER BY ${sortExpr} ${dir} NULLS LAST, s.name
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  res.json({ data: rows, page: pageNum, pageSize: sizeNum, total });
}));

router.get('/sectors', asyncHandler(async (_req: Request, res: Response) => {
  const { rows } = await getDb().query(
    `SELECT DISTINCT sector FROM stocks
     WHERE is_active = TRUE AND sector IS NOT NULL AND sector <> ''
     ORDER BY sector`,
  );
  res.json(rows.map((r: any) => r.sector));
}));

// ── 전략(프리셋) CRUD ──────────────────────────────────────────

router.get('/presets', asyncHandler(async (_req: Request, res: Response) => {
  const { rows } = await getDb().query(
    'SELECT * FROM screener_presets ORDER BY is_builtin DESC, created_at',
  );
  res.json(rows);
}));

router.post('/presets', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, criteria } = req.body ?? {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: '전략 이름이 필요합니다.' });
    return;
  }
  const { rows } = await getDb().query(
    `INSERT INTO screener_presets (name, description, criteria)
     VALUES ($1, $2, $3) RETURNING *`,
    [name.trim(), description ?? null, JSON.stringify(sanitizeCriteria(criteria))],
  );
  res.status(201).json(rows[0]);
}));

router.put('/presets/:id', asyncHandler(async (req: Request, res: Response) => {
  const { name, description, criteria } = req.body ?? {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: '전략 이름이 필요합니다.' });
    return;
  }
  const { rows } = await getDb().query(
    `UPDATE screener_presets
     SET name = $2, description = $3, criteria = $4, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [req.params.id, name.trim(), description ?? null, JSON.stringify(sanitizeCriteria(criteria))],
  );
  if (!rows[0]) { res.status(404).json({ error: '전략을 찾을 수 없습니다.' }); return; }
  res.json(rows[0]);
}));

router.delete('/presets/:id', asyncHandler(async (req: Request, res: Response) => {
  const { rows } = await getDb().query(
    'DELETE FROM screener_presets WHERE id = $1 RETURNING id',
    [req.params.id],
  );
  if (!rows[0]) { res.status(404).json({ error: '전략을 찾을 수 없습니다.' }); return; }
  res.json({ deleted: rows[0].id });
}));

/** 허용된 숫자/문자/불리언 조건만 통과 (임의 키 저장 방지) */
function sanitizeCriteria(raw: unknown): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  if (raw == null || typeof raw !== 'object') return out;
  const c = raw as Record<string, unknown>;
  if (typeof c.market === 'string' && ['KOSPI', 'KOSDAQ'].includes(c.market)) out.market = c.market;
  if (typeof c.earningsTrend === 'string' && EARNINGS_TREND_MODES.has(c.earningsTrend)) {
    out.earningsTrend = c.earningsTrend;
  }
  for (const key of [
    'minScore', 'maxPer', 'minOpMargin', 'minRevenueGrowth', 'minDivYield', 'minMarketCap',
    'minForeignStreak', 'maxPctFrom52wHigh', 'rsiMin', 'rsiMax', 'minVolRatio',
    'minPctFrom52wLow', 'minRsPercentile', 'minEarningsGrowth', 'minEarningsStreak',
  ] as const) {
    const n = Number(c[key]);
    if (c[key] != null && c[key] !== '' && Number.isFinite(n)) out[key] = n;
  }
  for (const key of [
    'foreignNetBuy5d', 'instNetBuy5d', 'goldenCross', 'aboveMa20', 'earlyTrend',
    'aboveMa150', 'aboveMa200', 'ma150AboveMa200', 'ma200Up', 'estImproving',
  ] as const) {
    if (c[key] === true) out[key] = true;
  }
  return out;
}

export default router;
