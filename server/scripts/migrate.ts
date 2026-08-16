import 'dotenv/config';
import { initDb, closeDb } from '../src/config/database';
import { runMigrations } from '../src/db/migrate';

/** 수동 마이그레이션 실행 (서버 부팅 시 자동 실행되므로 보통 불필요) */
async function main() {
  await initDb();
  await runMigrations();
  console.log('마이그레이션 완료.');
  await closeDb();
}

main().catch((err) => {
  console.error('마이그레이션 실패:', err);
  process.exit(1);
});
