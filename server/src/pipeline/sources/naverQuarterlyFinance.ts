import { getJson, num } from '../http';
import { logger } from '../../utils/logger';

/**
 * 네이버 모바일 분기 재무 API (`finance/quarter`) — **분기 이력 백필 전용** 소스.
 *
 * 왜 별도 소스가 필요한가: 주 소스인 와이즈리포트(`naverConsensus.fetchQuarterlyConsensus`)는
 * 확정 분기를 **항상 4개만** 돌려준다(sDT를 과거로 바꿔도 창이 고정임을 실측 확인).
 * 전년 동분기 비교(YoY)는 Q(t)와 Q(t-4), 즉 **확정 분기 5개**가 있어야 성립하므로 그 창으로는
 * 어떤 종목도 영업이익 YoY를 낼 수 없다. 이 API는 확정 5개 + 컨센서스 1개를 주어 딱 그
 * 모자란 한 분기를 메운다(KOSPI·KOSDAQ·외국계 전부 동일 확인).
 *
 * 소비처(`ingestFinancials`)는 이 결과를 **주 소스 창보다 오래된 분기에만** 적용한다 —
 * 선단(최신 분기)을 건드리면 어닝 서프라이즈의 E→A 전환 감지가 이 소스의 선삽입에
 * 가려 사라질 수 있기 때문이다.
 */

export interface QuarterlyFinancePoint {
  fiscalYear: number;
  fiscalQuarter: number;
  /** TRUE = 컨센서스(전망치) */
  isEstimate: boolean;
  revenue: number | null;          // 원
  operatingIncome: number | null;  // 원
  netIncome: number | null;        // 원
  eps: number | null;              // 원
  per: number | null;
  pbr: number | null;
  bps: number | null;              // 원
  roe: number | null;              // 소수 (0.15 = 15%)
}

const EOK = 1e8; // 이 API의 금액 단위는 억원

const quarterUrl = (ticker: string) =>
  `https://m.stock.naver.com/api/stock/${ticker}/finance/quarter`;

/** 분기 말월(03/06/09/12) → 분기 번호. 그 외 월은 형식 이상으로 보고 버린다. */
const QUARTER_BY_END_MONTH: Record<string, number> = { '03': 1, '06': 2, '09': 3, '12': 4 };

function scale(v: number | null, factor: number): number | null {
  return v == null ? null : Math.round(v * factor);
}

/** DECIMAL(8,2) 컬럼 범위를 벗어나는 이상치는 버림 (naverFinancials.ts clamp()와 동일 관례) */
function clamp(v: number | null, max = 99999): number | null {
  return v != null && Math.abs(v) <= max ? v : null;
}

function frac(v: number | null): number | null {
  return v == null ? null : v / 100;
}

/**
 * `finance/quarter` 응답 → 분기 포인트 배열 (순수 함수 — 네트워크 없음).
 *
 * 응답 형태는 `finance/annual`과 같다: `trTitleList`가 열(분기), `rowList`가 행(계정과목)이고
 * 값은 `columns[key].value`에 억원 단위 문자열로 들어온다. 결측은 `"-"`이며 `num()`이 null로
 * 거른다(음수 `"-1,234"`는 정상 파싱됨).
 */
export function parseQuarterlyFinance(payload: unknown): QuarterlyFinancePoint[] {
  const info = (payload as { financeInfo?: { trTitleList?: unknown[]; rowList?: unknown[] } })
    ?.financeInfo;
  if (!info) return [];

  const columns = (info.trTitleList ?? [])
    .map((t) => t as { key?: unknown; isConsensus?: unknown })
    .filter((t) => t?.key != null)
    .map((t) => {
      const key = String(t.key);
      return {
        key,
        fiscalYear: Number(key.slice(0, 4)),
        fiscalQuarter: QUARTER_BY_END_MONTH[key.slice(4, 6)],
        isEstimate: t.isConsensus === 'Y',
      };
    })
    .filter((c) => Number.isFinite(c.fiscalYear) && c.fiscalYear > 1990 && c.fiscalQuarter != null);

  const rowMap = new Map<string, Record<string, { value?: unknown }>>();
  for (const raw of info.rowList ?? []) {
    const row = raw as { title?: unknown; columns?: Record<string, { value?: unknown }> };
    if (row?.title) rowMap.set(String(row.title), row.columns ?? {});
  }
  const val = (title: string, key: string) => num(rowMap.get(title)?.[key]?.value);

  return columns
    .map((c) => ({
      fiscalYear: c.fiscalYear,
      fiscalQuarter: c.fiscalQuarter,
      isEstimate: c.isEstimate,
      revenue: scale(val('매출액', c.key), EOK),
      operatingIncome: scale(val('영업이익', c.key), EOK),
      netIncome: scale(val('당기순이익', c.key), EOK),
      eps: val('EPS', c.key),
      per: clamp(val('PER', c.key)),
      pbr: clamp(val('PBR', c.key)),
      bps: val('BPS', c.key),
      roe: frac(clamp(val('ROE', c.key))),
    }))
    .sort((a, b) => a.fiscalYear - b.fiscalYear || a.fiscalQuarter - b.fiscalQuarter);
}

/**
 * 종목의 분기 재무 이력 수집. 실패 시 빈 배열(fail-soft) — 이 소스는 백필 보조라
 * 실패해도 주 소스의 분기 수집은 그대로 진행돼야 한다.
 */
export async function fetchQuarterlyFinance(ticker: string): Promise<QuarterlyFinancePoint[]> {
  try {
    return parseQuarterlyFinance(await getJson(quarterUrl(ticker)));
  } catch (e: unknown) {
    logger.warn(
      `분기 재무 백필 수집 (${ticker}) 실패, 건너뜀: ${e instanceof Error ? e.message : String(e)}`,
    );
    return [];
  }
}
