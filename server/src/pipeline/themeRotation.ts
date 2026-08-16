/**
 * 테마 일별 스냅샷(theme_daily_snapshots) → 로테이션(모멘텀·연속상승·누적수익률) 계산 (순수 함수).
 * DB I/O 없음 — 라우트가 스냅샷 행을 조회해 이 함수에 넘긴다.
 */

export interface ThemeSnapRow {
  theme_no: number;
  name: string;
  snap_date: string;
  chg_pct: number | string | null;
  up_cnt: number | null;
  total_cnt: number | null;
}

export interface ThemeRotationResult {
  themeNo: number;
  name: string;
  recentAvg: number;    // 최근 3일(가용 범위) 평균 등락률
  prevAvg: number;      // 그 이전 5일 평균 (없으면 0)
  momentum: number;     // recentAvg − prevAvg
  upStreak: number;     // 최신일부터 연속 chg_pct>0 일수
  cumReturnPct: number; // 전체 기간 (1+r) 누적곱 − 1
  lastChgPct: number | null;
  lastUpCnt: number | null;
  lastTotalCnt: number | null;
}

const RECENT_WINDOW = 3;
const PREV_WINDOW = 5;

/**
 * null/undefined는 null로, DECIMAL 문자열은 숫자로 변환. Number(null)=0 함정을 피하기 위해
 * null 여부를 먼저 판별한다.
 */
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function calcThemeRotation(rows: ThemeSnapRow[]): ThemeRotationResult[] {
  const byTheme = new Map<number, ThemeSnapRow[]>();
  for (const row of rows) {
    const group = byTheme.get(row.theme_no) ?? [];
    group.push(row);
    byTheme.set(row.theme_no, group);
  }

  const results: ThemeRotationResult[] = [];
  for (const group of byTheme.values()) {
    const sorted = [...group].sort((a, b) => a.snap_date.localeCompare(b.snap_date));
    const latest = sorted[sorted.length - 1];

    // chg_pct가 null인 날은 평균·누적·streak 계산에서 완전히 제외한다.
    const validChron = sorted
      .map((r) => toNum(r.chg_pct))
      .filter((chg): chg is number => chg != null);

    const recentWindow = validChron.slice(-RECENT_WINDOW);
    const prevWindow = validChron.slice(
      Math.max(0, validChron.length - RECENT_WINDOW - PREV_WINDOW),
      Math.max(0, validChron.length - RECENT_WINDOW),
    );

    const recentAvg = avg(recentWindow);
    const prevAvg = prevWindow.length > 0 ? avg(prevWindow) : 0;
    const momentum = prevWindow.length > 0 ? recentAvg - prevAvg : recentAvg;

    // 최신 유효일부터 역순으로 연속 상승(chg_pct>0) 일수를 센다.
    let upStreak = 0;
    for (let i = validChron.length - 1; i >= 0; i--) {
      if (validChron[i] > 0) upStreak += 1;
      else break;
    }

    let cumFactor = 1;
    for (const chg of validChron) cumFactor *= 1 + chg / 100;
    const cumReturnPct = (cumFactor - 1) * 100;

    results.push({
      themeNo: latest.theme_no,
      name: latest.name,
      recentAvg,
      prevAvg,
      momentum,
      upStreak,
      cumReturnPct,
      lastChgPct: toNum(latest.chg_pct),
      lastUpCnt: latest.up_cnt,
      lastTotalCnt: latest.total_cnt,
    });
  }

  return results;
}
