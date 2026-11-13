/**
 * Sonda de carga (diagnóstico da instabilidade do `npm run e2e`): abre N sessões na operação, renderizando por
 * software como o roteiro, e mede quadros por segundo (requestAnimationFrame) e tempo de resposta de um clique em cada uma.
 * Uso: node tools/e2e/probe-load.mjs [sessões=3] [--gpu] [--sem-avatares]
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchBrowser, startNode, tsxBin, viteBin, waitForHttp } from '../lib/browser.mjs';

const N = Number(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 3);
const gpu = process.argv.includes('--gpu');
const semAvatares = process.argv.includes('--sem-avatares');
const leve = process.argv.includes('--leve');
const qs = [semAvatares ? 'semAvatares' : '', leve ? 'leve' : ''].filter(Boolean).join('&');
const API = 8797, WEB = 5197, BASE = `http://localhost:${WEB}`;
const data = mkdtempSync(path.join(tmpdir(), 'office3d-probe-'));
const api = startNode([tsxBin, 'server/index.ts'], { PORT: String(API), DATA_DIR: data, SQLITE_PATH: path.join(data, 'db.sqlite') });
const web = startNode([viteBin, '--port', String(WEB), '--strictPort'], { WEB_PORT: String(WEB), OFFICE3D_API: `http://localhost:${API}` });
await waitForHttp(`http://localhost:${API}/api/health`);
await waitForHttp(`${BASE}/`);
const browser = await launchBrowser({ gpu });
const roles = ['admin', 'operator', 'viewer', 'admin', 'operator'];
const pages = [];
for (let i = 0; i < N; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(qs ? `${BASE}/?${qs}` : `${BASE}/`);
  await page.click(`[data-account="${roles[i % roles.length]}"]`);
  await page.waitForSelector('.topbar');
  await page.waitForFunction(() => window.__office3d?.screenOf, null, { timeout: 60000 });
  pages.push(page);
}
await pages[0].waitForTimeout(3000);
const fpsOf = (p) => p.evaluate(() => new Promise((res) => {
  let n = 0;
  const t0 = performance.now();
  const tick = () => {
    n++;
    if (performance.now() - t0 >= 3000) res({ rafFps: +(n / ((performance.now() - t0) / 1000)).toFixed(1), sceneFps: window.__office3d?.fps ?? null });
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));
const out = [];
for (const [i, p] of pages.entries()) {
  const f = await fpsOf(p);
  const t0 = Date.now();
  await p.locator('nav.tabs button').first().click({ timeout: 60000 }).catch(() => undefined);
  out.push({ sessao: i + 1, papel: roles[i % roles.length], ...f, cliqueMs: Date.now() - t0 });
}
console.log(JSON.stringify({ sessoes: N, gpu, semAvatares, resultado: out }, null, 1));
await browser.close();
api.stop();
web.stop();
process.exit(0);
