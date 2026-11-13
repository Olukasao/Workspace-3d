/**
 * Miniaturas da galeria do estilo Ara 3D Gen (npm run avatars-ara:thumbs): renderiza cada personagem (de frente, do busto
 * para cima, fundo neutro) com o mesmo renderizador do app e grava public/assets/avatars-ara/thumbs/<id>.webp.
 * Rode depois de avatars-ara:process.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, launchBrowser, startNode, viteBin, waitForHttp } from '../lib/browser.mjs';

const OUT = path.join(ROOT, 'public/assets/avatars-ara/thumbs');
mkdirSync(OUT, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'public/assets/avatars-ara/manifest.json'), 'utf8'));
const PORT = 5191;
const vite = startNode([viteBin, '--port', String(PORT), '--strictPort'], { WEB_PORT: String(PORT) });
await waitForHttp(`http://localhost:${PORT}/avatar-preview.html`);
const browser = await launchBrowser({ gpu: true });
const page = await browser.newPage({ viewport: { width: 520, height: 680 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/avatar-preview.html`);
await page.waitForFunction(() => window.avatarReady === true, null, { timeout: 60000 });
for (const c of manifest.characters) {
  const req = { config: { v: 1, style: 'ara3d', character: c.id, headsetAlways: false }, mode: 'stand', activity: 'idle', view: 'front', zoom: 'upper', t: 1.3 };
  const out = await page.evaluate((x) => window.renderAvatar(x), req);
  const png = Buffer.from(out.png.split(',')[1], 'base64');
  const meta = await sharp(png).metadata();
  // recorte central 3:4 (o preview é 520×680)
  const w = Math.min(meta.width, Math.round(meta.height * 0.75));
  await sharp(png).extract({ left: Math.round((meta.width - w) / 2), top: 0, width: w, height: meta.height }).resize(180, 240).webp({ quality: 80 }).toFile(path.join(OUT, `${c.id}.webp`));
}
console.log(`${manifest.characters.length} miniaturas em public/assets/avatars-ara/thumbs${errors.length ? ' — erros: ' + [...new Set(errors)].join(' | ') : ''}`);
await browser.close();
vite.stop();
process.exit(0);
