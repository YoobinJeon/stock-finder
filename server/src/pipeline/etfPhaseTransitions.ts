/**
 * etf_phase_history 행 배열 → 국면 전환 이벤트 목록 (순수 함수).
 * DB I/O 없음 — 라우트가 최근 snap_date 행을 조회해 이 함수에 넘긴다.
 */

export interface PhaseRow {
  ticker: string;
  name: string;
  snap_date: string;
  state: string;
}

export interface PhaseTransition {
  ticker: string;
  name: string;
  date: string;
  from: string;
  to: string;
}

/**
 * 티커별로 날짜 오름차순 정렬 후 인접한 두 날짜의 state가 다르면 전환 이벤트로 기록한다.
 * 같은 날 중복 행은 없음(ticker+snap_date PK). 중간에 결측일이 있어도 남아있는 두 날짜를
 * 그대로 인접 비교한다 (건너뛴 날짜는 무시).
 * 반환은 date 내림차순 → 같은 날짜 내 ticker 오름차순. 티커별로 스냅샷이 하루뿐이면
 * 비교 대상이 없어 전환이 생기지 않는다.
 */
export function calcPhaseTransitions(rows: PhaseRow[]): PhaseTransition[] {
  const byTicker = new Map<string, PhaseRow[]>();
  for (const row of rows) {
    const group = byTicker.get(row.ticker) ?? [];
    group.push(row);
    byTicker.set(row.ticker, group);
  }

  const transitions: PhaseTransition[] = [];
  for (const group of byTicker.values()) {
    const sorted = [...group].sort((a, b) => a.snap_date.localeCompare(b.snap_date));
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.state === curr.state) continue;
      transitions.push({
        ticker: curr.ticker,
        name: curr.name,
        date: curr.snap_date,
        from: prev.state,
        to: curr.state,
      });
    }
  }

  return transitions.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    return a.ticker.localeCompare(b.ticker);
  });
}
