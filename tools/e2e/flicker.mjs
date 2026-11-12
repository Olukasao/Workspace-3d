/**
 * Mede o "piscar" (z-fighting) das paredes: afasta o zoom, gira a câmera em passos pequenos e, em cada posição,
 * conta pixels isolados com alto contraste (1 px de largura) na janela do canvas. Em z-fighting, as duas superfícies se
 * alternam pixel a pixel e esse número dispara; sem ele, só sobram as arestas legítimas.
 * Uso: node tools/e2e/flicker.mjs [rotulo]   → imprime JSON e grava test-results/flicker-<rotulo>.json
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, launchBrowser, startNode, tsxBin, viteBin, waitForHttp } from '../lib/browser.mjs';

const label = process.argv[2] ?? 'atual';
const API = 8792, WEB = 5192, BASE = `http://localhost:${WEB}`;
const OUT = path.join(ROOT, 'test-results');
mkdirSync(OUT, { recursive: true });
const data = mkdtempSync(path.join(tmpdir(), 'office3d-flk-'));
const api = startNode([tsxBin, 'server/index.ts'], { PORT: String(API), DATA_DIR: data, SQLITE_PATH: path.join(data, 'db.sqlite') });
const web = startNode([viteBin, '--port', String(WEB), '--strictPort'], { WEB_PORT: String(WEB), OFFICE3D_API: `http://localhost:${API}` });
await waitForHttp(`http://localhost:${API}/api/health`);
await waitForHttp(`${BASE}/`);

const browser = await launchBrowser({ gpu: true });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
await page.goto(`${BASE}/`);
await page.click('[data-account="operator"]');
await page.waitForSelector('text=Revisão publicada nº 1');
await page.waitForFunction(() => window.__office3d?.fps > 0, null, { timeout: 30000 });
await page.waitForTimeout(2500);
const box = await page.locator('canvas').boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

// zoom afastado (roda do mouse), como no relato
await page.mouse.move(cx, cy);
for (let i = 0; i < 9; i++) {
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(1200);

/** Pixels de 1 px de largura com contraste forte nos dois lados (horizontal ou vertical): assinatura do pisca-pisca. */
async function speckle(png) {
  const { data: d, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  let n = 0;
  const T = 55;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const v = d[y * W + x];
      const l = d[y * W + x - 1], r = d[y * W + x + 1], u = d[(y - 1) * W + x], b = d[(y + 1) * W + x];
      if ((Math.abs(v - l) > T && Math.abs(v - r) > T && Math.abs(l - r) < 25) || (Math.abs(v - u) > T && Math.abs(v - b) > T && Math.abs(u - b) < 25)) n++;
    }
  }
  return n;
}

const samples = [];
const clip = { x: box.x, y: box.y + 60, width: box.width, height: box.height - 60 };
for (let step = 0; step < 14; step++) {
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(cx + 7, cy + (step % 2 ? 3 : -3), { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  samples.push(await speckle(await page.screenshot({ clip })));
}
const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
const result = { label, samples, average: avg, min: Math.min(...samples), max: Math.max(...samples) };
writeFileSync(path.join(OUT, `flicker-${label}.json`), JSON.stringify(result));
await page.screenshot({ path: path.join(OUT, `flicker-${label}.png`), clip });
console.log(JSON.stringify(result));
await browser.close();
api.stop();
web.stop();
process.exit(0);
