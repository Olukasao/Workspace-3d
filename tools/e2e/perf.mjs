/**
 * Medição de desempenho: cena inicial + 100 cadeiras repetidas. Mede peso inicial (bytes transferidos),
 * tempo até a cena, draw calls, triângulos, geometrias/texturas na GPU, heap JS e FPS — no modo operacional
 * (com instanciamento) e no editor (sem instanciamento). Grava test-results/perf-report.json.
 * Uso: npm run perf   (tenta usar a GPU; registra o renderizador WebGL usado)
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, launchBrowser, startNode, tsxBin, waitForHttp } from '../lib/browser.mjs';

const API = 8795, BASE = `http://localhost:${API}`; // servidor de produção: interface compilada (npm run build) + API
const data = mkdtempSync(path.join(tmpdir(), 'office3d-perf-'));
const api = startNode([tsxBin, 'server/index.ts'], { PORT: String(API), DATA_DIR: data, SQLITE_PATH: path.join(data, 'db.sqlite') });
await waitForHttp(`http://localhost:${API}/api/health`);

const gpu = !process.argv.includes('--software');
const browser = await launchBrowser({ gpu });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`);
await page.click('[data-account="admin"]');
await page.waitForSelector('.topbar');

// 100 cadeiras numa grade 10 × 10 ao lado do prédio, publicadas
const call = (m, u, b) => page.evaluate(async ([m, u, b]) => (await fetch(u, { method: m, headers: { 'X-Requested-With': 'office3d', 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json(), [m, u, b]);
const draft = await call('GET', '/api/offices/off_sede_1/draft');
for (let i = 0; i < 100; i++) draft.doc.objects.push({ id: `perf_${i}`, kind: 'furniture', name: `Cadeira ${i}`, assetId: 'asset_cadeira-escritorio', floorId: draft.doc.floorId, parentId: null, t: { x: -9.4 + (i % 10) * 0.7, y: 0, z: -6.6 + Math.floor(i / 10) * 0.62, rotY: 0 } });
const saved = await call('PUT', '/api/offices/off_sede_1/draft', { doc: draft.doc, baseVersion: draft.version });
await call('POST', '/api/offices/off_sede_1/publish', { baseVersion: saved.version });

const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl ? gl.getParameter(gl.RENDERER) : 'sem WebGL2';
});

async function measure(label, hash, readySelector) {
  // sessão nova a cada medida: cache HTTP vazio, peso inicial real
  // (a sessão é criada pela API, sem passar pela tela de entrada, para a primeira navegação já ser a medida)
  const res0 = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'X-Requested-With': 'office3d', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@demo.office3d.local', password: 'demo1234' }) });
  const [name, value] = res0.headers.get('set-cookie').split(';')[0].split('=');
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await c.addCookies([{ name, value, url: BASE }]);
  const p = await c.newPage();
  const t0 = Date.now();
  await p.goto(`${BASE}/${hash}`);
  await p.waitForSelector(readySelector, { timeout: 60000 });
  await p.waitForFunction(() => window.__office3d?.calls > 0, null, { timeout: 60000 });
  // espera os downloads pararem
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const n = await p.evaluate(() => performance.getEntriesByType('resource').length);
    if (n === last) break;
    last = n;
    await p.waitForTimeout(500);
  }
  const ready = Date.now() - t0;
  // mantém a câmera girando lentamente para medir FPS com redesenho contínuo
  const box = await p.locator('canvas').boundingBox();
  const samples = [];
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down({ button: 'left' });
  for (let s = 0; s < 8; s++) {
    for (let k = 0; k < 10; k++) {
      await p.mouse.move(box.x + box.width / 2 + Math.sin((s * 10 + k) / 6) * 120, box.y + box.height / 2);
      await p.waitForTimeout(100);
    }
    samples.push(await p.evaluate(() => ({ ...window.__office3d })));
  }
  await p.mouse.up();
  const res = await p.evaluate(() => {
    const r = performance.getEntriesByType('resource');
    const sum = (f) => r.filter(f).reduce((s, e) => s + (e.transferSize || e.encodedBodySize || 0), 0);
    return { totalKB: Math.round(sum(() => true) / 1024), modelsKB: Math.round(sum((e) => e.name.includes('/assets/models/')) / 1024), texturesKB: Math.round(sum((e) => e.name.includes('/assets/textures/')) / 1024), requests: r.length };
  });
  const fps = samples.map((s) => s.fps).filter(Boolean);
  const lastS = samples[samples.length - 1];
  await c.close();
  return { label, readyMs: ready, fpsMedian: fps.sort((a, b) => a - b)[Math.floor(fps.length / 2)], fpsMin: Math.min(...fps), drawCalls: lastS.calls, triangles: lastS.triangles, geometries: lastS.geometries, textures: lastS.textures, heapMB: lastS.heapMB, network: res };
}

const ops = await measure('Operação (instanciamento ligado)', '#/ops', 'text=Revisão publicada nº 2');
const opsNoInst = await measure('Operação (instanciamento desligado)', '?semInstancias#/ops', 'text=Revisão publicada nº 2');
const editor = await measure('Editor (sem instanciamento)', '#/editor', '[data-asset="mesa-reta"]');
const report = {
  measuredAt: new Date().toISOString(),
  scene: `${draft.doc.objects.length} objetos (cena inicial + 100 cadeiras repetidas)`,
  environment: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramGB: Math.round(os.totalmem() / 1073741824), browser: `Chromium ${browser.version()}`, webglRenderer: renderer, gpuRequested: gpu, viewport: '1440×900', server: 'produção (npm run build + npm start), cache HTTP vazio em cada medida' },
  results: [ops, opsNoInst, editor],
};
mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
writeFileSync(path.join(ROOT, 'test-results/perf-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
api.stop();
process.exit(0);
