/**
 * Construção da estrutura do zero, no navegador real: plano vazio → piso arrastado → paredes ponto a ponto
 * (contorno fechado) → janela e porta clicadas na parede → esticar parede pelo puxador → salvar e publicar.
 * Uso: npm run e2e:draw  (grava test-results/draw-report.json e capturas)
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, launchBrowser, startNode, tsxBin, viteBin, waitForHttp } from '../lib/browser.mjs';

const API = 8793, WEB = 5193, BASE = `http://localhost:${WEB}`;
const OUT = path.join(ROOT, 'test-results');
mkdirSync(OUT, { recursive: true });
const data = mkdtempSync(path.join(tmpdir(), 'office3d-draw-'));
const api = startNode([tsxBin, 'server/index.ts'], { PORT: String(API), DATA_DIR: data, SQLITE_PATH: path.join(data, 'db.sqlite') });
const web = startNode([viteBin, '--port', String(WEB), '--strictPort'], { WEB_PORT: String(WEB), OFFICE3D_API: `http://localhost:${API}` });
await waitForHttp(`http://localhost:${API}/api/health`);
await waitForHttp(`${BASE}/`);

const browser = await launchBrowser();
const results = [];
const errors = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? null });
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.message ?? e).split('\n')[0] });
    console.log(`  FALHA ${name}: ${String(e?.message ?? e).split('\n')[0]}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/#/editor`);
await page.click('[data-account="admin"]');
await page.waitForSelector('[data-asset="mesa-reta"]');
await page.waitForFunction(() => window.__office3d?.worldToScreen);

const state = () => page.evaluate(() => window.__office3dEditor.getState().doc.objects);
/** Coordenada do mundo → posição do mouse na página. */
async function at(x, y, z) {
  const box = await page.locator('canvas').boundingBox();
  const p = await page.evaluate(([x, y, z]) => window.__office3d.worldToScreen(x, y, z), [x, y, z]);
  return { x: box.x + p.x, y: box.y + p.y };
}
const settle = () => page.waitForTimeout(1600); // câmera animando até o enquadramento

console.log('Office 3D — construir a estrutura do zero');
await check('começar com o plano vazio', async () => {
  await page.click('button:has-text("Começar com o plano vazio")');
  await page.click('[role="dialog"] button:has-text("Esvaziar o rascunho")');
  const objs = await state();
  assert(objs.length === 0, `${objs.length} objetos restantes`);
  assert((await page.getAttribute('[data-tool="floor"]', 'aria-pressed')) === 'true', 'ferramenta Piso não ficou ativa');
  return 'rascunho vazio, ferramenta Piso ativa, vista em planta';
});

await check('desenhar um piso arrastando no chão (8 × 6 m, madeira)', async () => {
  await page.selectOption('[data-testid="floor-finish"]', 'wood');
  await settle();
  const a = await at(-4, 0, -3);
  const b = await at(4, 0, 3);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  await page.mouse.up();
  const room = (await state()).find((o) => o.kind === 'room');
  assert(room, 'nenhum piso criado');
  assert(Math.abs(room.room.w - 8) < 0.11 && Math.abs(room.room.d - 6) < 0.11, `medidas ${room.room.w} × ${room.room.d}`);
  assert(room.room.floor === 'wood', 'acabamento errado');
  return `${room.name}: ${room.room.w} × ${room.room.d} m, centro ${room.t.x}; ${room.t.z}`;
});

await check('desenhar paredes ponto a ponto e fechar o contorno no ponto inicial', async () => {
  await page.click('[data-tool="wall"]');
  await settle();
  for (const [x, z] of [[-4, -3], [4, -3], [4, 3], [-4, 3], [-4, -3]]) {
    const p = await at(x, 0, z);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
  }
  const walls = (await state()).filter((o) => o.kind === 'wall');
  assert(walls.length === 4, `${walls.length} paredes`);
  const lengths = walls.map((w) => w.wall.length).sort((p, q) => p - q);
  assert(Math.abs(lengths[0] - 6) < 0.11 && Math.abs(lengths[3] - 8) < 0.11, `comprimentos ${lengths.join(', ')}`);
  return `comprimentos ${lengths.join(' / ')} m`;
});

await check('janela clicada no meio da parede norte e porta na parede leste', async () => {
  await page.click('[data-tool="window"]');
  const w = await at(0, 2.7, -3);
  await page.mouse.move(w.x, w.y);
  await page.waitForTimeout(200);
  await page.mouse.click(w.x, w.y);
  await page.click('[data-tool="door"]');
  const d = await at(4, 2.7, 1);
  await page.mouse.move(d.x, d.y);
  await page.waitForTimeout(200);
  await page.mouse.click(d.x, d.y);
  const objs = await state();
  const ops = objs.filter((o) => o.kind === 'opening');
  assert(ops.length === 2, `${ops.length} vãos`);
  const win = ops.find((o) => o.opening.style === 'window');
  const door = ops.find((o) => o.opening.style === 'door');
  assert(win && door, 'tipos errados');
  assert(Math.abs(win.t.x) < 0.3, `janela fora do ponto clicado (x=${win.t.x})`);
  return `janela em x=${win.t.x} m da parede; porta em x=${door.t.x} m`;
});

await check('esticar uma parede pelo puxador da ponta', async () => {
  await page.click('[data-tool="select"]');
  const before = await state();
  const north = before.find((o) => o.kind === 'wall' && before.some((x) => x.parentId === o.id && x.opening?.style === 'window'));
  await page.getByRole('tab', { name: /Objetos/ }).click();
  await page.locator('[role="option"]', { hasText: north.name }).first().click();
  await page.getByRole('tab', { name: 'Catálogo' }).click();
  await page.waitForTimeout(1800);
  // ponta "b" (fim) da parede: está no lado +X local
  const ends = await page.evaluate((id) => {
    const s = window.__office3dEditor.getState();
    const o = s.doc.objects.find((x) => x.id === id);
    const h = o.wall.length / 2;
    return { a: { x: o.t.x - Math.cos(o.t.rotY) * h, z: o.t.z + Math.sin(o.t.rotY) * h }, b: { x: o.t.x + Math.cos(o.t.rotY) * h, z: o.t.z - Math.sin(o.t.rotY) * h } };
  }, north.id);
  const p = await at(ends.b.x, 3.0, ends.b.z); // puxador acima do topo da parede (2,7 m + 0,3 m)
  const target = await at(ends.b.x + (ends.b.x > ends.a.x ? 2 : -2), 3.0, ends.b.z);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(p.x + ((target.x - p.x) * i) / 8, p.y + ((target.y - p.y) * i) / 8);
  await page.mouse.up();
  const after = (await state()).find((o) => o.id === north.id);
  assert(Math.abs(after.wall.length - 10) < 0.11, `comprimento ${after.wall.length}`);
  return `parede norte: ${north.wall.length} → ${after.wall.length} m`;
});

await check('desfazer volta o comprimento; refazer reaplica', async () => {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+z');
  const undone = (await state()).filter((o) => o.kind === 'wall').map((w) => w.wall.length).sort((a, b) => b - a)[0];
  await page.keyboard.press('Control+y');
  const redone = (await state()).filter((o) => o.kind === 'wall').map((w) => w.wall.length).sort((a, b) => b - a)[0];
  assert(Math.abs(undone - 8) < 0.11 && Math.abs(redone - 10) < 0.11, `${undone} / ${redone}`);
  return `${undone} m ↔ ${redone} m`;
});

await check('salvar e publicar a estrutura desenhada; o operador a vê', async () => {
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="draft-status"]')?.textContent?.includes('salvo'), null, { timeout: 15000 });
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();
  await page.locator('[role="dialog"] button.primary').click();
  await page.waitForSelector('.toast:has-text("publicada")', { timeout: 15000 });
  await page.click('.toolgroup button:has-text("3D")');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'draw-01-estrutura-3d.png') });
  const op = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await op.goto(`${BASE}/`);
  await op.click('[data-account="operator"]');
  await op.waitForSelector('text=Revisão publicada nº 2');
  const v = await op.evaluate(async () => (await fetch('/api/offices/off_sede_1/operational')).json());
  const kinds = v.doc.objects.reduce((m, o) => ((m[o.kind] = (m[o.kind] ?? 0) + 1), m), {});
  assert(kinds.room === 1 && kinds.wall === 4 && kinds.opening === 2, JSON.stringify(kinds));
  await op.waitForTimeout(2500);
  await op.screenshot({ path: path.join(OUT, 'draw-02-operador.png') });
  return JSON.stringify(kinds);
});

const failed = results.filter((r) => !r.ok).length;
writeFileSync(path.join(OUT, 'draw-report.json'), JSON.stringify({ at: new Date().toISOString(), passed: results.length - failed, failed, results, pageErrors: errors }, null, 2));
console.log(`\n${results.length - failed}/${results.length} verificações passaram. Erros de página: ${errors.length}.`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
await browser.close();
api.stop();
web.stop();
process.exit(failed ? 1 : 0);
