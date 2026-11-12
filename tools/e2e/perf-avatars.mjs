/**
 * Medição com 25 avatares simultâneos na cena operacional (interface compilada: rode `npm run build` antes).
 * Cria 25 mesas com cadeira, 25 colegas no diretório (simulados no modo demonstração, sem conta) vinculados a elas,
 * espera os 25 avatares e mede FPS (câmera girando), draw calls, triângulos, memória, LOD e bytes de avatar baixados.
 * Grava test-results/perf-avatars-report.json.  Uso: npm run perf:avatars  [--software]
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, launchBrowser, startNode, tsxBin, viteBin, waitForHttp } from '../lib/browser.mjs';

const N = 25;
const API = 8796;
const DEV = !!process.env.PERF_DEV; // depuração: interface pelo Vite (desenvolvimento) em vez da compilada
const BASE = DEV ? 'http://localhost:5196' : `http://localhost:${API}`;
const data = mkdtempSync(path.join(tmpdir(), 'office3d-perf-av-'));
const dbFile = path.join(data, 'db.sqlite');
const api = startNode([tsxBin, 'server/index.ts'], { PORT: String(API), DATA_DIR: data, SQLITE_PATH: dbFile });
await waitForHttp(`http://localhost:${API}/api/health`);
const web = DEV ? startNode([viteBin, '--port', '5196', '--strictPort'], { WEB_PORT: '5196', OFFICE3D_API: `http://localhost:${API}` }) : null;
if (web) await waitForHttp(`${BASE}/`);

// mesmo hash do servidor (server/live.ts): colegas simulados com hash % 5 === 0 começam offline — escolhe ids que começam online
const fnv = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};
const ids = [];
for (let i = 0; ids.length < N; i++) if (fnv(`emp_perf_${i}`) % 5 !== 0) ids.push(`emp_perf_${i}`);
const sql = new DatabaseSync(dbFile);
sql.exec('PRAGMA busy_timeout = 5000;');
const ins = sql.prepare('INSERT INTO employees (id, company_id, name, department, extension, chat_ref, accepts_transfers, active) VALUES (?, ?, ?, ?, ?, ?, 1, 1)');
ids.forEach((id, i) => ins.run(id, 'co_acme', `Colega ${String(i + 1).padStart(2, '0')}`, 'Atendimento', String(3000 + i), `demo:${id}`));
sql.close();

const gpu = !process.argv.includes('--software');
const browser = await launchBrowser({ gpu });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/`);
await page.click('[data-account="admin"]');
await page.waitForSelector('.topbar');
const call = (m, u, b) => page.evaluate(async ([m, u, b]) => {
  const r = await fetch(u, { method: m, headers: { 'X-Requested-With': 'office3d', 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [m, u, b]);

// 25 mesas (grade 5 × 5 ao lado do prédio), cada uma com uma cadeira
const draft = (await call('GET', '/api/offices/off_sede_1/draft')).body;
for (let i = 0; i < N; i++) {
  draft.doc.objects.push({ id: `perf_mesa_${i}`, kind: 'desk', name: `Mesa P${String(i + 1).padStart(2, '0')}`, assetId: 'asset_mesa-reta', floorId: draft.doc.floorId, parentId: null, t: { x: -9.4 + (i % 5) * 1.6, y: 0, z: -6.6 + Math.floor(i / 5) * 1.5, rotY: 0 } });
  draft.doc.objects.push({ id: `perf_cadeira_${i}`, kind: 'furniture', name: `Cadeira P${i + 1}`, assetId: 'asset_cadeira-escritorio', floorId: draft.doc.floorId, parentId: `perf_mesa_${i}`, t: { x: 0, y: 0, z: 0.62, rotY: Math.PI } });
}
const saved = (await call('PUT', '/api/offices/off_sede_1/draft', { doc: draft.doc, baseVersion: draft.version })).body;
const pub = await call('POST', '/api/offices/off_sede_1/publish', { baseVersion: saved.version });
if (pub.status !== 200) throw new Error(`publicação falhou: ${JSON.stringify(pub.body)}`);
for (let i = 0; i < N; i++) {
  const r = await call('PUT', `/api/admin/offices/off_sede_1/seats/perf_mesa_${i}`, { employeeId: ids[i] });
  if (r.status !== 200) throw new Error(`vínculo da mesa ${i}: ${r.status} ${JSON.stringify(r.body)}`);
}

const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl ? gl.getParameter(gl.RENDERER) : 'sem WebGL2';
});

/** Sessão nova (cache HTTP vazio), câmera enquadrando as mesas; mede com a câmera girando. */
async function measure(label, { zoomOut }) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await c.addCookies(await ctx.cookies());
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  const t0 = Date.now();
  await p.goto(`${BASE}/#/ops`);
  await p.waitForFunction(() => window.__office3d?.avatars, null, { timeout: 60000 });
  await p.locator('[role="option"]', { hasText: 'Mesa P13' }).first().click();
  await p.waitForTimeout(1200);
  const box = await p.locator('canvas').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let k = 0; k < zoomOut; k++) {
    await p.mouse.wheel(0, 300);
    await p.waitForTimeout(80);
  }
  const ours = () => p.evaluate(() => (window.__office3d.avatars() ?? []).filter((a) => a.employeeId?.startsWith('emp_perf_')));
  const t1 = Date.now();
  let list = [];
  for (;;) {
    list = await ours();
    if (list.filter((a) => a.items?.length > 3).length >= N - 2 || Date.now() - t1 > 90000) break; // a simulação pode tirar 1–2 do ar
    await p.waitForTimeout(500);
  }
  const avatarsReadyMs = Date.now() - t0;
  await p.waitForTimeout(2000);
  await p.screenshot({ path: path.join(ROOT, `test-results/perf-avatars-${zoomOut ? 'longe' : 'perto'}.png`) });
  const samples = [];
  await p.mouse.down({ button: 'left' });
  for (let s = 0; s < 8; s++) {
    for (let k = 0; k < 10; k++) {
      await p.mouse.move(box.x + box.width / 2 + Math.sin((s * 10 + k) / 6) * 120, box.y + box.height / 2);
      await p.waitForTimeout(100);
    }
    samples.push(await p.evaluate(() => ({ fps: window.__office3d.fps, calls: window.__office3d.calls, triangles: window.__office3d.triangles, geometries: window.__office3d.geometries, textures: window.__office3d.textures, heapMB: window.__office3d.heapMB })));
  }
  await p.mouse.up();
  list = await ours();
  const net = await p.evaluate(() => {
    const r = performance.getEntriesByType('resource');
    const sum = (f) => r.filter(f).reduce((s, e) => s + (e.transferSize || e.encodedBodySize || 0), 0);
    return { totalKB: Math.round(sum(() => true) / 1024), avatarsKB: Math.round(sum((e) => e.name.includes('/assets/avatars/')) / 1024), avatarFiles: r.filter((e) => e.name.includes('/assets/avatars/')).length };
  });
  await c.close();
  const fps = samples.map((s) => s.fps).filter(Boolean).sort((a, b) => a - b);
  const last = samples.at(-1);
  const count = (f) => list.filter(f).length;
  return {
    label,
    avatars: { inScene: list.length, visible: count((a) => a.visible), lod0: count((a) => a.lod === 0), lod1: count((a) => a.lod === 1), activities: Object.fromEntries(['idle', 'typing', 'call'].map((k) => [k, count((a) => a.activity === k)])), fallback: count((a) => a.missing?.length) },
    avatarsReadyMs, fpsMedian: fps[Math.floor(fps.length / 2)], fpsMin: fps[0], drawCalls: last.calls, triangles: last.triangles, geometries: last.geometries, textures: last.textures, heapMB: last.heapMB, network: net,
  };
}

const near = await measure('25 avatares — câmera próxima (maioria em LOD0)', { zoomOut: 0 });
const far = await measure('25 avatares — câmera afastada (LOD1 e recorte)', { zoomOut: 6 });
const report = {
  measuredAt: new Date().toISOString(),
  scene: `cena inicial + ${N} mesas com cadeira e ${N} colegas simulados vinculados (mais os colegas do diretório de demonstração)`,
  environment: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramGB: Math.round(os.totalmem() / 1073741824), browser: `Chromium ${browser.version()}`, webglRenderer: renderer, gpuRequested: gpu, viewport: '1440×900', server: 'produção (npm run build + servidor), cache HTTP vazio em cada medida' },
  results: [near, far],
  pageErrors: [...new Set(errors)],
};
mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
writeFileSync(path.join(ROOT, 'test-results/perf-avatars-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
api.stop(); web?.stop();
process.exit(0);
