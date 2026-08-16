/**
 * 수집 루프 공통 상수. `ingest.ts`에 두면 잎 모듈(ingestFlows·ingestRs 등)이 되돌아
 * import하게 돼 순환이 생기므로 따로 뺀다.
 * (2026-07-26 ingest.ts 분할 — 800줄 규칙)
 */

export const CONCURRENCY = 5;      // 티커 동시 처리 수
export const BATCH_DELAY_MS = 300; // 배치 간 딜레이 (politeness)
export const SCORE_BATCH = 20;
