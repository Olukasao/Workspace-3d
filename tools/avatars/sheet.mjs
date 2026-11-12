/**
 * Folhas de contato dos avatares (conferência visual de peças, poses e clipping).
 * Uso: node tools/avatars/sheet.mjs <nome> <arquivo-de-pedidos.json>   → test-results/avatar-<nome>.jpg
 * Cada pedido: { label, config, mode, activity, speaking, view, zoom, t }
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, launchBrowser, startNode, viteBin, waitForHttp } from '../lib/browser.mjs';

const [name = 'sheet', reqFile] = process.argv.slice(2);
const reqs = JSON.parse(readFileSync(reqFile, 'utf8'));
const PORT = 5189;
const vite = startNode([viteBin, '--port', String(PORT), '--strictPort'], { WEB_PORT: String(PORT) });
await waitForHttp(`http://localhost:${PORT}/avatar-preview.html`);
const browser = await launchBrowser({ gpu: true });
const page = await browser.newPage({ viewport: { width: 520, height: 680 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://localhost:${PORT}/avatar-preview.html`);
await page.waitForFunction(() => window.avatarReady === true, null, { timeout: 60000 });
const cells = [];
const CW = 240, CH = 320;
for (const r of reqs) {
  const out = await page.evaluate((x) => window.renderAvatar(x), r);
  const img = await sharp(Buffer.from(out.png.split(',')[1], 'base64')).resize(CW, CH).png().toBuffer();
  const label = Buffer.from(`<svg width="${CW}" height="20"><rect width="100%" height="100%" fill="#1f2937"/><text x="4" y="14" font-size="11" fill="#fff" font-family="Arial">${(r.label ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}${out.missing.length ? ' (faltou ' + out.missing.length + ')' : ''}</text></svg>`);
  cells.push({ img, label });
}
const cols = Math.min(6, cells.length);
const rows = Math.ceil(cells.length / cols);
mkdirSync(path.join(ROOT, 'test-results'), { recursive: true });
await sharp({ create: { width: cols * CW, height: rows * (CH + 20), channels: 3, background: '#ffffff' } })
  .composite(cells.flatMap((c, i) => [{ input: c.img, left: (i % cols) * CW, top: Math.floor(i / cols) * (CH + 20) }, { input: c.label, left: (i % cols) * CW, top: Math.floor(i / cols) * (CH + 20) + CH }]))
  .jpeg({ quality: 85 }).toFile(path.join(ROOT, `test-results/avatar-${name}.jpg`));
console.log(`test-results/avatar-${name}.jpg (${cells.length} quadros)${errors.length ? ' — erros: ' + [...new Set(errors)].slice(0, 5).join(' | ') : ''}`);
await browser.close();
vite.stop();
process.exit(0);
