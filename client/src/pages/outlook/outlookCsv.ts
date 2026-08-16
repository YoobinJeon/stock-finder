import { csvLine, todayStamp } from '../../shared/lib/csv';
import { downloadCsv } from '../../shared/lib/downloadCsv';
import {
  METRICS, deltaOf, periodHeaderLabel, periodKindOf,
  type GrowthBasis, type OutlookItem, type PeriodKey, type PeriodType,
} from './outlookTypes';

const BASIS_TAG: Record<GrowthBasis, string> = { yoy: 'YoY', qoq: 'QoQ' };

/** 키로 찾는다 — 위치(`METRICS[0]`)로 잡으면 항목 순서를 바꿨을 때 조용히 어긋난다. */
const SPEC = new Map(METRICS.map((m) => [m.key, m]));

/**
 * 산업 실적 전망 CSV.
 *
 * 화면은 고른 항목만 보여주지만 **CSV는 전 항목(매출·영익·순익·PER·POR)을 함께** 낸다 —
 * 스프레드시트로 가져가는 이유가 화면에서 못 하는 교차 비교이기 때문이다.
 *
 * 금액은 **억 단위 숫자만** 적는다(접미어 없음). '1.2조' 같은 표기는 사람이 읽기엔 좋지만
 * 스프레드시트에서 계산이 안 된다. 증가율도 마찬가지로 % 기호 없이 숫자로 낸다.
 *
 * 확정/전망은 **열 위치가 아니라 행마다** `구분` 열로 적는다. 같은 눈금이라도 종목에 따라
 * 확정일 수도 전망일 수도 있어서(결산 시점 차이), 헤더 하나로 단정하면 전망치가 확정 실적으로
 * 읽힌다(2026-08-11 레드팀).
 */
export function downloadOutlookCsv(
  sector: string,
  periodType: PeriodType,
  periods: readonly PeriodKey[],
  items: readonly OutlookItem[],
  growthBasis: GrowthBasis,
): void {
  const eok = (won: number | null) => (won == null ? '' : Math.round(won / 1e8));
  const pct = (v: number | null) => (v == null ? '' : Number((v * 100).toFixed(1)));
  const mult = (v: number | null) => (v == null ? '' : Number(v.toFixed(2)));

  const basis = BASIS_TAG[growthBasis];
  const header = ['종목', '티커', '시총(억)'];
  for (const period of periods) {
    const tag = periodHeaderLabel(period, periodKindOf(items, period.key));
    header.push(
      `${tag} 구분`,
      `${tag} 매출(억)`, `${tag} 매출성장률(${basis},%)`,
      `${tag} 영업이익(억)`, `${tag} 영익성장률(${basis},%)`,
      `${tag} 순이익(억)`, `${tag} 순익성장률(${basis},%)`,
      `${tag} PER(배)`, `${tag} POR(배)`,
    );
  }

  const lines = [csvLine(header)];
  for (const it of items) {
    const cells: unknown[] = [it.name, it.ticker, eok(it.marketCap)];
    for (const period of periods) {
      const c = it.periods[period.key];
      if (!c) {
        cells.push('', '', '', '', '', '', '', '', '');
        continue;
      }
      // 증가율이 성립하지 않는 흑자전환 구간은 숫자 대신 글자로 — 빈칸과 구분되어야 한다.
      const growth = (key: 'revenue' | 'operatingIncome' | 'netIncome') => {
        const spec = SPEC.get(key);
        const d = spec ? deltaOf(spec, c, growthBasis) : null;
        if (d?.turnaround) return '흑자전환';
        return pct(d?.growth ?? null);
      };
      cells.push(
        c.isEstimate ? 'E' : 'A',
        eok(c.revenue), growth('revenue'),
        eok(c.operatingIncome), growth('operatingIncome'),
        eok(c.netIncome), growth('netIncome'),
        mult(c.per), mult(c.por),
      );
    }
    lines.push(csvLine(cells));
  }

  // 파일명에 산업명과 축 종류를 넣어 여러 번 받아도 섞이지 않게 한다.
  const axisTag = periodType === 'quarter' ? '분기' : '연간';
  downloadCsv(`실적전망_${sector}_${axisTag}_${todayStamp()}.csv`, lines);
}
