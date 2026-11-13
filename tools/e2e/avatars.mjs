/**
 * Aceite dos avatares ao vivo, com duas pessoas em sessões de navegador separadas (fluxos normais da aplicação).
 * A = operador (Otávio, Mesa 05) · B = administradora observando a cena. Estilo padrão: Ara 3D Gen (galeria de personagens);
 * um passo troca para MakeHuman pela tela do admin e volta, conferindo que a outra sessão acompanha ao vivo.
 * Uso: npm run e2e:avatars   → test-results/avatars-report.json + capturas
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, launchBrowser, startNode, tsxBin, viteBin, waitForHttp } from '../lib/browser.mjs';

const API = 8788, WEB = 5188, BASE = `http://localhost:${WEB}`;
const GRACE = 3000;
const OUT = path.join(ROOT, 'test-results');
mkdirSync(OUT, { recursive: true });
const data = mkdtempSync(path.join(tmpdir(), 'office3d-avatars-'));
const api = startNode([tsxBin, 'server/index.ts'], { PORT: String(API), DATA_DIR: data, SQLITE_PATH: path.join(data, 'db.sqlite'), PRESENCE_GRACE_MS: String(GRACE), TYPING_TTL_MS: '4000' });
const web = startNode([viteBin, '--port', String(WEB), '--strictPort'], { WEB_PORT: String(WEB), OFFICE3D_API: `http://localhost:${API}` });
await waitForHttp(`http://localhost:${API}/api/health`);
await waitForHttp(`${BASE}/`);
const browser = await launchBrowser({ gpu: true });
const results = [];
let A = null;
let B = null;
const errors = [];
const OTAVIO = 'emp_otavio';
let TARGET = 'ara-m2'; // personagem escolhido no passo de troca (diferente do padrão do Otávio)

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? null });
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    const msg = String(e?.message ?? e).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6).join(' / ');
    results.push({ name, ok: false, error: msg });
    const tag = name.replace(/[^a-z0-9]+/gi, '-').slice(0, 30);
    await A?.screenshot({ path: path.join(OUT, 'avatars-falha-A-' + tag + '.png') }).catch(() => undefined);
    await B?.screenshot({ path: path.join(OUT, 'avatars-falha-B-' + tag + '.png') }).catch(() => undefined);
    console.log('    diagnóstico B:', JSON.stringify(await B?.evaluate(() => ({ live: window.__office3dLive?.getState().people.emp_otavio?.status, stale: window.__office3dLive?.getState().ignoredStale, av: (window.__office3d?.avatars?.() ?? []).filter((x) => x.employeeId === 'emp_otavio').map((x) => ({ a: x.activity, h: x.headset, v: x.visible, lod: x.lod })) })).catch(() => null)));
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
  await page.goto(`${BASE}/`);
  await page.click(`[data-account="${role}"]`);
  await page.waitForSelector('.topbar');
  return { ctx, page };
}
const avatars = (p) => p.evaluate(() => window.__office3d?.avatars?.() ?? []);
const otavioOn = async (p) => (await avatars(p)).filter((a) => a.employeeId === 'emp_otavio');
async function until(fn, what, ms = 25000) {
  const t0 = Date.now();
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() - t0 > ms) throw new Error(`tempo esgotado esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}
const liveStatus = (p) => p.evaluate((id) => window.__office3dLive?.getState().people[id]?.status ?? null, OTAVIO);
const shot = (p, n) => p.screenshot({ path: path.join(OUT, `avatars-${n}.png`) });

console.log('Office 3D — avatares ao vivo (duas sessões)');
B = (await session('admin', 'B')).page;
await B.waitForFunction(() => window.__office3d?.avatars, null, { timeout: 30000 });
// aproxima a câmera da Mesa 05 (a do Otávio)
await B.locator('[role="option"]', { hasText: 'Mesa 05' }).first().click();
const seat = await B.evaluate(async () => {
  const v = await (await fetch('/api/offices/off_sede_1/operational')).json();
  return v.objects.at_mesa_05.seatPosition;
});

await check('offline: sem avatar, mesa continua visível e atribuída', async () => {
  assert((await otavioOn(B)).length === 0, 'avatar do Otávio já está na cena');
  await B.waitForSelector('text=Otávio Lima');
  return `Mesa 05 → Otávio Lima, assento ${seat.x}; ${seat.z}`;
});

A = (await session('operator', 'A')).page;
await check('online: o avatar ocupa a cadeira da mesa vinculada (na outra sessão, sem recarregar)', async () => {
  const [a] = await until(async () => {
    const list = await otavioOn(B);
    return list.length && list[0].items?.length >= 1 ? list : null;
  }, 'avatar do Otávio na sessão B');
  assert(Math.abs(a.x - seat.x) < 0.02 && Math.abs(a.z - seat.z) < 0.02, `posição ${a.x}; ${a.z} ≠ assento ${seat.x}; ${seat.z}`);
  assert(a.activity === 'idle', `atividade ${a.activity}`);
  await B.waitForTimeout(1500);
  await shot(B, '01-online');
  assert(Object.keys(a.joints ?? {}).length === 4, 'sem esqueleto (cabeça, mãos, quadril)');
  assert(Math.abs(a.joints.hand_l[1] - 0.81) < 0.08 && Math.abs(a.joints.hand_r[1] - 0.81) < 0.08, `mãos fora do teclado: ${JSON.stringify(a.joints)}`);
  return `avatar em ${a.x}; ${a.z} (assento da Mesa 05), personagem ${a.items[0]}, mãos no teclado`;
});

await check('troca de personagem: salvar no "Meu avatar" aparece na outra sessão; escolha não salva fica só no preview', async () => {
  const before = (await otavioOn(B))[0].appearance;
  const current = (await otavioOn(B))[0].items[0];
  TARGET = current === 'ara-m2' ? 'ara-m6' : 'ara-m2';
  await A.click('[data-testid="my-avatar"]');
  await A.waitForSelector('[data-character]');
  assert((await A.locator('[data-character]').count()) === 16, 'galeria deve ter 16 personagens');
  assert((await A.locator('img[src*="/thumbs/"]').first().evaluate((img) => img.complete && img.naturalWidth > 0)), 'miniatura não carregou');
  await A.click(`[data-character="${TARGET}"]`);
  await A.waitForTimeout(2500);
  assert((await otavioOn(B))[0].appearance === before, 'escolha não salva vazou para a outra sessão');
  await A.click('[data-testid="avatar-save"]');
  await until(async () => (await otavioOn(B))[0]?.items?.includes(TARGET), `personagem ${TARGET} na sessão B`);
  await B.waitForTimeout(2000);
  await shot(B, '02-personagem');
  return `${TARGET} visível na sessão B sem recarregar`;
});

await check('digitação no chat interno ativa a animação; parar volta ao trabalho', async () => {
  await A.locator('nav.tabs button', { hasText: 'Operação' }).click();
  await A.locator('[role="option"]', { hasText: 'Mesa 01' }).first().click();
  await A.click('[data-action="chat"]');
  await A.waitForSelector('[aria-label="Mensagem"]');
  await A.click('[aria-label="Mensagem"]');
  const sent = [];
  const seen = new Set();
  const t0 = Date.now();
  A.on('request', (r) => r.url().includes('/api/live/typing') && sent.push(`${Date.now() - t0}ms ${r.postData()}`));
  await A.keyboard.type('Bom dia, tudo bem?', { delay: 90 });
  await until(async () => {
    seen.add(await liveStatus(B));
    return (await otavioOn(B))[0]?.activity === 'typing';
  }, 'pose de digitação na sessão B', 10000).catch((e) => {
    throw new Error(`${e.message} (POST typing: ${JSON.stringify(sent)}; estados vistos em B: ${[...seen].join(',')})`);
  });
  assert((await liveStatus(B)) === 'typing', 'estado não é digitando');
  await shot(B, '03-digitando');
  await A.locator('[aria-label="Mensagem"]').blur();
  await until(async () => (await otavioOn(B))[0]?.activity === 'idle', 'volta ao trabalho', 10000);
  return 'digitando → online (sem enviar mensagem)';
});

await check('atendimento: headset e balão conforme o indicador de fala', async () => {
  await A.keyboard.press('Escape');
  await A.click('[data-testid="presence-button"]');
  await A.click('[data-testid="call-start"]');
  await until(async () => {
    const a = (await otavioOn(B))[0];
    return a?.activity === 'call' && a.headset;
  }, 'headset na sessão B', 10000);
  await until(async () => (await B.locator('.speech-balloon').allTextContents()).includes('Em atendimento'), 'balão "Em atendimento"', 10000);
  await A.click('[data-testid="call-speaking"]');
  await until(async () => (await B.locator('.speech-balloon').allTextContents()).includes('•••'), 'balão "•••" com fala', 10000);
  await B.waitForTimeout(800);
  await shot(B, '04-atendimento-falando');
  return 'headset equipado; balão "Em atendimento" → "•••" com o sinal de fala';
});

await check('atendimento tem prioridade sobre digitação', async () => {
  await A.click('[data-testid="presence-button"]'); // fecha o painel
  await A.locator('[role="option"]', { hasText: 'Mesa 02' }).first().click();
  await A.click('[data-action="chat"]');
  await A.click('[aria-label="Mensagem"]');
  await A.keyboard.type('mensagem durante o atendimento', { delay: 60 });
  await B.waitForTimeout(1200);
  assert((await liveStatus(B)) === 'in_call', `estado ${await liveStatus(B)}`);
  assert((await otavioOn(B))[0].activity === 'call', 'pose saiu do atendimento');
  await A.locator('[aria-label="Mensagem"]').blur();
  await A.keyboard.press('Escape');
  await A.click('[data-testid="presence-button"]');
  await A.click('[data-testid="call-end"]');
  await until(async () => (await otavioOn(B))[0]?.activity !== 'call', 'fim do atendimento', 10000);
  return 'digitando durante a chamada continua "em atendimento"; ao encerrar, o estado é recalculado';
});

await check('duas sessões do mesmo colaborador: fechar uma mantém; fechar a última remove após a tolerância', async () => {
  const second = await session('operator', 'A2');
  await A.context().close();
  await B.waitForTimeout(GRACE + 1500);
  assert((await otavioOn(B)).length === 1, 'avatar sumiu com uma sessão ainda aberta');
  await second.ctx.close();
  await B.waitForTimeout(1000);
  assert((await otavioOn(B)).length === 1, 'avatar sumiu antes da tolerância');
  await until(async () => (await otavioOn(B)).length === 0, 'remoção após a tolerância', GRACE + 6000);
  return `continua com 1 sessão; some ${GRACE / 1000}s após fechar a última`;
});

await check('reconexão recupera aparência e estado, sem avatar duplicado', async () => {
  A = (await session('operator', 'A3')).page;
  await until(async () => (await otavioOn(B))[0]?.items?.includes(TARGET), 'avatar com a aparência salva', 25000);
  await B.reload();
  await B.waitForFunction(() => window.__office3d?.avatars, null, { timeout: 30000 });
  await B.locator('[role="option"]', { hasText: 'Mesa 05' }).first().click();
  const list = await until(async () => {
    const l = await otavioOn(B);
    return l.length && l[0].activity && l[0].items?.includes(TARGET) ? l : null;
  }, 'avatar após recarregar a sessão B');
  assert(list.length === 1, `${list.length} avatares do Otávio`);
  assert(list[0].activity === 'idle', `estado ${list[0].activity}`);
  await B.waitForTimeout(1500);
  await shot(B, '05-reconexao');
  return '1 avatar, personagem salvo, trabalhando';
});

await check('o admin troca o estilo dos avatares (Integrações): a outra sessão acompanha ao vivo, e voltar restaura a escolha de cada pessoa', async () => {
  const goOps = async () => {
    await B.locator('nav.tabs button', { hasText: 'Operação' }).click();
    await B.locator('[role="option"]', { hasText: 'Mesa 05' }).first().click();
  };
  const setStyle = async (id) => {
    await B.locator('nav.tabs button', { hasText: 'Integrações' }).click();
    await B.click(`[data-avatar-style="${id}"]`);
    await B.waitForSelector(`[data-avatar-style="${id}"][aria-pressed="true"]`);
  };
  await setStyle('makehuman');
  await goOps();
  const mh = await until(async () => {
    const l = await otavioOn(B);
    return l.length === 1 && l[0].items?.length > 3 && !l[0].items.some((n) => n.startsWith('ara-')) ? l : null;
  }, 'avatar MakeHuman na sessão B', 30000);
  await shot(B, '06-estilo-makehuman');
  await setStyle('ara3d');
  await goOps();
  await until(async () => (await otavioOn(B))[0]?.items?.includes(TARGET), 'a escolha do Ara volta ao reativar o estilo', 30000);
  assert((await otavioOn(B)).length === 1, 'avatar duplicado depois da troca');
  await shot(B, '07-estilo-ara');
  return `MakeHuman (${mh[0].items.length} peças) e de volta ao Ara (${TARGET}), 1 avatar, sem recarregar`;
});

await check('outro colaborador não consegue editar o meu avatar', async () => {
  const r = await B.evaluate(async () => {
    const cfg = (await (await fetch('/api/avatar/me')).json()).config;
    const res = await fetch('/api/avatar/employees/emp_otavio', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'office3d' }, body: JSON.stringify({ config: cfg, baseVersion: 1 }) });
    return res.status;
  });
  assert(r === 403, `status ${r}`);
  return 'PUT no avatar de outra pessoa → 403';
});

const failed = results.filter((r) => !r.ok).length;
writeFileSync(path.join(OUT, 'avatars-report.json'), JSON.stringify({ at: new Date().toISOString(), passed: results.length - failed, failed, results, pageErrors: errors }, null, 2));
console.log(`\n${results.length - failed}/${results.length} verificações passaram. Erros de página: ${errors.length}.`);
if (errors.length) console.log([...new Set(errors)].slice(0, 6).join('\n'));
await browser.close();
api.stop();
web.stop();
process.exit(failed ? 1 : 0);
