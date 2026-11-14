/**
 * Captura as respostas GET do servidor real (API em :8787, banco de demonstração) para a versão estática do navegador.
 * Saída: src/demo/fixtures.json  { [perfil]: { "GET /api/...": corpo } } e public/demo-assets/<hash>.glb
 * Uso: node tools/static-demo/capture.mjs   (com `npm run dev` ligado)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const API = process.env.API ?? 'http://127.0.0.1:8787';
const OFF = 'off_sede_1';
const ROOT = path.resolve(import.meta.dirname, '../..');
const ACCOUNTS = { admin: 'admin@demo.office3d.local', operator: 'operador@demo.office3d.local', viewer: 'visualizador@demo.office3d.local' };

async function session(email) {
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(API + url, { method, headers: { 'content-type': 'application/json', 'X-Requested-With': 'office3d', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, buf: text };
  };
  await call('POST', '/api/auth/login', { email, password: 'demo1234' });
  return call;
}

const out = {};
const setMode = async (mode) => { const c = await session(ACCOUNTS.admin); await c('PUT', '/api/admin/workspace-mode', { mode, confirm: true }); };
await setMode('2d'); // as rotas de objeto do 2D só respondem no modo 2D
const assetFiles = new Set();
for (const [role, email] of Object.entries(ACCOUNTS)) {
  const call = await session(email);
  const fx = (out[role] = {});
  const get = async (url) => { const r = await call('GET', url); if (r.status < 400 && r.json) fx['GET ' + url] = r.json; else console.log(role, url, r.status); return r.json; };
  // modo 3D e 2D: o mock troca o modo; aqui só se captura o que não depende dele
  for (const u of ['/api/auth/me', '/api/offices', '/api/directory', `/api/office2d/${OFF}`, `/api/office2d/${OFF}/tv-content`, `/api/offices/${OFF}/operational`, `/api/offices/${OFF}/draft`, '/api/assets', '/api/avatar/me', '/api/avatar/catalog', '/api/live/snapshot', '/api/integrations/status', '/api/tickets/active', `/api/offices/${OFF}/revisions`]) await get(u);
  const lay = fx[`GET /api/office2d/${OFF}`]?.layout;
  const ids = (lay?.objects ?? []).filter((o) => /tv|printer/.test(o.asset)).map((o) => o.id);
  for (const id of ids) for (const s of ['remote', 'remote/devices', 'printers']) await get(`/api/office2d/${OFF}/objects/${id}/${s}`);
  if (role === 'admin') for (const u of ['/api/admin/directory', '/api/admin/devices', `/api/admin/offices/${OFF}/bindings`, `/api/admin/office2d/${OFF}/draft`, `/api/admin/office2d/${OFF}/devices`, '/api/admin/audit?limit=150', '/api/admin/avatar-style', '/api/admin/workspace-mode']) await get(u);
  if (role === 'admin') for (const a of fx['GET /api/assets']?.assets ?? []) if (a.file?.url || a.url) assetFiles.add(a.file?.url ?? a.url);
}
await setMode('3d');
// molde das respostas de ações (formato real; o mock só troca os dados)
const adm = await session(ACCOUNTS.admin);
const op = await session(ACCOUNTS.operator);
out._shapes = {};
const shape = async (key, call, method, url, body) => { const r = await call(method, url, body); out._shapes[key] = { status: r.status, body: r.json }; };
await shape('chatOpen', op, 'POST', `/api/offices/${OFF}/actions/chat/open`, { objectId: 'o1' });
console.log('ativos referenciados:', [...assetFiles].slice(0, 5), assetFiles.size);
mkdirSync(path.join(ROOT, 'src/demo'), { recursive: true });
writeFileSync(path.join(ROOT, 'src/demo/fixtures.json'), JSON.stringify(out));
console.log('ok', Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Object.keys(v).length])));
