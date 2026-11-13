/**
 * Aceite do editor completo do estilo Ara 3D Gen ("Meu avatar"), com duas pessoas em sessões separadas.
 * A = operador (Otávio, Mesa 05) edita · B = administradora observando a cena.
 * Uso: npm run e2e:ara-editor   → test-results/ara-editor-report.json + capturas
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, launchBrowser, startNode, tsxBin, viteBin, waitForHttp } from '../lib/browser.mjs';

// E2E_PROD=1: testa a versão compilada (npm run build), servida pela própria API com a política de segurança (CSP) de produção
const PROD = !!process.env.E2E_PROD;
const API = 8789, WEB = 5189, BASE = PROD ? `http://localhost:${API}` : `http://localhost:${WEB}`;
const OUT = path.join(ROOT, 'test-results');
mkdirSync(OUT, { recursive: true });
const data = mkdtempSync(path.join(tmpdir(), 'office3d-ara-editor-'));
const api = startNode([tsxBin, 'server/index.ts'], { PORT: String(API), DATA_DIR: data, SQLITE_PATH: path.join(data, 'db.sqlite'), PRESENCE_GRACE_MS: '3000' });
const web = PROD ? null : startNode([viteBin, '--port', String(WEB), '--strictPort'], { WEB_PORT: String(WEB), OFFICE3D_API: `http://localhost:${API}` });
await waitForHttp(`http://localhost:${API}/api/health`);
await waitForHttp(`${BASE}/`);
const browser = await launchBrowser({ gpu: true });
const results = [];
const errors = [];
let A = null;
let B = null;

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? null });
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    const msg = String(e?.message ?? e).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6).join(' / ');
    results.push({ name, ok: false, error: msg });
    const tag = name.replace(/[^a-z0-9]+/gi, '-').slice(0, 30);
    await A?.screenshot({ path: path.join(OUT, `ara-editor-falha-A-${tag}.png`) }).catch(() => undefined);
    console.log(`  FALHA ${name}: ${msg}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
async function session(role, label) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/404|401|422|favicon/.test(m.text()) && errors.push(`[${label}] console: ${m.text().slice(0, 200)}`));
  page.setDefaultTimeout(60000);
  await page.goto(`${BASE}/`);
  await page.click(`[data-account="${role}"]`);
  await page.waitForSelector('.topbar');
  return page;
}
async function until(fn, what, ms = 60000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`tempo esgotado esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}
const status = () => A.locator('[data-testid="preview-status"]').innerText();
const idlePreview = () => until(async () => !/Atualizando/.test(await status()), 'prévia pronta', 90000);
const me = () => A.evaluate(async () => (await fetch('/api/avatar/me')).json());
const otavioOn = (p) => p.evaluate(() => (window.__office3d?.avatars?.() ?? []).filter((a) => a.employeeId === 'emp_otavio'));

console.log('Office 3D — editor completo do estilo Ara 3D Gen');
B = await session('admin', 'B');
await B.waitForFunction(() => window.__office3d?.avatars, null, { timeout: 60000 });
A = await session('operator', 'A');
await A.waitForSelector('[data-testid="my-avatar"]');

await check('abre o editor completo: personagens prontos, modos Montar e Detalhado, sem erros', async () => {
  await A.click('[data-testid="my-avatar"]');
  await A.waitForSelector('[data-style="ara3d"]');
  assert((await A.locator('.gallery-card[data-character]').count()) === 16, 'faltam personagens prontos');
  assert((await A.locator('[data-tab="montar"]').count()) === 1 && (await A.locator('[data-tab="detalhado"]').count()) === 1, 'faltam as abas');
  for (const section of ['Corpo', 'Origem e pele', 'Cabelo', 'Roupa', 'Sapatos e acessórios']) assert((await A.locator('h3', { hasText: section }).count()) > 0, `seção "${section}" ausente`);
  assert((await A.locator('[data-options="hair"] .opt-card').count()) >= 14, 'estilos de cabelo');
  const eyeThumb = A.locator('[data-options="eyes"] img').first();
  await eyeThumb.scrollIntoViewIfNeeded();
  await until(() => eyeThumb.evaluate((i) => i.complete && i.naturalWidth > 0), 'miniatura de olhos carregada', 20000);
  await idlePreview();
  await A.waitForTimeout(1500);
  await A.screenshot({ path: path.join(OUT, 'ara-editor-01-aberto.png') });
  return 'galeria de 16, seções do Montar e miniaturas';
});

await check('mexer nos controles gera uma prévia nova (sem travar a tela) e mostra o resultado', async () => {
  const before = await status();
  await A.click('[data-gender="female"]');
  await A.locator('[data-slider="age"] input').fill('52');
  await A.locator('[data-slider="weight"] input').fill('0.7');
  await A.click('[data-options="hair"] [data-option="bob01"]');
  await A.locator('[data-color-field="hairColor"] .swatch[title="Grisalho"]').click();
  await until(async () => /Atualizando/.test(await status()), 'prévia começou a atualizar', 15000);
  await idlePreview();
  assert(/Alterações só neste preview/.test(await status()), `estado: ${await status()}`);
  assert((await A.locator('.notice.bad').count()) === 0, 'erro visível');
  await A.waitForTimeout(1500);
  await A.screenshot({ path: path.join(OUT, 'ara-editor-02-editado.png') });
  return `idade 52, peso 0,7, cabelo Chanel grisalho (antes: "${before}")`;
});

await check('roupa: conjunto pronto com cor e tecido; peças soltas obrigam parte de cima e de baixo', async () => {
  await A.click('[data-outfit-mode="set"]');
  await A.click('[data-options="outfit"] [data-option="set_pantsuit"]');
  await A.locator('[data-piece="set_pantsuit"] [data-color-field="set_pantsuit-color"] .swatch[title="Marinho"]').click();
  await A.locator('[data-piece="set_pantsuit"] select').selectOption('suiting');
  await A.click('[data-outfit-mode="pieces"]');
  await A.click('[data-options="top"] [data-option="silk_blouse"]');
  await A.click('[data-options="bottom"] [data-option="pencil_skirt_midi"]');
  await A.locator('[data-piece="silk_blouse"] [data-color-field="silk_blouse-color"] .swatch[title="Vinho"]').click();
  assert((await A.locator('.notice.warn').count()) === 0, 'aviso de validação inesperado');
  await A.click('[data-outfit-mode="set"]');
  await A.click('[data-options="outfit"] [data-option="set_pantsuit"]');
  await idlePreview();
  return 'tailleur marinho em tecido de terno; blusa e saia validadas';
});

await check('modo Detalhado: grupos de controles do rosto e do corpo, com ajuste e "zerar"', async () => {
  await A.click('[data-tab="detalhado"]');
  await A.waitForSelector('[data-tab-panel="detalhado"]');
  for (const c of ['Gender', 'Face', 'Torso', 'Arms and Legs']) assert((await A.locator(`[data-category="${c}"]`).count()) === 1, `categoria ${c}`);
  await A.click('[data-category="Face"]');
  const groups = await A.locator('details[data-group]').count();
  assert(groups >= 10, `poucos grupos no rosto (${groups})`);
  await A.locator('details[data-group="nose size"] summary').click();
  const first = A.locator('details[data-group="nose size"] input[type="range"]').first();
  await first.fill('0.6');
  await A.waitForSelector('[data-tab="detalhado"]:has-text("(1)")');
  await A.locator('details[data-group="chin/jaw"] summary').click();
  await A.locator('details[data-group="chin/jaw"] input[type="range"]').nth(1).fill('-0.5');
  await A.waitForSelector('[data-tab="detalhado"]:has-text("(2)")');
  await idlePreview();
  await A.screenshot({ path: path.join(OUT, 'ara-editor-03-detalhado.png') });
  const labels = await A.locator('details[data-group="nose size"] .slider-label').allInnerTexts();
  assert(labels.length > 0 && labels.every((l) => !/\b(Scale|Move|decr|incr)\b/.test(l)), `rótulos sem tradução: ${labels.join(', ')}`);
  await A.click('[data-testid="reset-details"]');
  await A.waitForSelector('[data-tab="detalhado"]:has-text("(0)")');
  await A.locator('details[data-group="nose size"] input[type="range"]').first().fill('0.4');
  await A.click('[data-tab="montar"]');
  return `${groups} grupos no rosto, rótulos em português, 2 ajustes e zerar tudo; deixou 1 ajuste`;
});

let savedModel = '';
await check('salvar: o servidor gera o modelo; o estado vira "Salvo" e os parâmetros ficam gravados', async () => {
  await idlePreview();
  await A.click('[data-testid="avatar-save"]');
  await until(async () => /Salvo \(versão 1\)/.test(await status()), 'salvo', 120000);
  const r = await me();
  assert(r.saved === true && r.style === 'ara3d', 'não salvou');
  assert(r.config.custom && /^[a-f0-9]{16}$/.test(r.config.model), 'sem modelo gerado');
  assert(r.config.custom.hair === 'bob01' && r.config.custom.outfit === 'set_pantsuit', `parâmetros: ${r.config.custom.hair} ${r.config.custom.outfit}`);
  const mods = Object.entries(r.config.custom.modifiers);
  assert(mods.length === 1 && mods[0][0].startsWith('nose/') && Math.abs(mods[0][1] - 0.4) < 0.011, `ajuste fino: ${JSON.stringify(mods)}`);
  const lod = await A.evaluate(async (m) => (await fetch(`/api/avatar/model/${m}/lod0.glb`)).status, r.config.model);
  assert(lod === 200, `modelo não servido (${lod})`);
  savedModel = r.config.model;
  return `modelo ${r.config.model}, ${Object.keys(r.config.custom.modifiers).length} ajuste(s) fino(s)`;
});

await check('o colega vê o personagem novo no escritório, sem recarregar', async () => {
  await B.locator('[role="option"]', { hasText: 'Mesa 05' }).first().click();
  await until(async () => (await otavioOn(B))[0]?.items?.includes(savedModel), `modelo ${savedModel} na sessão B`, 90000);
  await B.waitForTimeout(2500);
  await B.screenshot({ path: path.join(OUT, 'ara-editor-04-colega.png') });
  const [a] = await otavioOn(B);
  assert(Object.keys(a.joints ?? {}).length === 4, 'sem esqueleto');
  return `personagem personalizado ${savedModel} em ${a.x}; ${a.z}`;
});

await check('cancelar descarta a edição; recarregar a página traz de volta o personagem salvo (parâmetros e modelo)', async () => {
  await A.click('[data-gender="male"]');
  await A.locator('[data-slider="age"] input').fill('70');
  await A.waitForSelector('text=Alterações só neste preview');
  await A.click('[data-testid="avatar-cancel"]');
  await until(async () => /Salvo \(versão 1\)/.test(await status()), 'voltou ao salvo', 30000);
  assert((await A.locator('[data-gender="female"][aria-pressed="true"]').count()) === 1, 'cancelar não restaurou o gênero');
  await A.reload();
  await A.click('[data-testid="my-avatar"]');
  await A.waitForSelector('[data-style="ara3d"]');
  await until(async () => /Salvo \(versão 1\)/.test(await status()), 'salvo após recarregar', 30000);
  const age = await A.locator('[data-slider="age"] output').innerText();
  assert(/52 anos/.test(age), `idade após recarregar: ${age}`);
  return 'cancelar restaura; após recarregar, 52 anos e feminino';
});

await check('personagem pronto como ponto de partida; o servidor recusa parâmetros fora da lista permitida', async () => {
  await A.click('.gallery-card[data-character="ara-m6"]');
  await A.waitForSelector('text=Alterações só neste preview');
  assert((await A.locator('[data-gender="male"][aria-pressed="true"]').count()) === 1, 'preset não aplicou o gênero');
  const bad = await A.evaluate(async () => {
    const mine = await (await fetch('/api/avatar/me')).json();
    const put = (custom) => fetch('/api/avatar/me', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'office3d' }, body: JSON.stringify({ config: { v: 1, style: 'ara3d', custom, headsetAlways: false }, baseVersion: mine.version }) }).then((r) => r.status);
    return [await put({ ...mine.config.custom, outfit: 'set_gold_bikini' }), await put({ ...mine.config.custom, weapon: 'rifle' }), await put({ ...mine.config.custom, age: 0.2 })];
  });
  assert(bad.every((s) => s === 422), `status ${bad.join(',')}`);
  return 'biquíni, arma e menor de 18 anos → 422';
});

const failed = results.filter((r) => !r.ok).length;
writeFileSync(path.join(OUT, 'ara-editor-report.json'), JSON.stringify({ at: new Date().toISOString(), passed: results.length - failed, failed, results, pageErrors: errors }, null, 2));
console.log(`\n${results.length - failed}/${results.length} verificações passaram. Erros de página: ${errors.length}.`);
if (errors.length) console.log([...new Set(errors)].slice(0, 6).join('\n'));
A?.context().close().catch(() => undefined);
await browser.close();
api.stop();
web?.stop();
process.exit(failed ? 1 : 0);
