import { getDb } from '../config/database';
import { logger } from '../utils/logger';
import { fetchEtfCandles } from './sources/naverEtfDetail';
import { fetchEtfList } from './sources/naverEtf';
import { calcTrendState } from './etfTrendState';
import { getEffectiveBoardList } from './etfCuration';

// 차트보드와 동일한 일봉 수 — MA60·정배열 연속일수 판정에 필요한 만큼 확보
const CANDLE_COUNT = 260;
// 네이버 요청 부하 분산 — board 라우트와 동일 청크 크기
const CHUNK = 4;

/** 현재 KST 날짜 (YYYY-MM-DD) — etfSnapshot.ts kstToday와 동일 계산 방식 */
function kstToday(): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * 차트보드 큐레이션 ETF(기본 31종 + 사용자 커스텀 구성)의 오늘 국면(state)을 etf_phase_history에 적재.
 * ON CONFLICT (ticker, snap_date) DO UPDATE — 재실행해도 안전 (멱등).
 * 캔들 조회 실패(0개) 종목은 스킵, 행별 실패는 건너뛰고 개수만 집계해 warn 1줄로 남긴다.
 * @returns 적재(삽입/갱신)된 행 수
 */
export async function snapshotEtfPhases(): Promise<number> {
  const db = getDb();
  const snapDate = kstToday();
  const list = await fetchEtfList();
  const byTicker = new Map(list.map((e) => [e.ticker, e]));
  const boardList = await getEffectiveBoardList(db);

  let saved = 0;
  let failed = 0;

  for (let i = 0; i < boardList.length; i += CHUNK) {
    const chunk = boardList.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async ({ ticker }) => {
        try {
          const candles = await fetchEtfCandles(ticker, CANDLE_COUNT);
          if (candles.length === 0) return; // 조회 실패 종목은 스킵

          const name = byTicker.get(ticker)?.name ?? ticker;
          const trend = calcTrendState(candles);

          await db.query(
            `INSERT INTO etf_phase_history
               (ticker, snap_date, name, state, aligned_streak, recent_exit)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (ticker, snap_date) DO UPDATE SET
               name = EXCLUDED.name,
               state = EXCLUDED.state,
               aligned_streak = EXCLUDED.aligned_streak,
               recent_exit = EXCLUDED.recent_exit`,
            [ticker, snapDate, name, trend.state, trend.alignedStreak, trend.recentExit],
          );
          saved += 1;
        } catch {
          failed += 1;
        }
      }),
    );
  }

  if (failed > 0) {
    logger.warn(`ETF 국면 이력 저장 중 ${failed}건 실패 (전체 ${boardList.length}건)`);
  }
  logger.info(`ETF 국면 이력 저장 완료: ${saved}/${boardList.length}건 (${snapDate})`);
  return saved;
}
