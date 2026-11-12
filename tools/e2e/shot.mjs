/**
 * Captura de tela rápida do aplicativo (diagnóstico visual).
 * Uso: node tools/e2e/shot.mjs <perfil: admin|operator|viewer> <página: ops|editor|audit|integrations|credits> [saida.png]
 * Sobe API (banco temporário) e Vite, entra com a conta fictícia e salva em test-results/.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, launchBrowser, startNode, tsxBin, viteBin, waitForHttp } from '../lib/browser.mjs';

const [role = 'admin', page = 'ops', out = `shot-${role}-${page}.png`] = process.argv.slice(2);
const API = 8797;
const WEB = 5197;
const data = mkdtempSync(path.join(tmpdir(), 'office3d-shot-'));
const api = startNode([tsxBin, 'server/index.ts'], { PORT: String(API), DATA_DIR: data, SQLITE_PATH: path.join(data, 'db.sqlite'), DEMO_MODE: 'true' }, { quiet: false });
const web = startNode([viteBin, '--port', String(WEB), '--strictPort'], { WEB_PORT: String(WEB), OFFICE3D_API: `http://localhost:${API}` });
await waitForHttp(`http://localhost:${API}/api/health`);
await waitForHttp(`http://localhost:${WEB}/`);
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.error('[erro na página]', e.message));
p.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()));
await p.goto(`http://localhost:${WEB}/#/${page}`);
await p.click(`[data-account="${role}"]`);
await p.waitForTimeout(Number(process.env.SHOT_WAIT ?? 6000));
mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
await p.screenshot({ path: path.join(ROOT, 'test-results', out) });
console.log('salvo em test-results/' + out, await p.evaluate(() => JSON.stringify(window.__office3d ?? {})));
await browser.close();
api.stop();
web.stop();
process.exit(0);
