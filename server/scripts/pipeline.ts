import 'dotenv/config';
import { initDb, closeDb } from '../src/config/database';
import { runMigrations } from '../src/db/migrate';
import { JobRunner } from '../src/pipeline/JobRunner';
import { runIngest, INGEST_SCOPES, IngestScope } from '../src/pipeline/ingest';

/**
 * CLI 수집 실행: npm run pipeline -- --scope=top200|kospi|all
 * DATABASE_URL을 지정하면 클라우드 DB(Neon 등)로 직접 적재 (로컬 푸시 모드).
 */
const scopeArg = process.argv.find((a) => a.startsWith('--scope='))?.split('=')[1] ?? 'top200';

if (!INGEST_SCOPES.includes(scopeArg as IngestScope)) {
  console.error(`사용법: npm run pipeline -- --scope=${INGEST_SCOPES.join('|')}`);
  process.exit(1);
}
const scope = scopeArg as IngestScope;

async function main() {
  await initDb();
  await runMigrations();

  const job = new JobRunner();
  console.log(`데이터 수집 시작 (scope=${scope})${process.env.DATABASE_URL ? ' → 원격 DB' : ' → 로컬 PGlite'}`);

  await new Promise<void>((resolve, reject) => {
    job.start(scope, (j) => runIngest(scope, j));
    const timer = setInterval(() => {
      const s = job.getStatus();
      process.stdout.write(
        `\r[${s.phase ?? '...'}] ${s.done}/${s.total || '?'} (실패 ${s.failed.length})   `,
      );
      if (s.status === 'done') { clearInterval(timer); resolve(); }
      if (s.status === 'error') { clearInterval(timer); reject(new Error(s.error ?? '알 수 없는 오류')); }
    }, 500);
  });

  const final = job.getStatus();
  console.log(`\n수집 완료 — 실패 ${final.failed.length}건${final.failed.length ? `: ${final.failed.slice(0, 10).join(', ')}${final.failed.length > 10 ? ' …' : ''}` : ''}`);
  await closeDb();
}

main().catch((e) => {
  console.error('\n오류:', e.message);
  process.exit(1);
});
