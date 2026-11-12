/** Uso: tsx server/db/cli.ts migrate | seed | reset */
import { loadConfig } from '../config';
import { openDb } from './driver';
import { dropAll, migrate } from './migrate';
import { seed } from './seed';

const cmd = process.argv[2];
const cfg = loadConfig();
const db = await openDb(cfg);
try {
  if (cmd === 'reset') {
    await dropAll(db);
    console.log('Tabelas removidas.');
  }
  if (cmd === 'migrate' || cmd === 'seed' || cmd === 'reset') {
    const applied = await migrate(db);
    console.log(applied.length ? `Migrações aplicadas: ${applied.join(', ')}` : 'Nenhuma migração pendente.');
  }
  if (cmd === 'seed' || cmd === 'reset') {
    const r = await seed(db);
    console.log(r.created ? 'Dados de demonstração criados.' : 'Dados já existiam; catálogo sincronizado.');
  }
  if (!['migrate', 'seed', 'reset'].includes(cmd ?? '')) {
    console.error('Uso: tsx server/db/cli.ts migrate | seed | reset');
    process.exitCode = 1;
  }
  console.log(`Banco: ${cfg.dbDriver}${cfg.dbDriver === 'sqlite' ? ` (${cfg.sqlitePath})` : ` (${cfg.mariadb.host}:${cfg.mariadb.port}/${cfg.mariadb.database})`}`);
} finally {
  await db.close();
}
