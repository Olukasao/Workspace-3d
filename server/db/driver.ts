/**
 * Camada fina de acesso a dados com dois drivers: MariaDB (produção) e SQLite embutido do Node (caminho local reproduzível).
 * O SQL do projeto é escrito no subconjunto comum aos dois (placeholders `?`, tipos portáteis, sem recursos específicos).
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Config } from '../config';

export type Row = Record<string, unknown>;
export type Param = string | number | null;

export interface Db {
  dialect: 'sqlite' | 'mariadb';
  query<T = Row>(sql: string, params?: Param[]): Promise<T[]>;
  exec(sql: string, params?: Param[]): Promise<{ affected: number }>;
  /** Executa `fn` em uma transação; qualquer erro desfaz tudo. */
  tx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  isUniqueViolation(e: unknown): boolean;
  close(): Promise<void>;
}

export async function one<T = Row>(db: Db, sql: string, params: Param[] = []): Promise<T | null> {
  const rows = await db.query<T>(sql, params);
  return rows[0] ?? null;
}

// ---------- SQLite (node:sqlite) ----------

async function openSqlite(file: string): Promise<Db> {
  // createRequire: o Vite/Vitest ainda não reconhece "node:sqlite" como módulo nativo em import dinâmico
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  const run = {
    query<T>(sql: string, params: Param[] = []): T[] {
      return raw.prepare(sql).all(...params) as T[];
    },
    exec(sql: string, params: Param[] = []): { affected: number } {
      if (!params.length && /;\s*\S/.test(sql)) {
        raw.exec(sql);
        return { affected: 0 };
      }
      return { affected: Number(raw.prepare(sql).run(...params).changes) };
    },
  };
  const isUniqueViolation = (e: unknown) => /UNIQUE constraint failed|PRIMARY KEY/i.test((e as Error)?.message ?? '');

  // Uma única conexão: todas as operações passam por uma fila, e a transação ocupa a fila inteira.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };
  const inner: Db = {
    dialect: 'sqlite',
    query: async (sql, params) => run.query(sql, params),
    exec: async (sql, params) => run.exec(sql, params),
    tx: (fn) => fn(inner),
    isUniqueViolation,
    close: async () => undefined,
  };
  return {
    dialect: 'sqlite',
    query: (sql, params) => enqueue(() => run.query(sql, params)),
    exec: (sql, params) => enqueue(() => run.exec(sql, params)),
    tx: <T>(fn: (tx: Db) => Promise<T>) =>
      enqueue(async () => {
        raw.exec('BEGIN IMMEDIATE');
        try {
          const out = await fn(inner);
          raw.exec('COMMIT');
          return out;
        } catch (e) {
          raw.exec('ROLLBACK');
          throw e;
        }
      }),
    isUniqueViolation,
    close: async () => raw.close(),
  };
}

// ---------- MariaDB (mysql2) ----------

async function openMariaDb(cfg: Config['mariadb']): Promise<Db> {
  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectionLimit: 10,
    charset: 'utf8mb4',
    multipleStatements: false,
    // affectedRows passa a contar linhas ENCONTRADAS (não só as alteradas): as checagens de versão dependem disso
    flags: ['+FOUND_ROWS'],
  });
  type Conn = { query: (sql: string, params?: Param[]) => Promise<[unknown, unknown]> };
  const wrap = (conn: Conn, inTx: boolean): Db => ({
    dialect: 'mariadb',
    async query<T>(sql: string, params: Param[] = []) {
      const [rows] = await conn.query(sql, params);
      return rows as T[];
    },
    async exec(sql: string, params: Param[] = []) {
      const [res] = await conn.query(sql, params);
      return { affected: Number((res as { affectedRows?: number }).affectedRows ?? 0) };
    },
    async tx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      if (inTx) return fn(this);
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const out = await fn(wrap(c as unknown as Conn, true));
        await c.commit();
        return out;
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    },
    isUniqueViolation: (e: unknown) => (e as { code?: string })?.code === 'ER_DUP_ENTRY',
    close: async () => {
      if (!inTx) await pool.end();
    },
  });
  return wrap(pool as unknown as Conn, false);
}

export async function openDb(cfg: Config): Promise<Db> {
  return cfg.dbDriver === 'mariadb' ? openMariaDb(cfg.mariadb) : openSqlite(cfg.sqlitePath);
}
