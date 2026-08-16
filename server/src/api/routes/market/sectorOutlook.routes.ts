/**
 * 산업 실적 전망 — 산업 하나를 골라 그 기업들의 확정 실적 + 다년 컨센서스를 비교한다.
 *
 * 데이터는 이미 `stock_financials`에 있다(`is_estimate=TRUE`가 애널리스트 전망). 새로 수집하는
 * 것은 없고, **축을 산업 단위로 통일**하고 **증가율·배수를 붙여** 내려보내는 게 이 모듈의 일이다.
 * 축 산출은 `outlook/period.ts`, 증가율·배수는 `outlook/metrics.ts`가 맡고 여기는 HTTP 조립만 한다.
 *
 * ⚠️ 산업 합계(매출·영익 총합)는 내려보내지 않는다 — 애널리스트 커버리지가 산업의 절반 수준이라
 * 합계가 산업 실체를 대표하지 못하고 오독을 부른다(설계 결정 2026-08-11).
 */
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { getDb, type Db } from '../../../config/database';
import { buildAxis, type AxisRow, type PeriodKey, type PeriodType } from './outlook/period';
import {
  attachMetrics, hasUsableEstimate,
  type FinancialRow, type OutlookPeriod,
} from './outlook/metrics';
import { buildCompareRows, type CompareSource, type GrowthBasis } from './outlook/sectorCompare';
import { isPreferredShare } from '../../../utils/shareClass';

const router = Router();

interface SectorRow extends AxisRow {
  name: string;
  market: string | null;
  market_cap: number | null;
  total_score: number | null;
  updated_at: string | null;
  /** 산업 비교에서만 채워진다(종목 표는 산업이 이미 정해져 있다). */
  sector?: string | null;
}

export interface OutlookItem {
  ticker: string;
  name: string;
  market: string | null;
  marketCap: number | null;
  totalScore: number | null;
  /** 축 키(`"2026"` 또는 `"2026Q2"`) → 값. 축에 있어도 그 종목에 데이터가 없으면 키가 없다. */
  periods: Record<string, OutlookPeriod>;
  /** 이 종목에 **값이 있는** 전망 눈금이 하나라도 있는가 — 기본 노출 범위를 가르는 기준. */
  hasEstimate: boolean;
}

function parsePeriodType(raw: unknown): PeriodType {
  return String(raw ?? '') === 'quarter' ? 'quarter' : 'year';
}

/** 분기 축에서만 `qoq`가 뜻을 갖는다 — 연간에서 물어오면 `yoy`로 되돌린다. */
function parseGrowthBasis(raw: unknown, type: PeriodType): GrowthBasis {
  return type === 'quarter' && String(raw ?? '') === 'qoq' ? 'qoq' : 'yoy';
}

/**
 * DB 경계에서 숫자로 못박는다.
 *
 * ⚠️ `revenue`·`operating_income`·`net_income`·`market_cap`은 전부 `bigint` 열이고, PGlite는
 * **JS 안전 정수를 넘는 값만 `BigInt`로** 돌려준다. 그런 행이 실제로 5건 있어서(소노스퀘어
 * 2024Q3 매출 3.7경 등 — 원본 파싱 오류로 보이는 값), TTM 합산에서 `0 + BigInt`가 되어
 * "Cannot mix BigInt and other types"로 500이 났다(2026-08-11 전수 스캔에서 발견).
 * 대부분의 행이 `number`로 와서 단위 테스트로는 절대 재현되지 않는다.
 */
function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalize(row: SectorRow): FinancialRow {
  return {
    fiscal_year: Number(row.fiscal_year),
    fiscal_quarter: row.fiscal_quarter == null ? null : Number(row.fiscal_quarter),
    is_estimate: row.is_estimate,
    revenue: toNumber(row.revenue),
    operating_income: toNumber(row.operating_income),
    net_income: toNumber(row.net_income),
  };
}

/** 두 라우트가 같은 열을 읽는다 — 한쪽만 열이 바뀌면 축·배수 계산이 갈린다. */
const FINANCIAL_SELECT = `s.ticker, s.name, s.market, s.market_cap, s.sector,
          ROUND(sc.total_score)::int AS total_score,
          f.fiscal_year, f.fiscal_quarter, f.is_estimate,
          f.revenue, f.operating_income, f.net_income, f.updated_at`;

/**
 * 재무 행을 읽는다. `sector`가 null이면 **전 산업**(산업 비교용).
 *
 * 분기 축은 증가율 기준점(전년 동기 = 4분기 전)과 TTM(직전 4분기 합)이 축 밖 과거를 참조하므로
 * **기간을 자르지 않고 해당 축의 행을 전부 받아** 메모리에서 정리한다.
 */
async function loadRows(db: Db, periodType: PeriodType, sector: string | null): Promise<SectorRow[]> {
  const quarterFilter = periodType === 'quarter'
    ? 'f.fiscal_quarter IS NOT NULL'
    : 'f.fiscal_quarter IS NULL';
  const sectorFilter = sector == null ? 's.sector IS NOT NULL' : 's.sector = $1';

  const { rows } = await db.query(
    `SELECT ${FINANCIAL_SELECT}
     FROM stocks s
     JOIN stock_financials f ON f.ticker = s.ticker AND ${quarterFilter}
     LEFT JOIN stock_scores sc ON sc.ticker = s.ticker
     WHERE s.is_active = TRUE AND ${sectorFilter}
     ORDER BY s.ticker, f.fiscal_year, f.fiscal_quarter`,
    sector == null ? [] : [sector],
  );
  return rows as SectorRow[];
}

/** 종목별로 묶어 증가율·배수를 붙인다. */
function buildItems(
  rows: readonly SectorRow[], axis: readonly PeriodKey[], periodType: PeriodType,
): OutlookItem[] {
  const byTicker = new Map<string, SectorRow[]>();
  for (const r of rows) {
    const list = byTicker.get(r.ticker);
    if (list) list.push(r);
    else byTicker.set(r.ticker, [r]);
  }

  const items: OutlookItem[] = [];
  for (const [ticker, periodRows] of byTicker) {
    const head = periodRows[0];
    const marketCap = toNumber(head.market_cap);
    const periods = attachMetrics(
      periodRows.map(normalize), axis, periodType,
      // ⚠️ 우선주는 배수를 만들지 않는다. 시총은 그 클래스만인데 이익은 회사 전체라 PER·POR이
      // 보통주 대비 중앙 32배 낮게 나온다(`utils/shareClass.ts`). 보통주 시총을 합쳐
      // 회사 단위 배수를 낼 수도 있지만, 그러면 보통주 행과 **똑같은 숫자**가 되어 같은 회사가
      // 두 번 세어질 뿐이다 — 그 숫자는 바로 옆 보통주 행이 이미 말하고 있다.
      isPreferredShare(ticker) ? null : marketCap,
    );
    items.push({
      ticker,
      name: head.name,
      market: head.market,
      // 시총 자체는 그대로 내려보낸다 — 우선주의 실제 시총이고, 표의 '시총' 열은 맞는 값이다.
      marketCap,
      totalScore: head.total_score,
      periods,
      hasEstimate: hasUsableEstimate(periods),
    });
  }
  return items;
}

/**
 * 재무의 마지막 적재 시각 — 컨센서스가 언제 기준인지 화면이 알 수 있게.
 * 갱신은 18:10 전체 수집(`ingestFinancials`가 `updated_at = NOW()`로 upsert)이 맡는다.
 */
function latestUpdatedAt(rows: readonly SectorRow[]): string | null {
  return rows.reduce<string | null>(
    (max, r) => (r.updated_at && (max == null || r.updated_at > max) ? r.updated_at : max),
    null,
  );
}

/**
 * `GET /market/outlook?sector=<정확한 업종명>&period=year|quarter`
 *
 * 세 항목(매출·영업이익·순이익)을 한 번에 내려보낸다 — 화면의 항목 토글이 재조회 없이 즉시
 * 전환되게 하기 위함이다. 한 산업이 수백 종목을 넘지 않아 응답이 가볍다.
 */
router.get('/outlook', asyncHandler(async (req: Request, res: Response) => {
  const sector = String(req.query.sector ?? '').trim();
  if (!sector) {
    res.status(400).json({ error: 'sector는 필수입니다.' });
    return;
  }
  const periodType = parsePeriodType(req.query.period);

  const db = getDb();

  // 업종에 속한 활성 종목 수 — 커버리지("166종목 중 82종목 전망 보유")의 분모.
  const { rows: countRows } = await db.query(
    'SELECT COUNT(*)::int AS n FROM stocks WHERE is_active = TRUE AND sector = $1',
    [sector],
  );
  const totalCount: number = countRows[0]?.n ?? 0;
  if (totalCount === 0) {
    res.json({
      sector, periodType, periods: [], basePeriod: null,
      updatedAt: null, totalCount: 0, coveredCount: 0, items: [],
    });
    return;
  }

  const all = await loadRows(db, periodType, sector);
  const axis = buildAxis(all, periodType);
  const items = buildItems(all, axis, periodType);

  res.json({
    sector,
    periodType,
    periods: axis,
    basePeriod: axis[0]?.key ?? null,
    updatedAt: latestUpdatedAt(all),
    totalCount,
    coveredCount: items.filter((i) => i.hasEstimate).length,
    items,
  });
}));

/**
 * `GET /market/outlook/sectors?period=year|quarter&basis=yoy|qoq` — **산업 × 기간 매트릭스**.
 *
 * 종목 표가 대답하지 못하는 질문("내년 매출이 가장 많이 늘 산업은 어디인가")을 위한 갈래다.
 * 칸은 그 산업 종목들의 **중앙값** — 합계를 쓰지 않는 이유는 `outlook/sectorCompare.ts` 참고.
 *
 * ⚠️ **축은 산업별이 아니라 전 시장 하나로 잡는다.** 매트릭스는 열이 산업마다 같아야 비교가
 * 성립한다. `buildAxis`는 기준 눈금을 최빈값으로 잡으므로 결산이 앞선 소수 종목이 축을 끌어가지
 * 않는다(레드팀). 대신 12월 결산이 아닌 소수 종목은 자기 눈금이 이 축과 어긋날 수 있다 —
 * 국내 상장사 대부분이 12월 결산이라 허용 범위로 둔다(과 같은 판단).
 */
router.get('/outlook/sectors', asyncHandler(async (req: Request, res: Response) => {
  const periodType = parsePeriodType(req.query.period);
  const basis = parseGrowthBasis(req.query.basis, periodType);
  const db = getDb();

  // 산업별 활성 **회사** 수 — 커버리지의 분모. 재무가 없는 회사도 분모에는 들어간다.
  // `ticker LIKE '%0'`은 보통주만 세겠다는 뜻이다(`utils/shareClass.ts`의 판정과 같은 규칙) —
  // 분자를 회사 단위로 세면서 분모만 클래스 단위로 세면 `12/11` 같은 커버리지가 나온다.
  const { rows: countRows } = await db.query(
    `SELECT sector, COUNT(*)::int AS n
       FROM stocks WHERE is_active = TRUE AND sector IS NOT NULL AND ticker LIKE '%0'
      GROUP BY sector`,
  );
  const totalBySector = new Map<string, number>();
  for (const r of countRows as Array<{ sector: string; n: number }>) {
    totalBySector.set(r.sector, Number(r.n));
  }

  const all = await loadRows(db, periodType, null);
  const axis = buildAxis(all, periodType);

  const bySector = new Map<string, SectorRow[]>();
  for (const r of all) {
    const sector = r.sector;
    if (!sector) continue;
    const list = bySector.get(sector);
    if (list) list.push(r);
    else bySector.set(sector, [r]);
  }

  const sources: CompareSource[] = [];
  for (const [sector, rows] of bySector) {
    sources.push({
      sector,
      totalCount: totalBySector.get(sector) ?? rows.length,
      // ⚠️ 우선주를 빼고 센다. 우선주는 **별개 기업이 아니라 같은 회사의 다른 클래스**라
      // 재무가 보통주와 완전히 같다 — 넣으면 우선주가 있는 회사만 증가율 표본에 두 번
      // 들어가고, 배수는 왜곡된 값까지 섞인다. 중앙값은 회사 단위로 세야 뜻이 있다.
      items: buildItems(rows.filter((r) => !isPreferredShare(r.ticker)), axis, periodType),
    });
  }

  res.json({
    periodType,
    basis,
    periods: axis,
    updatedAt: latestUpdatedAt(all),
    rows: buildCompareRows(sources, axis, basis),
  });
}));

export default router;
