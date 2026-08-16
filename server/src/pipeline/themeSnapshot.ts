import { getDb } from '../config/database';
import { logger } from '../utils/logger';
import { fetchThemeListLive } from './sources/naverThemes';

/** 현재 KST 날짜 (YYYY-MM-DD) — scheduler.ts kstNow류와 동일 계산 방식 */
function kstToday(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * 네이버 테마 266개 실시간 등락률을 오늘 날짜로 스냅샷 적재.
 * ON CONFLICT (theme_no, snap_date) DO UPDATE — 재실행해도 안전 (멱등).
 * 주말에도 함수 자체는 그대로 동작 (스킵 여부는 호출부/크론이 결정).
 * 행별 insert 실패는 건너뛰고 개수만 집계해 warn 1줄로 남긴다.
 * @returns 적재(삽입/갱신)된 행 수
 */
export async function snapshotThemesDaily(): Promise<number> {
  const db = getDb();
  const snapDate = kstToday();
  const items = await fetchThemeListLive();

  let saved = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await db.query(
        `INSERT INTO theme_daily_snapshots
           (theme_no, snap_date, name, chg_pct, up_cnt, down_cnt, total_cnt)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (theme_no, snap_date) DO UPDATE SET
           name = EXCLUDED.name,
           chg_pct = EXCLUDED.chg_pct,
           up_cnt = EXCLUDED.up_cnt,
           down_cnt = EXCLUDED.down_cnt,
           total_cnt = EXCLUDED.total_cnt`,
        [item.no, snapDate, item.name, item.chgPct, item.up, item.down, item.total],
      );
      saved += 1;
    } catch {
      failed += 1;
    }
  }

  if (failed > 0) {
    logger.warn(`테마 스냅샷 저장 중 ${failed}건 실패 (전체 ${items.length}건)`);
  }
  logger.info(`테마 스냅샷 저장 완료: ${saved}/${items.length}건 (${snapDate})`);
  return saved;
}
