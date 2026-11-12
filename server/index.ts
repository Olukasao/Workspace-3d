import { createApp } from './app';
import { loadConfig } from './config';
import { openDb } from './db/driver';
import { migrate } from './db/migrate';
import { seed } from './db/seed';

const cfg = loadConfig();
const db = await openDb(cfg);
const applied = await migrate(db);
if (applied.length) console.log(`Migrações aplicadas: ${applied.join(', ')}`);
// modo demonstração: garante as contas e a cena fictícias (não duplica); fora dele, só sincroniza o catálogo
if (cfg.demoMode) {
  const r = await seed(db);
  if (r.created) console.log('Dados de demonstração criados.');
} else {
  const { syncCatalog } = await import('./db/seed');
  await syncCatalog(db);
}

const { app, ctx } = createApp(cfg, db);
const server = app.listen(cfg.port, () => {
  console.log(`Office 3D API em http://localhost:${cfg.port}  (banco: ${cfg.dbDriver}, modo demonstração: ${cfg.demoMode ? 'sim' : 'não'})`);
  console.log(`Conectores: ${ctx.integrations.status().map((s) => `${s.id}=${s.mode}/${s.state}`).join('  ')}`);
});

// retenção dos documentos de impressão
const purge = setInterval(() => void ctx.purgePrintFiles?.().catch((e) => console.error('retenção de impressão:', e)), 60_000);
purge.unref();

const shutdown = () => {
  server.close(() => void db.close().then(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
