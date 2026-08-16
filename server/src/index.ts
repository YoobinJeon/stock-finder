import 'dotenv/config';
import { createApp } from './config/app';
import { initDb, closeDb } from './config/database';
import { runMigrations } from './db/migrate';
import { startScheduler } from './pipeline/scheduler';
import { logger } from './utils/logger';

const PORT = Number(process.env.PORT) || 4000;

async function main() {
  await initDb();
  await runMigrations();
  logger.info('Database ready');

  const app = createApp();

  const server = app.listen(PORT, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
  });

  startScheduler();

  const shutdown = async () => {
    logger.info('Shutting down...');
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // 최후의 안전망 — Node 20의 기본 동작(--unhandled-rejections=throw)은 미처리 프로미스
  // 거부 하나에 프로세스를 종료시킨다. PGlite는 단일 프로세스라 종료 = 서비스 전면 중단이고
  // 복구는 수동 재시작뿐이다. 라우트는 asyncHandler로 개별 처리하되, 파이프라인·크론에서
  // 새는 거부까지 커버하도록 여기서 잡아 로그만 남기고 프로세스는 살려둔다.
  process.on('unhandledRejection', (reason) => {
    logger.error('미처리 프로미스 거부 — 프로세스는 유지합니다', reason);
  });
  process.on('uncaughtException', (err) => {
    logger.error('미처리 예외 — 프로세스는 유지합니다', err);
  });
}

main().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
