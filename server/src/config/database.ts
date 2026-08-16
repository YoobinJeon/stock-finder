import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { logger } from '../utils/logger';

/**
 * DB 추상화 계층 — 프로젝트의 유일한 DB 진입점.
 * - DATABASE_URL 설정 시: 관리형 PostgreSQL (Neon/Supabase/Railway 등)
 * - 미설정 시: PGlite 로컬 파일 DB (server/data/pglite) — 별도 설치·Docker 불필요
 */
export interface Db {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  /** 멀티 스테이트먼트 SQL 실행 (마이그레이션용) */
  exec(sql: string): Promise<void>;
}

let db: Db | null = null;
let closer: (() => Promise<void>) | null = null;

export async function initDb(): Promise<Db> {
  if (db) return db;

  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = new pg.Pool({ connectionString: url });
    pool.on('error', (err) => logger.error('PostgreSQL pool error', err));
    await pool.query('SELECT 1');
    db = {
      query: async (sql, params) => pool.query(sql, params as any[]),
      exec: async (sql) => { await pool.query(sql); },
    };
    closer = () => pool.end();
    logger.info('DB: PostgreSQL (DATABASE_URL)');
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dataDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../data/pglite',
    );
    fs.mkdirSync(dataDir, { recursive: true });
    const pglite = new PGlite(dataDir);
    await pglite.waitReady;
    db = {
      query: async (sql, params) => {
        const res = await pglite.query(sql, params as any[]);
        return { rows: res.rows as any[] };
      },
      exec: async (sql) => { await pglite.exec(sql); },
    };
    closer = () => pglite.close();
    logger.info(`DB: PGlite 로컬 파일 DB (${dataDir})`);
  }
  return db;
}

/** initDb() 이후에만 호출 가능 (부팅 시 1회 초기화) */
export function getDb(): Db {
  if (!db) throw new Error('DB not initialized — call initDb() first');
  return db;
}

export async function closeDb(): Promise<void> {
  if (closer) await closer();
  db = null;
  closer = null;
}
