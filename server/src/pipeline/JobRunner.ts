import { logger } from '../utils/logger';

export interface JobStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  scope: string | null;
  phase: string | null;
  total: number;
  done: number;
  failed: string[];
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

/** 인메모리 수집 잡 상태 — 동시 1개 잡만 허용, UI 폴링용 진행률 제공 */
export class JobRunner {
  private state: JobStatus = emptyState();

  isRunning(): boolean {
    return this.state.status === 'running';
  }

  /** 실행 중이면 false 반환 (409 처리용) */
  start(scope: string, fn: (job: JobRunner) => Promise<void>): boolean {
    if (this.isRunning()) return false;

    this.state = {
      ...emptyState(),
      status: 'running',
      scope,
      phase: '준비',
      startedAt: new Date().toISOString(),
    };

    fn(this)
      .then(() => {
        this.state.status = 'done';
        logger.info(`데이터 수집 완료 (${scope}) — 실패 ${this.state.failed.length}건`);
      })
      .catch((err) => {
        this.state.status = 'error';
        this.state.error = err?.message ?? String(err);
        logger.error('데이터 수집 실패', err);
      })
      .finally(() => {
        this.state.finishedAt = new Date().toISOString();
      });

    return true;
  }

  setPhase(phase: string, total = 0): void {
    this.state.phase = phase;
    this.state.total = total;
    this.state.done = 0;
  }

  tick(failedTicker?: string): void {
    this.state.done++;
    if (failedTicker) this.state.failed.push(failedTicker);
  }

  getStatus(): JobStatus {
    return { ...this.state, failed: [...this.state.failed] };
  }
}

function emptyState(): JobStatus {
  return {
    status: 'idle',
    scope: null,
    phase: null,
    total: 0,
    done: 0,
    failed: [],
    startedAt: null,
    finishedAt: null,
    error: null,
  };
}

/** 서버 프로세스 전역 싱글턴 */
export const jobRunner = new JobRunner();
