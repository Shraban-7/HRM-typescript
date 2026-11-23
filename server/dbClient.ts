import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { convertSqliteDdlToPostgres, translateQueryForPg } from './sqlTranslate';

const { Pool, types } = pg;

// Ensure PostgreSQL BIGINT (COUNT(*), SUM) and NUMERIC values decode as JS numbers
types.setTypeParser(20, (val: string) => parseInt(val, 10));
types.setTypeParser(1700, (val: string) => parseFloat(val));

export type DatabaseMode = 'supabase-postgres' | 'sqlite';

export class DatabaseConfigError extends Error {
  readonly code: string;
  constructor(message: string, code = 'database_not_configured') {
    super(message);
    this.name = 'DatabaseConfigError';
    this.code = code;
  }
}

export interface RunResult {
  lastInsertRowid: number;
  changes: number;
}

export interface AsyncPreparedStatement {
  get: <T = Record<string, unknown>>(...params: unknown[]) => Promise<T | undefined>;
  all: <T = Record<string, unknown>>(...params: unknown[]) => Promise<T[]>;
  run: (...params: unknown[]) => Promise<RunResult>;
}

interface SqliteDbLike {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
    run: (...params: unknown[]) => { lastInsertRowid?: number | bigint; changes?: number };
  };
}

declare global {
  var _nexusPgPool: pg.Pool | undefined;
  var _nexusSqliteDb: SqliteDbLike | undefined;
}

function getPostgresConnectionString(): string | null {
  const raw = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '').trim();
  if (!raw) return null;
  if (!raw.startsWith('postgres://') && !raw.startsWith('postgresql://')) {
    return null;
  }
  return raw;
}

export function getDatabaseMode(): DatabaseMode {
  return getPostgresConnectionString() ? 'supabase-postgres' : 'sqlite';
}

function buildPgPoolConfig(connectionString: string): pg.PoolConfig {
  const parsed = new URL(connectionString);
  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : 5432;
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const database = parsed.pathname.replace(/^\/+/, '') || 'postgres';
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  // Use explicit object config so Supabase ?sslmode=require query params do NOT override
  // rejectUnauthorized: false and cause SELF_SIGNED_CERT_IN_CHAIN 500 errors on Vercel.
  return {
    host,
    port,
    user,
    password,
    database,
    max: process.env.VERCEL ? 4 : 10,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 15_000,
    ssl: isLocalHost ? false : { rejectUnauthorized: false },
  };
}

function getPgPool(): pg.Pool {
  if (!globalThis._nexusPgPool) {
    const connectionString = getPostgresConnectionString();
    if (!connectionString) {
      throw new DatabaseConfigError(
        'PostgreSQL DATABASE_URL or SUPABASE_DB_URL is not configured.',
        'database_not_configured'
      );
    }

    globalThis._nexusPgPool = new Pool(buildPgPoolConfig(connectionString));

    globalThis._nexusPgPool.on('error', (err) => {
      console.error('[Nexus HRM Postgres Pool Error]', err.message);
    });
  }
  return globalThis._nexusPgPool;
}

function resolveSqlitePath(): string {
  if (process.env.HRM_DB_PATH) return process.env.HRM_DB_PATH;
  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), 'nexus-hrm.sqlite');
  }
  const localPath = path.resolve(process.cwd(), 'data', 'nexus-hrm.sqlite');
  try {
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    return localPath;
  } catch {
    return path.join(os.tmpdir(), 'nexus-hrm.sqlite');
  }
}

async function getSqliteDb(): Promise<SqliteDbLike> {
  if (!globalThis._nexusSqliteDb) {
    let sqliteMod: { DatabaseSync: new (filePath: string) => unknown };
    try {
      // Dynamic import keeps node:sqlite out of Vercel/Supabase PostgreSQL runtimes
      sqliteMod = (await import('node:sqlite')) as unknown as {
        DatabaseSync: new (filePath: string) => unknown;
      };
    } catch {
      throw new DatabaseConfigError(
        'DATABASE_URL (PostgreSQL connection string) is required in this serverless environment because built-in node:sqlite is unavailable on this Node.js runtime. Set DATABASE_URL in Vercel Environment Variables.',
        'database_not_configured'
      );
    }
    const dbPath = resolveSqlitePath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const instance = new sqliteMod.DatabaseSync(dbPath) as SqliteDbLike;
    instance.exec('PRAGMA journal_mode = WAL;');
    instance.exec('PRAGMA foreign_keys = ON;');
    globalThis._nexusSqliteDb = instance;
  }
  return globalThis._nexusSqliteDb;
}

export const db = {
  getMode(): DatabaseMode {
    return getDatabaseMode();
  },

  async exec(ddlSql: string): Promise<void> {
    if (getDatabaseMode() === 'supabase-postgres') {
      const pool = getPgPool();
      const pgDdl = convertSqliteDdlToPostgres(ddlSql);
      // Execute individual DDL statements cleanly for PgBouncer transaction pooler compatibility
      const statements = pgDdl
        .split(/;\s*\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const stmt of statements) {
        await pool.query(stmt);
      }
      return;
    }
    const sqlite = await getSqliteDb();
    sqlite.exec(ddlSql);
  },

  async withSeedLock<T>(fn: () => Promise<T>): Promise<T> {
    if (getDatabaseMode() === 'supabase-postgres') {
      const pool = getPgPool();
      const lockClient = await pool.connect();
      const LOCK_ID = 84729104;
      try {
        await lockClient.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
        return await fn();
      } finally {
        try {
          await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
        } catch {
          // ignore unlock error on closed socket
        }
        lockClient.release();
      }
    }
    return fn();
  },

  prepare(sql: string): AsyncPreparedStatement {
    return {
      async get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined> {
        if (getDatabaseMode() === 'supabase-postgres') {
          const pool = getPgPool();
          const pgSql = translateQueryForPg(sql);
          const result = await pool.query(pgSql, params);
          return result.rows[0] as T | undefined;
        }
        const sqlite = await getSqliteDb();
        return sqlite.prepare(sql).get(...params) as T | undefined;
      },

      async all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]> {
        if (getDatabaseMode() === 'supabase-postgres') {
          const pool = getPgPool();
          const pgSql = translateQueryForPg(sql);
          const result = await pool.query(pgSql, params);
          return result.rows as T[];
        }
        const sqlite = await getSqliteDb();
        return sqlite.prepare(sql).all(...params) as T[];
      },

      async run(...params: unknown[]): Promise<RunResult> {
        if (getDatabaseMode() === 'supabase-postgres') {
          const pool = getPgPool();
          const pgSql = translateQueryForPg(sql, { appendReturningId: true });
          const result = await pool.query(pgSql, params);
          const returnedId =
            result.rows && result.rows.length > 0 && result.rows[0]?.id !== undefined
              ? Number(result.rows[0].id)
              : 0;
          return {
            lastInsertRowid: returnedId,
            changes: result.rowCount ?? 0,
          };
        }
        const sqlite = await getSqliteDb();
        const info = sqlite.prepare(sql).run(...params);
        return {
          lastInsertRowid: Number(info.lastInsertRowid ?? 0),
          changes: Number(info.changes ?? 0),
        };
      },
    };
  },

  async transaction<T>(
    fn: (tx: { prepare: (sql: string) => AsyncPreparedStatement }) => Promise<T>
  ): Promise<T> {
    if (getDatabaseMode() === 'supabase-postgres') {
      const pool = getPgPool();
      const client = await pool.connect();
      const tx = {
        prepare(sql: string): AsyncPreparedStatement {
          return {
            async get<R = Record<string, unknown>>(...params: unknown[]): Promise<R | undefined> {
              const result = await client.query(translateQueryForPg(sql), params);
              return result.rows[0] as R | undefined;
            },
            async all<R = Record<string, unknown>>(...params: unknown[]): Promise<R[]> {
              const result = await client.query(translateQueryForPg(sql), params);
              return result.rows as R[];
            },
            async run(...params: unknown[]): Promise<RunResult> {
              const result = await client.query(
                translateQueryForPg(sql, { appendReturningId: true }),
                params
              );
              const returnedId =
                result.rows && result.rows.length > 0 && result.rows[0]?.id !== undefined
                  ? Number(result.rows[0].id)
                  : 0;
              return { lastInsertRowid: returnedId, changes: result.rowCount ?? 0 };
            },
          };
        },
      };
      try {
        await client.query('BEGIN');
        const value = await fn(tx);
        await client.query('COMMIT');
        return value;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    const sqlite = await getSqliteDb();
    sqlite.exec('BEGIN');
    try {
      const value = await fn(db);
      sqlite.exec('COMMIT');
      return value;
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  },
};
