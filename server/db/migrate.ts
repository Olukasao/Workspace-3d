import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from './driver';

const DIR = path.resolve(import.meta.dirname, '../migrations');

/** Aplica as migrações pendentes (arquivos NNN_nome.sql em ordem). Devolve os nomes aplicados. */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(80) NOT NULL PRIMARY KEY, applied_at BIGINT NOT NULL)');
  const done = new Set((await db.query<{ version: string }>('SELECT version FROM schema_migrations')).map((r) => r.version));
  const applied: string[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(path.join(DIR, file), 'utf8')
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    const statements = sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean);
    for (const st of statements) await db.exec(st);
    await db.exec('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [file, Date.now()]);
    applied.push(file);
  }
  return applied;
}

/** Remove todas as tabelas do projeto (usado por `npm run db:reset` e pelos testes). */
export async function dropAll(db: Db): Promise<void> {
  const tables = ['print_jobs', 'ticket_transfers', 'service_tickets', 'chat_messages', 'chat_conversations', 'idempotency_keys', 'action_audit', 'remote_access_requests', 'remote_access_grants',
    'integration_bindings', 'managed_devices', 'seat_assignments', 'asset_definitions', 'office_revisions', 'offices', 'floors', 'buildings', 'sessions', 'users', 'employees', 'companies', 'schema_migrations'];
  for (const t of tables) await db.exec(`DROP TABLE IF EXISTS ${t}`);
}
