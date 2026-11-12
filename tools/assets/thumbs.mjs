/**
 * Gera as miniaturas próprias do catálogo (public/assets/thumbs/<slug>.webp) renderizando cada GLB distribuído em um navegador real.
 * Uso: npm run assets:thumbs            grava as miniaturas
 *      npm run assets:thumbs -- --debug grava folhas de contato com eixos em test-results/ (conferência de orientação e escala)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, launchBrowser, startNode, viteBin, waitForHttp } from '../lib/browser.mjs';

const debug = process.argv.includes('--debug');
const PORT = 5199;
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'public/assets/manifest.json'), 'utf8'));

const vite = startNode([viteBin, '--port', String(PORT), '--strictPort'], { WEB_PORT: String(PORT) });
await waitForHttp(`http://localhost:${PORT}/thumbs.html`);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.error('erro na página:', e.message));
await page.goto(`http://localhost:${PORT}/thumbs.html`);
await page.waitForFunction(() => typeof window.renderThumb === 'function');

const outDir = path.join(ROOT, 'public/assets/thumbs');
mkdirSync(outDir, { recursive: true });
mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
const cells = [];
for (const m of manifest.models) {
  const dataUrl = await page.evaluate(([url, dbg]) => window.renderThumb(url, dbg), [m.url, debug]);
  const png = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (debug) {
    const img = await sharp(png).resize(240, 180).flatten({ background: '#ffffff' }).png().toBuffer();
    const d = m.dimensions;
    const label = Buffer.from(`<svg width="240" height="22"><rect width="100%" height="100%" fill="#1f2937"/><text x="4" y="15" font-size="11" fill="#fff" font-family="Arial">${m.slug} ${d.width}×${d.depth}×${d.height}</text></svg>`);
    cells.push({ img, label });
  } else {
    await sharp(png).resize(256, 192).webp({ quality: 82 }).toFile(path.join(outDir, `${m.slug}.webp`));
  }
}
if (debug) {
  const cols = 6;
  const perSheet = 24;
  for (let s = 0; s * perSheet < cells.length; s++) {
    const part = cells.slice(s * perSheet, (s + 1) * perSheet);
    const rows = Math.ceil(part.length / cols);
    const comps = part.flatMap((c, i) => [
      { input: c.img, left: (i % cols) * 240, top: Math.floor(i / cols) * 202 },
      { input: c.label, left: (i % cols) * 240, top: Math.floor(i / cols) * 202 + 180 },
    ]);
    await sharp({ create: { width: cols * 240, height: rows * 202, channels: 3, background: '#ffffff' } }).composite(comps).jpeg({ quality: 84 }).toFile(path.join(ROOT, `test-results/asset-sheet-${s + 1}.jpg`));
  }
  console.log(`folhas de contato em test-results/asset-sheet-N.jpg (${cells.length} modelos; seta azul = +Z, vermelha = +X)`);
} else {
  writeFileSync(path.join(outDir, 'LEIA-ME.txt'), 'Miniaturas próprias, geradas por tools/assets/thumbs.mjs a partir dos GLB distribuídos.\n');
  console.log(`${manifest.models.length} miniaturas em public/assets/thumbs`);
}
await browser.close();
vite.stop();
process.exit(0);
