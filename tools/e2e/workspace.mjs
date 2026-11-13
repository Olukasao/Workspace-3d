/**
 * e2e do ambiente híbrido 2D/3D: troca global pelo administrador, isolamento dos motores (rede e memória),
 * repetição de trocas sem vazamento, multijogador entre dois navegadores, editor 2D e avatar 2D.
 * Uso: node tools/e2e/workspace.mjs
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, launchBrowser, startNode, tsxBin, viteBin, waitForHttp } from '../lib/browser.mjs';

const API = 8793, WEB = 5193, BASE = `http://localhost:${WEB}`;
const data = mkdtempSync(path.join(tmpdir(), 'office3d-ws-'));
const api = startNode([tsxBin, 'server/index.ts'], { PORT: String(API), DATA_DIR: data, SQLITE_PATH: path.join(data, 'db.sqlite'), PRESENCE_GRACE_MS: '3000' });
const web = startNode([viteBin, '--port', String(WEB), '--strictPort'], { WEB_PORT: String(WEB), OFFICE3D_API: `http://localhost:${API}` });
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'OK    ' : 'FALHOU'} ${m}`); if (!c) failed++; };
const report = (p) => p.evaluate(() => window.__workspace?.report());
const THREE_RE = /(three|r3f|\.glb|\.ktx2?|draco|meshopt|basis)/i;

try {
  await waitForHttp(`http://localhost:${API}/api/health`);
  await waitForHttp(`${BASE}/`);
  const browser = await launchBrowser({ gpu: true });
  const reqs = { A: [], O: [] };
  const mk = async (role) => {
    const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    p.setDefaultTimeout(60000);
    p.on('pageerror', (e) => { console.log(`[${role}] pageerror:`, e.message, String(e.stack).split(String.fromCharCode(10)).slice(0, 6).join(String.fromCharCode(10))); failed++; });
    p.on('request', (r) => reqs[role === 'admin' ? 'A' : 'O'].push(r.url()));
    await p.goto(`${BASE}/`);
    await p.click(`[data-account="${role}"]`);
    await p.waitForSelector('.topbar');
    return p;
  };
  const A = await mk('admin');
  const O = await mk('operator');

  // 1) padrão 3D; operador não vê as configurações nem consegue trocar pela API
  await A.waitForSelector('[data-engine="three"] canvas', { timeout: 60000 });
  ok((await report(A)).activeEngines.join() === 'three', 'padrão: só o motor 3D ativo');
  ok((await O.locator('[data-testid="nav-settings"]').count()) === 0, 'operador não vê Configurações');
  const denied = await O.evaluate(() => fetch('/api/admin/workspace-mode', { method: 'PUT', headers: { 'content-type': 'application/json', 'X-Requested-With': 'office3d' }, body: JSON.stringify({ mode: '2d', confirm: true }) }).then((r) => r.status));
  ok(denied === 403, `operador não troca o modo pela API (HTTP ${denied})`);

  // 2) administrador troca para 2D: confirmação, e o operador muda sem recarregar
  await A.click('[data-testid="nav-settings"]');
  await A.click('[data-workspace-mode="2d"]');
  await A.waitForSelector('[data-testid="confirm-mode-switch"]');
  await A.click('[data-testid="confirm-mode-switch"]');
  await O.waitForSelector('[data-testid="office2d"]', { timeout: 60000 });
  ok(true, 'operador foi para o 2D sem recarregar a página');
  await A.locator('nav.tabs button', { hasText: 'Operação' }).click();
  await A.waitForSelector('[data-testid="office2d"]', { timeout: 60000 });
  const ra = await report(O);
  ok(ra.activeEngines.join() === 'phaser' && ra.canvases.every((c) => c === 'phaser') && ra.phaserGames === 1, `2D: só Phaser ativo (${JSON.stringify(ra.activeEngines)})`);
  ok(ra.threeDiagnostics === false, '2D: nenhum mundo Three.js vivo');

  // 3) persistência: recarregar mantém o 2D e a carga nova não baixa nada do 3D
  reqs.O.length = 0;
  await O.reload();
  await O.waitForSelector('[data-testid="office2d"]', { timeout: 60000 });
  const bad = reqs.O.filter((u) => THREE_RE.test(u));
  ok(bad.length === 0, `2D (carga nova): nenhum arquivo de 3D baixado${bad.length ? ' → ' + bad[0] : ''}`);

  // 4) multijogador: o administrador anda e o operador vê a posição mudar (captura para conferência visual)
  await O.waitForTimeout(1500);
  const before = await O.evaluate(() => document.querySelectorAll('[data-testid="people-list"] li').length);
  ok(before >= 2, `operador vê ${before} pessoas no escritório`);
  await A.keyboard.down('d');
  await A.waitForTimeout(1200);
  await A.keyboard.up('d');
  await O.waitForTimeout(800);
  await O.screenshot({ path: path.join(ROOT, 'test-results/ws-operador.png') });

  // 5) avatar 2D: operador edita o cabelo e salva
  await O.click('[data-testid="my-avatar"]');
  await O.waitForSelector('[data-testid="avatar-editor-2d"]');
  await O.evaluate(() => { const b = [...document.querySelectorAll('[data-testid^="hair-"]')].find((x) => x.getAttribute('aria-pressed') !== 'true' && x.dataset.testid !== 'hair-bald'); b.click(); });
  await O.click('[data-testid="avatar2d-save"]');
  await O.waitForSelector('[data-testid="avatar2d-msg"]');
  ok(/salvo/i.test(await O.locator('[data-testid="avatar2d-msg"]').innerText()), 'avatar 2D salvo');
  const mine = await O.evaluate(() => fetch('/api/avatar/me').then((r) => r.json()));
  ok(mine.config?.style === 'sprite2d' && mine.saved === true, 'avatar 2D guardado no servidor (estilo sprite2d)');
  await O.locator('nav.tabs button', { hasText: 'Operação' }).click();
  await O.waitForSelector('[data-testid="office2d"]');

  // 6) editor 2D: administrador coloca um tapete e publica; o operador recebe o layout novo ao vivo
  await A.locator('nav.tabs button', { hasText: 'Editor' }).click();
  await A.waitForSelector('[data-testid="editor2d"]', { timeout: 60000 });
  const count = () => O.evaluate(() => fetch('/api/office2d/off_sede_1').then((r) => r.json()).then((j) => j.layout.objects.length));
  const objsBefore = await count();
  await A.click('[data-testid="asset-rug"]');
  const box = await A.locator('.office2d-canvas canvas').boundingBox();
  // a cena do Phaser inicia logo depois de a tela aparecer: repete o clique até o móvel entrar
  for (let t = 0; t < 8 && !/não salvas/.test(await A.locator('.editor2d-status').innerText()); t++) {
    await A.waitForTimeout(500);
    await A.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await A.waitForTimeout(200);
  }
  ok(/não salvas/.test(await A.locator('.editor2d-status').innerText()), 'editor: colocar o móvel marca como não salvo');
  await A.click('[data-testid="editor-publish"]');
  await A.waitForFunction(() => /publicado/i.test(document.querySelector('[data-testid="editor-msg"]')?.textContent ?? ''));
  console.log('   mensagem do editor:', (await A.locator('[data-testid="editor-msg"]').innerText()).split('\n').join(' | '));
  await O.waitForFunction(async () => (await fetch('/api/office2d/off_sede_1').then((r) => r.json())).layout.objects.length > 0, null, { timeout: 5000 }).catch(() => undefined);
  await O.waitForTimeout(1500);
  const objsAfter = await count();
  console.log('   rascunho/publicado (admin):', await A.evaluate(() => fetch('/api/admin/office2d/off_sede_1/draft').then((r) => r.json()).then((j) => [j.layout.objects.length, j.version, j.publishedVersion])));
  ok(objsAfter === objsBefore + 1, `layout publicado chegou ao operador (${objsBefore} → ${objsAfter} objetos)`);
  await A.screenshot({ path: path.join(ROOT, 'test-results/ws-editor.png') });

  // 7) trocas repetidas 2D ⇄ 3D: o motor inativo sai por completo, sem vazar
  const setMode = async (m) => {
    await A.locator('[data-testid="nav-settings"]').click();
    await A.click(`[data-workspace-mode="${m}"]`);
    await A.waitForSelector('[data-testid="confirm-mode-switch"]');
    await A.click('[data-testid="confirm-mode-switch"]');
    await A.waitForSelector('[data-testid="confirm-mode-switch"]', { state: 'detached' });
  };
  for (let i = 0; i < 3; i++) {
    await setMode('3d');
    await A.locator('nav.tabs button', { hasText: 'Operação' }).click();
    await A.waitForSelector('[data-engine="three"] canvas', { timeout: 60000 });
    await O.waitForSelector('[data-engine="three"] canvas', { timeout: 60000 });
    const r3 = await report(O);
    ok(r3.activeEngines.join() === 'three' && r3.phaserGames === 0 && r3.canvases.every((c) => c.startsWith('three')) && r3.liveHandlers2d === 0, `ciclo ${i + 1} → 3D: só Three ativo, 0 jogos Phaser, 0 ouvintes do 2D ${JSON.stringify(r3)}`);
    await setMode('2d');
    await A.locator('nav.tabs button', { hasText: 'Operação' }).click();
    await A.waitForSelector('[data-testid="office2d"]', { timeout: 60000 });
    await O.waitForSelector('[data-testid="office2d"]', { timeout: 60000 });
    const r2 = await report(O);
    ok(r2.activeEngines.join() === 'phaser' && r2.phaserGames === 1 && r2.threeDiagnostics === false && r2.canvases.every((c) => c === 'phaser'), `ciclo ${i + 1} → 2D: só Phaser ativo, 1 jogo, sem mundo Three`);
  }
  const rf = await report(O);
  ok(rf.liveHandlers2d <= 3, `ouvintes do 2D estáveis após as trocas (${rf.liveHandlers2d})`);
  await browser.close();
} catch (e) {
  console.log('ERRO:', e?.message ?? e);
  failed++;
} finally {
  api.stop();
  web.stop();
}
console.log(failed ? `\n${failed} falha(s).` : '\nTudo certo.');
process.exit(failed ? 1 : 0);
