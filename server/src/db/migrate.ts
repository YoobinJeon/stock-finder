import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../config/database';
import { logger } from '../utils/logger';

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

/** 미적용 마이그레이션만 순서대로 실행 (부팅 시 자동 호출, 멱등) */
export async function runMigrations(): Promise<void> {
  const db = getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await db.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [file],
    );
    if (rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await db.exec(sql);
    await db.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    logger.info(`Migration applied: ${file}`);
  }
}
