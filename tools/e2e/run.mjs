/**
 * Roteiro de aceite no navegador real (Chrome/Edge do sistema), pelos fluxos normais da interface.
 * Sobe a API com banco temporário e o Vite, usa sessões separadas para cada perfil e grava
 * test-results/e2e-report.json + capturas de tela. Uso: npm run e2e
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, launchBrowser, startNode, tsxBin, viteBin, waitForHttp } from '../lib/browser.mjs';

const API = 8798;
const WEB = 5198;
const BASE = `http://localhost:${WEB}`;
const OUT = path.join(ROOT, 'test-results');
mkdirSync(OUT, { recursive: true });
const data = mkdtempSync(path.join(tmpdir(), 'office3d-e2e-'));
const api = startNode([tsxBin, 'server/index.ts'], { PORT: String(API), DATA_DIR: data, SQLITE_PATH: path.join(data, 'db.sqlite'), DEMO_MODE: 'true' });
const web = startNode([viteBin, '--port', String(WEB), '--strictPort'], { WEB_PORT: String(WEB), OFFICE3D_API: `http://localhost:${API}` });
await waitForHttp(`http://localhost:${API}/api/health`);
await waitForHttp(`${BASE}/`);

const browser = await launchBrowser();
const results = [];
const errors = [];
const started = Date.now();

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail: detail ?? null });
    console.log(`  ok   ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  } catch (e) {
    // guarda as primeiras linhas: o Playwright coloca o seletor que falhou depois da mensagem
    const msg = String(e?.message ?? e).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 14).join(' / ');
    results.push({ name, ok: false, ms: Date.now() - t0, error: msg });
    // captura da última sessão aberta, para ver o que estava na tela
    await lastPage?.screenshot({ path: path.join(OUT, 'e2e-falha-' + name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40) + '.png') }).catch(() => undefined);
    console.log(`  FALHA ${name}: ${msg}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

let lastPage = null;
async function session(role, { route } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (route) await ctx.route(route, (r) => r.abort());
  const page = await ctx.newPage();
  lastPage = page;
  page.on('pageerror', (e) => errors.push(`[${role}] ${e.message}`));
  await page.goto(`${BASE}/`);
  await page.click(`[data-account="${role}"]`);
  await page.waitForSelector('.topbar');
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `e2e-${name}.png`) });
const editorState = (page) => page.evaluate(() => {
  const s = window.__office3dEditor.getState();
  return { doc: s.doc, version: s.version, selected: s.selected, dirty: JSON.stringify(s.doc) !== s.savedJson };
});
const apiFetch = (page, method, url, body) =>
  page.evaluate(
    async ([m, u, b]) => {
      const r = await fetch(u, { method: m, headers: { 'X-Requested-With': 'office3d', 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    },
    [method, url, body],
  );
const waitScene = (page) => page.waitForFunction(() => window.__office3d?.screenOf && document.querySelector('canvas'), null, { timeout: 30000 });
const tab = (page, name) => page.locator('nav.tabs button', { hasText: name }).click();
const option = (page, text) => page.locator('[role="option"]', { hasText: text }).first();
const pdf = (label) => Buffer.from(`%PDF-1.4\n% e2e ${label}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);

console.log('Office 3D — roteiro de aceite no navegador');
await check('modelo faltante: a cena mostra substituto visual e continua utilizável', async () => {
  const m = await session('admin', { route: '**/assets/models/lixeira.glb' });
  await tab(m.page, 'Editor');
  await m.page.waitForSelector('[data-asset="mesa-reta"]');
  await waitScene(m.page);
  await m.page.waitForFunction(() => window.__office3d.fallbacks() > 0, null, { timeout: 45000 });
  const n = await m.page.evaluate(() => window.__office3d.fallbacks());
  await m.ctx.close();
  return `${n} substituto(s) visível(is) para o GLB bloqueado`;
});

const admin = await session('admin');
const A = admin.page;
let deskId;
let monitorId;

// ---------- editor ----------
await check('administrador abre o editor com o rascunho e o catálogo', async () => {
  await tab(A, 'Editor');
  await A.waitForSelector('[data-asset="mesa-reta"]');
  await waitScene(A);
  const s = await editorState(A);
  assert(s.doc.objects.length > 90, 'rascunho incompleto');
  return `${s.doc.objects.length} objetos, rascunho v${s.version}`;
});

await check('adicionar mesa e monitor: o monitor entra sobre a mesa e passa a acompanhá-la', async () => {
  await A.getByRole('tab', { name: /Objetos/ }).click();
  await option(A, 'Atendimento').click(); // centraliza a vista na sala (onde a mesa nova vai entrar)
  await A.waitForTimeout(1800);
  await A.getByRole('tab', { name: 'Catálogo' }).click();
  await A.click('[data-asset="mesa-reta"]');
  let s = await editorState(A);
  deskId = s.selected[0];
  await A.click('[data-asset="monitor"]');
  s = await editorState(A);
  monitorId = s.selected[0];
  const mon = s.doc.objects.find((o) => o.id === monitorId);
  assert(mon.parentId === deskId, `monitor sem pai (pai=${mon.parentId})`);
  assert(Math.abs(mon.t.y - 0.75) < 0.01, `monitor fora do tampo (y=${mon.t.y})`);
  return { desk: deskId, monitor: monitorId };
});

await check('arrastar a mesa no 3D leva o monitor junto', async () => {
  await A.waitForTimeout(800);
  const before = await editorState(A);
  const desk0 = before.doc.objects.find((o) => o.id === deskId).t;
  const p = await A.evaluate((id) => window.__office3d.screenOf(id), deskId);
  assert(p, 'mesa não encontrada na cena');
  const canvas = await A.locator('canvas').boundingBox();
  const x = canvas.x + p.x;
  const y = canvas.y + p.y;
  await A.mouse.move(x, y);
  await A.mouse.down();
  for (let i = 1; i <= 10; i++) await A.mouse.move(x + i * 9, y + i * 3);
  await A.mouse.up();
  await A.waitForTimeout(300);
  const after = await editorState(A);
  const desk1 = after.doc.objects.find((o) => o.id === deskId).t;
  const mon = after.doc.objects.find((o) => o.id === monitorId);
  const moved = Math.hypot(desk1.x - desk0.x, desk1.z - desk0.z);
  assert(moved > 0.2, `mesa não se moveu (${moved.toFixed(2)} m; seleção: ${after.selected.join(',')})`);
  assert(mon.parentId === deskId, 'monitor perdeu o vínculo com a mesa');
  await shot(A, '01-editor-mesa-monitor');
  return `mesa deslocada ${moved.toFixed(2)} m; monitor continua filho da mesa`;
});

await check('trocar o modelo da TV mantém o ID da instância; desfazer e refazer', async () => {
  await A.getByRole('tab', { name: /Objetos/ }).click();
  await A.fill('input[aria-label="Buscar"]', 'TV NOC — Rede');
  await option(A, 'TV NOC — Rede').click();
  await A.getByLabel('Modelo visual').selectOption({ label: 'TV plana de parede' });
  let s = await editorState(A);
  let tv = s.doc.objects.find((o) => o.id === 'tv_noc_01');
  assert(tv && tv.assetId === 'asset_tv-parede', 'modelo não trocou');
  await A.evaluate(() => document.activeElement?.blur());
  await A.keyboard.press('Control+z');
  s = await editorState(A);
  assert(s.doc.objects.find((o) => o.id === 'tv_noc_01').assetId === 'asset_tv-painel', 'desfazer não voltou o modelo');
  await A.keyboard.press('Control+y');
  s = await editorState(A);
  tv = s.doc.objects.find((o) => o.id === 'tv_noc_01');
  assert(tv.assetId === 'asset_tv-parede', 'refazer não reaplicou');
  await A.fill('input[aria-label="Buscar"]', '');
  return 'tv_noc_01: tv-painel → tv-parede (desfazer/refazer ok)';
});

await check('salvar, recarregar a página e encontrar as alterações', async () => {
  await A.getByRole('button', { name: 'Salvar', exact: true }).click();
  await A.waitForFunction(() => document.querySelector('[data-testid="draft-status"]')?.textContent?.includes('salvo'), null, { timeout: 15000 });
  const v = (await editorState(A)).version;
  await A.reload();
  await A.waitForSelector('[data-asset="mesa-reta"]');
  await waitScene(A);
  const s = await editorState(A);
  assert(s.version === v, `versão ${s.version} ≠ ${v}`);
  assert(s.doc.objects.find((o) => o.id === monitorId)?.parentId === deskId, 'mesa/monitor não persistiram');
  assert(s.doc.objects.find((o) => o.id === 'tv_noc_01').assetId === 'asset_tv-parede', 'troca da TV não persistiu');
  return `rascunho v${v} recarregado`;
});

await check('publicar a revisão', async () => {
  await A.getByRole('button', { name: 'Publicar', exact: true }).click();
  await A.locator('[role="dialog"] button.primary').click();
  await A.waitForSelector('.toast:has-text("publicada")', { timeout: 15000 });
  return (await A.locator('.toast').textContent()).trim();
});

// ---------- operador em outra sessão ----------
const operator = await session('operator');
const O = operator.page;
await check('outra sessão (operador) vê a revisão publicada com a mesa/monitor e a TV trocada', async () => {
  await waitScene(O);
  await O.waitForSelector('text=Revisão publicada nº 2');
  const r = await apiFetch(O, 'GET', '/api/offices/off_sede_1/operational');
  assert(r.body.objects[monitorId]?.seat?.state === 'vacant', 'monitor novo ausente na publicação');
  assert(r.body.doc.objects.find((o) => o.id === 'tv_noc_01').assetId === 'asset_tv-parede', 'TV não trocou na publicação');
  await shot(O, '02-operador-publicado');
  return `revisão ${r.body.revision.number}`;
});

await check('TV trocada mantém dispositivo e painel: abrir painel autorizado', async () => {
  await option(O, 'TV NOC — Rede').click();
  await O.waitForSelector('text=Saúde da rede (demonstração)');
  await O.waitForSelector('text=PLAYER-NOC-01');
  await O.click('[data-action="dashboard"]');
  await O.waitForSelector('[role="dialog"] iframe');
  const badge = await O.locator('[role="dialog"] .chip.demo').textContent();
  await shot(O, '03-painel-tv');
  await O.keyboard.press('Escape');
  return badge;
});

await check('operador não edita: sem aba Editor, rota bloqueada e API recusa', async () => {
  assert((await O.locator('nav.tabs button', { hasText: 'Editor' }).count()) === 0, 'aba Editor visível');
  await O.goto(`${BASE}/#/editor`);
  await O.waitForTimeout(1500);
  assert((await O.locator('[data-asset]').count()) === 0, 'catálogo do editor apareceu');
  const put = await apiFetch(O, 'PUT', '/api/offices/off_sede_1/draft', { doc: {}, baseVersion: 1 });
  const get = await apiFetch(O, 'GET', '/api/offices/off_sede_1/draft');
  assert(put.status === 403 && get.status === 403, `status ${put.status}/${get.status}`);
  return 'PUT/GET do rascunho → 403';
});

await check('mesa vaga: chat e transferência indisponíveis com o motivo', async () => {
  await O.goto(`${BASE}/#/ops`);
  await waitScene(O);
  await option(O, 'Posto 06').click();
  assert(await O.locator('[data-action="chat"]').isDisabled(), 'chat habilitado em mesa vaga');
  await O.waitForSelector('text=Mesa vaga: não há colaborador vinculado a esta mesa.');
  return 'Posto 06: "Mesa vaga"';
});

await check('chat (demonstração) abre conversa sinalizada como simulação', async () => {
  await option(O, 'Posto 01').click();
  await O.click('[data-action="chat"]');
  await O.waitForSelector('[role="dialog"] .chip.demo:has-text("Simulação")');
  await O.fill('[aria-label="Mensagem"]', 'Olá, Ana! (teste)');
  await O.click('[role="dialog"] button:has-text("Enviar")');
  await O.waitForSelector('.msg.mine:has-text("Olá, Ana!")');
  await shot(O, '04-chat-demo');
  await O.keyboard.press('Escape');
  return 'conversa criada e mensagem enviada (simulada)';
});

await check('duplo clique em "Confirmar transferência" transfere uma única vez', async () => {
  await option(O, 'Posto 02').click();
  await O.click('[data-action="transfer"]');
  await O.waitForSelector('input[name="ticket"]');
  await O.dblclick('[data-testid="confirm-transfer"]');
  await O.waitForSelector('[role="dialog"] .notice.ok:has-text("transferido")', { timeout: 15000 });
  await shot(O, '05-transferencia');
  await O.keyboard.press('Escape');
  const audit = await apiFetch(A, 'GET', '/api/admin/audit?limit=200');
  const done = audit.body.entries.filter((e) => e.action === 'ticket.transfer' && e.result === 'completed');
  assert(done.length === 1, `${done.length} transferências registradas`);
  return '1 transferência concluída na trilha';
});

await check('impressão: arquivo inválido recusado; duplo clique no envio gera um único trabalho; estados da fila', async () => {
  await option(O, 'Impressora Atendimento').click();
  await O.click('[data-action="print"]');
  await O.setInputFiles('[role="dialog"] input[type="file"]', { name: 'planilha.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('PK nao e pdf') });
  await O.waitForSelector('text=Selecione um arquivo PDF.');
  await O.setInputFiles('[role="dialog"] input[type="file"]', { name: 'relatorio.pdf', mimeType: 'application/pdf', buffer: pdf('impressao') });
  await O.click('[role="dialog"] button:has-text("Enviar para IMP-ATD-01")');
  await O.dblclick('[data-testid="confirm-print"]');
  await O.waitForSelector('.timeline .step.done:has-text("Na fila")', { timeout: 10000 });
  await O.waitForSelector('.timeline .step.done:has-text("Envio confirmado pela fila")', { timeout: 15000 });
  await O.waitForSelector('.timeline .step.done:has-text("Conclusão reportada pela fila")', { timeout: 20000 });
  await shot(O, '06-impressao-fila');
  await O.keyboard.press('Escape');
  const audit = await apiFetch(A, 'GET', '/api/admin/audit?limit=200');
  const jobs = audit.body.entries.filter((e) => e.action === 'print.submit' && e.result === 'queued');
  assert(jobs.length === 1, `${jobs.length} trabalhos criados`);
  return 'xlsx recusado; 1 trabalho; na fila → enviado → concluído (simulado)';
});

await check('provedor indisponível: mapa segue navegável e a ação mostra "Indisponível"', async () => {
  await tab(A, 'Integrações');
  await A.click('[data-outage="chat"]');
  await A.waitForSelector('[data-outage="chat"]:has-text("Restabelecer")');
  await O.reload();
  await waitScene(O);
  await O.waitForSelector('.notice.bad:has-text("indisponível")');
  await option(O, 'Posto 01').click();
  await O.waitForSelector('.action:has([data-action="chat"]) .chip.bad:has-text("Indisponível")');
  assert(await O.locator('[data-action="chat"]').isDisabled(), 'chat habilitado com provedor fora');
  assert(await O.locator('[data-action="transfer"]').isEnabled(), 'transferência afetada indevidamente');
  await shot(O, '07-provedor-indisponivel');
  await A.click('[data-outage="chat"]');
  return 'chat indisponível; mapa, lista e demais ações funcionando';
});

await check('visualizador vê dados profissionais, sem ações', async () => {
  const v = await session('viewer');
  await waitScene(v.page);
  await option(v.page, 'Posto 01').click();
  await v.page.waitForSelector('text=Ana Ribeiro');
  assert(await v.page.locator('[data-action="chat"]').isDisabled(), 'visualizador com chat habilitado');
  await v.page.waitForSelector('.chip.warn:has-text("Sem permissão")');
  await v.ctx.close();
  return 'ações em "Sem permissão"';
});

await check('usuário de outra empresa não vê o escritório desta empresa', async () => {
  const x = await session('other');
  await x.page.waitForSelector('text=O administrador ainda não publicou o mapa deste andar.');
  const r = await apiFetch(x.page, 'GET', '/api/offices/off_sede_1/operational');
  const d = await apiFetch(x.page, 'GET', '/api/offices/off_sede_1/draft');
  assert(r.status === 404 && d.status === 404, `status ${r.status}/${d.status}`);
  await x.ctx.close();
  return 'operational/draft de outra empresa → 404';
});

await check('conflito entre dois editores', async () => {
  const b = await session('admin');
  const B = b.page;
  await tab(B, 'Editor');
  await B.waitForSelector('[data-asset="mesa-reta"]');
  // A muda e grava primeiro
  await A.evaluate(() => {
    const s = window.__office3dEditor.getState();
    s.apply((objs) => objs.map((o) => (o.id === 'at_lixeira' ? { ...o, name: 'Lixeira (editor A)' } : o)));
  });
  await tab(A, 'Editor');
  await A.getByRole('button', { name: 'Salvar', exact: true }).click();
  await A.waitForFunction(() => document.querySelector('[data-testid="draft-status"]')?.textContent?.includes('salvo'));
  // B, ainda na versão anterior, muda pela interface e tenta gravar
  await B.getByRole('tab', { name: /Objetos/ }).click();
  await option(B, 'Lixeira').click();
  await B.getByLabel('Nome').fill('Lixeira (editor B)');
  await B.getByRole('button', { name: 'Salvar', exact: true }).click();
  await B.waitForSelector('[role="dialog"]:has-text("Conflito de edição")');
  await shot(B, '08-conflito');
  const s = await apiFetch(A, 'GET', '/api/offices/off_sede_1/draft');
  assert(s.body.doc.objects.find((o) => o.id === 'at_lixeira').name === 'Lixeira (editor A)', 'gravação de B sobrescreveu A');
  await b.ctx.close();
  return 'B recebeu o aviso; a gravação de A foi preservada';
});

await check('upload de arquivo que não é GLB é recusado com mensagem clara', async () => {
  await A.getByRole('tab', { name: 'Catálogo' }).click();
  await A.click('button:has-text("Enviar GLB")');
  await A.setInputFiles('[role="dialog"] input[type="file"]', { name: 'modelo.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('isto não é um glb, só texto') });
  await A.getByLabel('Nome no catálogo').fill('Teste inválido');
  await A.getByLabel('Licença').fill('CC0 1.0');
  await A.click('[role="dialog"] button:has-text("Enviar")');
  await A.waitForSelector('[role="dialog"] .notice.bad');
  const msg = (await A.locator('[role="dialog"] .notice.bad').textContent()).trim();
  assert(/não é um GLB/.test(msg), msg);
  await A.keyboard.press('Escape');
  return msg;
});

await check('trilha registra ator, alvo, resultado, modo e correlação', async () => {
  await tab(A, 'Trilha');
  await A.waitForSelector('table.table tbody tr');
  const r = await apiFetch(A, 'GET', '/api/admin/audit?limit=200');
  const actions = new Set(r.body.entries.map((e) => e.action));
  for (const a of ['office.publish', 'chat.open', 'ticket.transfer', 'print.submit', 'dashboard.open', 'draft.save']) assert(actions.has(a), `sem registro de ${a}`);
  await shot(A, '09-trilha');
  return `${r.body.entries.length} registros; ${[...actions].length} tipos de ação`;
});

const failed = results.filter((r) => !r.ok);
const report = { startedAt: new Date(started).toISOString(), durationS: Math.round((Date.now() - started) / 1000), browser: browser.version(), passed: results.length - failed.length, failed: failed.length, results, pageErrors: errors };
writeFileSync(path.join(OUT, 'e2e-report.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.passed}/${results.length} verificações passaram em ${report.durationS}s. Erros de página: ${errors.length}. Relatório: test-results/e2e-report.json`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
await browser.close();
api.stop();
web.stop();
process.exit(failed.length ? 1 : 0);
