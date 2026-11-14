/**
 * "Servidor" da versão estática: responde às chamadas /api/* dentro do navegador, sem backend nem banco.
 * As respostas de leitura vêm de capturas do servidor real (fixtures.json); as ações (chat, acesso remoto, impressão,
 * troca 2D/3D, avatar, movimento no 2D) são tratadas aqui, em memória, com as mesmas regras e formatos.
 * A VIDA autônoma (bots andando, conversando, tomando café) roda aqui e alimenta o 2D (eventos p2d) e o 3D (lifePoses).
 */
import { defaultForStyle, isAraCustom, validateForStyle, type AnyAvatarConfig } from '../../shared/avatarAra';
import { Life, type AgentView } from '../../shared/life';
import { TILE, seatPointOf, type Layout2D } from '../../shared/office2d';
import { indexObjects, seatWorld } from '../../shared/scene';
import type { AssetDefinition, SceneDoc } from '../../shared/types';
import { lifePoses } from '../three/avatar/lifeStore';
import fixtures from './fixtures.json';
import { buildLife2D, dirOfAngle, angleOfDir, SPEED_2D } from './life2d';
import { buildLife3D, poseOf } from './life3d';

type Role = 'admin' | 'operator' | 'viewer';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const FX = fixtures as unknown as Record<string, Json>;
const OFF = 'off_sede_1';
const ACCOUNTS: Record<string, { role: Role; employeeId: string | null }> = {
  'admin@demo.office3d.local': { role: 'admin', employeeId: 'emp_aline' },
  'operador@demo.office3d.local': { role: 'operator', employeeId: 'emp_otavio' },
  'visualizador@demo.office3d.local': { role: 'viewer', employeeId: null },
};

// ---------- estado ----------
let role: Role | null = null;
try {
  role = (sessionStorage.getItem('o3d-role') as Role | null) ?? null;
} catch {
  /* sem sessionStorage */
}
const me = () => (role ? Object.values(ACCOUNTS).find((a) => a.role === role) ?? null : null);
let mode: '2d' | '3d' = '3d';
let modeVersion = Date.now();
let styleAdmin: string = FX.admin['GET /api/admin/avatar-style'].style;
const avatars = new Map<string, { config: AnyAvatarConfig; version: number }>(); // `${style}:${employeeId}`
let personVersion = 1000;
let seq = 100;
const fx = () => FX[role ?? 'admin'];
const get = (key: string) => fx()[`GET ${key}`] ?? FX.admin[`GET ${key}`];

// ---------- eventos ao vivo ----------
type Handler = (e: { data: string }) => void;
class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = 0;
  onopen: Handler | null = null;
  onerror: Handler | null = null;
  private l = new Map<string, Set<Handler>>();
  constructor(public url: string) {
    hub.add(this);
    setTimeout(() => {
      if (this.readyState === 2) return;
      this.readyState = 1;
      this.emit('open', '');
      this.emit('snapshot', JSON.stringify(snapshot()));
      if (mode === '2d') this.emit('mode', JSON.stringify(workspace()));
    }, 30);
  }
  addEventListener(n: string, f: Handler) {
    if (!this.l.has(n)) this.l.set(n, new Set());
    this.l.get(n)!.add(f);
  }
  removeEventListener(n: string, f: Handler) {
    this.l.get(n)?.delete(f);
  }
  close() {
    this.readyState = 2;
    hub.delete(this);
  }
  emit(n: string, data: string) {
    this.l.get(n)?.forEach((f) => f({ data }));
    if (n === 'open') this.onopen?.({ data });
  }
}
const hub = new Set<MockEventSource>();
const broadcast = (name: string, data: unknown) => {
  const s = JSON.stringify(data);
  hub.forEach((h) => h.emit(name, s));
};

// ---------- dados da cena ----------
const directory = (): Array<{ id: string; name: string; department: string; extension: string }> => FX.admin['GET /api/directory'].employees;
const nameOf = (id: string) => directory().find((e) => e.id === id)?.name ?? id;
const layout2d = (): Layout2D => FX.admin[`GET /api/office2d/${OFF}`].layout;
const stationOf = new Map<string, string>(); // colaborador → estação (2D)
for (const s of FX.admin[`GET /api/office2d/${OFF}`].seats as Array<{ stationId: string; employeeId: string }>) stationOf.set(s.employeeId, s.stationId);

const doc3d = (): SceneDoc => FX.admin[`GET /api/offices/${OFF}/draft`].doc;
const assets3d = (): AssetDefinition[] => FX.admin['GET /api/assets'].assets;
/** mesa → colaborador no 3D; a mesa vaga do atendimento fica com a administradora (quem entra pela conta dela ganha lugar) */
const deskOwner3d = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const o of Object.values<Json>(FX.admin[`GET /api/offices/${OFF}/operational`].objects)) if (o.kind === 'desk' && o.seat?.state === 'occupied') out[o.objectId] = o.seat.employee.id;
  out.at_mesa_06 = 'emp_aline';
  return out;
};

let life2: ReturnType<typeof buildLife2D> | null = null;
let life3: Life | null = null;
const people = () => directory().map((e) => ({ id: e.id, name: e.name, dept: e.department }));
const ensure2d = () => (life2 ??= buildLife2D(layout2d(), people().map((p) => ({ ...p, stationId: stationOf.get(p.id) ?? null })), { seed: 7 }));
const ensure3d = () => (life3 ??= buildLife3D(doc3d(), assets3d(), people(), deskOwner3d(), { seed: 11 }));
const activeLife = () => (mode === '2d' ? ensure2d().life : ensure3d());

// ---------- pessoas / presença ----------
const lastStatus = new Map<string, string>();
const livePerson = (v: AgentView) => {
  const callActive = v.status === 'in_call';
  return {
    employeeId: v.id,
    name: nameOf(v.id),
    // "digitando" na presença é "digitando no chat": no 3D a digitação no teclado é só a pose da mão, não um status
    status: mode === '3d' && v.status === 'typing' ? 'online' : v.status,
    call: callActive ? { active: true, speaking: v.speaking, source: 'demo' as const } : null,
    appearance: avatars.get(`${styleKey()}:${v.id}`) ?? null,
    simulated: v.id !== me()?.employeeId,
    version: personVersion++,
    seq: seq++,
  };
};
const styleKey = () => (mode === '2d' ? 'sprite2d' : styleAdmin);
const presenceVisible = () => role !== 'viewer';
const workspace = () => ({ mode, version: modeVersion });
function snapshot() {
  const life = activeLife();
  return {
    seq,
    people: life.views().map(livePerson),
    presenceVisible: presenceVisible(),
    avatarStyle: mode === '2d' ? 'sprite2d' : styleAdmin,
    workspace: workspace(),
  };
}

// ---------- 2D: posições ----------
interface Pos2D { id: string; officeId: string; x: number; y: number; dir: string; moving: boolean; seat: string | null; auto?: boolean }
const posOf = (v: AgentView): Pos2D => ({ id: v.id, officeId: OFF, x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10, dir: dirOfAngle(v.face), moving: v.moving, seat: v.seatId ? v.seatId.replace(/^poi:/, '') : null });
const humanPos = new Map<string, Pos2D>();
const lastSent = new Map<string, string>();

// ---------- laço de simulação ----------
let timer: ReturnType<typeof setInterval> | null = null;
let raf = 0;
let lastT = performance.now();
let acc2d = 0;
function step() {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastT) / 1000);
  lastT = now;
  const life = activeLife();
  life.tick(dt);
  const views = life.views();
  // presença: só avisa quando o estado muda (ou a fala alterna em atendimento)
  for (const v of views) {
    const sig = `${mode === '3d' && v.status === 'typing' ? 'online' : v.status}|${v.activity === 'call' ? v.speaking : ''}`;
    if (lastStatus.get(v.id) !== sig) {
      lastStatus.set(v.id, sig);
      broadcast('person', livePerson(v));
    }
  }
  if (mode === '3d') {
    for (const v of views) lifePoses.set(v.id, poseOf(v));
  } else {
    acc2d += dt;
    if (acc2d >= 0.1) {
      acc2d = 0;
      const out: Pos2D[] = [];
      for (const v of views) {
        const p = life.isControlled(v.id) ? humanPos.get(v.id) : posOf(v);
        if (!p) continue;
        const sig = `${p.x},${p.y},${p.dir},${p.moving},${p.seat}`;
        if (lastSent.get(v.id) === sig) continue;
        lastSent.set(v.id, sig);
        out.push(p);
      }
      if (out.length) broadcast('p2d', { p: out, gone: [] });
    }
  }
}
function startLoop() {
  if (timer || raf) return;
  lastT = performance.now();
  // aba em segundo plano: o rAF para; o intervalo mantém a vida andando devagar
  timer = setInterval(() => {
    if (document.hidden) step();
  }, 250);
  const loop = () => {
    if (!document.hidden) step();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

function setMode(next: '2d' | '3d') {
  if (next === mode) return;
  // quem era controlado volta a ser simulado
  const m = me();
  if (m?.employeeId && life2?.life.isControlled(m.employeeId)) life2.life.control(m.employeeId, false);
  mode = next;
  modeVersion = Math.max(modeVersion + 1, Date.now());
  lastStatus.clear();
  lastSent.clear();
  lifePoses.clear();
  broadcast('mode', workspace());
  setTimeout(() => broadcast('snapshot', snapshot()), 50);
}

// ---------- chat ----------
interface Msg { id: string; senderRef: string; mine: boolean; body: string; createdAt: number }
const convs = new Map<string, { peer: string; msgs: Msg[] }>();
const REPLIES = ['Oi! Já te respondo, só terminar aqui 😊', 'Claro, pode mandar.', 'Combinado!', 'Beleza, deixa comigo.', 'Vou ver isso agora e te aviso.', 'Boa! Depois me conta como ficou.', 'Pode ser logo mais, estou numa tarefa.', 'Certo, anotado.'];
function openChat(peerId: string) {
  const id = `conv_${peerId}`;
  const created = !convs.has(id);
  if (created) convs.set(id, { peer: peerId, msgs: [] });
  const e = directory().find((x) => x.id === peerId);
  return { conversationId: id, created, mode: 'demo', peer: e ? { id: e.id, name: e.name, department: e.department, extension: e.extension } : { id: peerId, name: nameOf(peerId) }, correlationId: crypto.randomUUID() };
}

// ---------- impressão ----------
const jobs = new Map<string, { id: string; fileName: string; bytes: number; createdAt: number }>();
const PRINT_LABEL: Record<string, string> = { queued: 'Na fila', sent: 'Envio confirmado pela fila', completed: 'Conclusão reportada pela fila', failed: 'Falhou' };
const jobView = (j: { id: string; fileName: string; bytes: number; createdAt: number }) => {
  const age = Date.now() - j.createdAt;
  const status = age >= 6000 ? 'completed' : age >= 2500 ? 'sent' : 'queued';
  return { id: j.id, fileName: j.fileName, bytes: j.bytes, status, statusLabel: PRINT_LABEL[status], mode: 'demo', createdAt: j.createdAt, updatedAt: Date.now() };
};

// ---------- rotas ----------
interface Res { status: number; body: unknown }
const ok = (body: unknown, status = 200): Res => ({ status, body });
const fail = (status: number, error: string, message: string): Res => ({ status, body: { error, message, correlationId: crypto.randomUUID() } });
const deny = () => fail(403, 'forbidden', 'Seu perfil não tem permissão para esta ação.');

function operationalView() {
  const base = structuredClone(get(`/api/offices/${OFF}/operational`)) as Json;
  // a mesa que estava vaga fica com a administradora
  const d = base.objects.at_mesa_06;
  const src = base.objects.at_mesa_05;
  if (d && src) {
    const emp = directory().find((e) => e.id === 'emp_aline')!;
    const byId = indexObjects(doc3d());
    const w = seatWorld(byId, byId.get('at_mesa_06')!, Object.fromEntries(assets3d().map((a) => [a.id, a])) as never);
    for (const id of ['at_mesa_06', 'ws_at_06']) {
      const o = base.objects[id];
      if (!o) continue;
      const tmpl = base.objects[id === 'at_mesa_06' ? 'at_mesa_05' : 'ws_at_05'];
      base.objects[id] = { ...tmpl, objectId: id, name: o.name, kind: o.kind, roomId: o.roomId, seat: { state: 'occupied', employee: emp }, ...(id === 'at_mesa_06' ? { seatPosition: { x: w.x, z: w.z, rotY: w.rotY } } : {}) };
    }
  }
  return base;
}

function handle(method: string, url: string, body: Json): Res | null {
  const u = new URL(url, 'http://x');
  const path = u.pathname;
  let m: RegExpMatchArray | null;

  if (method === 'GET' && path === '/api/demo/accounts') return ok({ demoMode: true, password: 'demo1234', accounts: [
    { email: 'admin@demo.office3d.local', label: 'Administrador', name: 'Aline Duarte (demo)', role: 'admin' },
    { email: 'operador@demo.office3d.local', label: 'Operador', name: 'Otávio Lima (demo)', role: 'operator' },
    { email: 'visualizador@demo.office3d.local', label: 'Visualizador', name: 'Vera Antunes (demo)', role: 'viewer' },
  ] });
  if (method === 'POST' && path === '/api/auth/login') {
    const acc = ACCOUNTS[String(body.email)];
    if (!acc || body.password !== 'demo1234') return fail(401, 'invalid_credentials', 'E-mail ou senha incorretos.');
    role = acc.role;
    try {
      sessionStorage.setItem('o3d-role', role);
    } catch {
      /* ok */
    }
    return ok({ user: fx()['GET /api/auth/me'].user });
  }
  if (method === 'POST' && path === '/api/auth/logout') {
    const mm = me();
    if (mm?.employeeId && life2?.life.isControlled(mm.employeeId)) life2.life.control(mm.employeeId, false);
    role = null;
    try {
      sessionStorage.removeItem('o3d-role');
    } catch {
      /* ok */
    }
    return ok({ ok: true });
  }
  if (path === '/api/health') return ok({ ok: true });
  if (!role) return fail(401, 'unauthenticated', 'Sessão expirada ou ausente. Entre novamente.');
  const admin = role === 'admin';
  const full = (n: string) => n.replace(':officeId', OFF);

  // ---- modo global ----
  if (method === 'GET' && path === '/api/workspace') return ok(workspace());
  if (method === 'GET' && path === '/api/admin/workspace-mode') return admin ? ok({ ...workspace(), options: ['3d', '2d'] }) : deny();
  if (method === 'PUT' && path === '/api/admin/workspace-mode') {
    if (!admin) return deny();
    if (body.mode !== '3d' && body.mode !== '2d') return fail(400, 'bad_request', 'Modo inválido. Use: 3d ou 2d.');
    if (body.mode !== mode && body.confirm !== true) return fail(400, 'confirm_required', 'Trocar o ambiente muda a tela de todos os usuários conectados. Confirme a troca.');
    setMode(body.mode);
    return ok({ ...workspace(), options: ['3d', '2d'] });
  }

  // ---- presença / avatar ----
  if (method === 'GET' && path === '/api/live/snapshot') return ok(snapshot());
  if (method === 'POST' && /^\/api\/live\/(typing|away|speaking|call)$/.test(path)) return ok({ person: null });
  if (method === 'GET' && path === '/api/avatar/catalog') {
    const c = structuredClone(get('/api/avatar/catalog')) as Json;
    c.style = mode === '2d' ? 'sprite2d' : styleAdmin;
    return ok(c);
  }
  if (method === 'GET' && path === '/api/admin/avatar-style') return admin ? ok({ ...get('/api/admin/avatar-style'), style: styleAdmin }) : deny();
  if (method === 'PUT' && path === '/api/admin/avatar-style') {
    if (!admin) return deny();
    return fail(409, 'static_demo', 'Nesta versão de demonstração o estilo de avatar fica fixo.');
  }
  if (path === '/api/avatar/me') {
    const emp = me()?.employeeId;
    if (!emp) return fail(409, 'no_employee', 'Sua conta não está ligada a um colaborador do diretório, então não tem avatar no escritório.');
    const style = mode === '2d' ? 'sprite2d' : styleAdmin;
    const cur = avatars.get(`${style}:${emp}`);
    if (method === 'GET') {
      if (cur) return ok({ style, config: cur.config, version: cur.version, updatedAt: Date.now(), saved: true });
      if (mode === '3d' && (get('/api/avatar/me') as Json).config) return ok(get('/api/avatar/me'));
      return ok({ style, config: defaultForStyle(style as never, emp), version: 0, updatedAt: 0, saved: false });
    }
    if (method === 'PUT') {
      const cfg = body.config as AnyAvatarConfig;
      const errs = validateForStyle(style as never, cfg);
      if (errs.length) return fail(422, 'invalid_avatar', 'A configuração do avatar tem itens fora do catálogo do estilo ativo.');
      if (isAraCustom(cfg)) return fail(503, 'static_demo', 'Gerar um personagem novo exige o servidor de geração; nesta demonstração escolha um dos personagens prontos.');
      const version = (cur?.version ?? 0) + 1;
      avatars.set(`${style}:${emp}`, { config: cfg, version });
      const v = activeLife().views().find((x) => x.id === emp);
      if (v) broadcast('person', livePerson(v));
      return ok({ version, style, config: cfg, updatedAt: Date.now() });
    }
  }

  // ---- diretório / escritório ----
  if (method === 'GET' && path === '/api/offices') return ok(get('/api/offices'));
  if (method === 'GET' && path === '/api/directory') return ok(get('/api/directory'));
  if (method === 'GET' && path === `/api/offices/${OFF}/operational`) return ok(operationalView());
  if (method === 'GET' && path === '/api/assets') return ok(get('/api/assets'));
  if (method === 'GET' && path === '/api/integrations/status') return ok(get('/api/integrations/status'));
  if (method === 'GET' && path === '/api/tickets/active') return ok(get('/api/tickets/active'));

  // ---- 2D ----
  if (method === 'GET' && path === full('/api/office2d/:officeId')) return ok(get(path));
  if (method === 'GET' && path === full('/api/office2d/:officeId/tv-content')) return ok(get(path));
  if (method === 'GET' && path === full('/api/office2d/:officeId/positions')) return mode !== '2d' ? fail(409, 'wrong_mode', 'O escritório 2D não está ativo: o administrador escolheu o ambiente 3D.') : ok({ positions: ensure2d().life.views().map(posOf) });
  if (method === 'POST' && path === full('/api/office2d/:officeId/join')) {
    if (mode !== '2d') return fail(409, 'wrong_mode', 'O escritório 2D não está ativo: o administrador escolheu o ambiente 3D.');
    const { life } = ensure2d();
    const emp = me()?.employeeId;
    const all = life.views();
    if (emp && !life.isControlled(emp)) {
      // a pessoa entra sentada na própria mesa (o jogador assume o controle dela)
      const st = stationOf.get(emp)!;
      const sp = seatPointOf(layout2d(), st)!;
      life.control(emp, true);
      life.setControlled(emp, { x: sp.x, y: sp.y, face: angleOfDir(sp.dir), seatId: st });
      humanPos.set(emp, { id: emp, officeId: OFF, x: sp.x, y: sp.y, dir: sp.dir, moving: false, seat: st });
    }
    const positions = life.views().map((v) => (emp && v.id === emp ? humanPos.get(emp)! : posOf(v)));
    void all;
    return ok({ me: emp ? humanPos.get(emp) : null, positions });
  }
  if (method === 'POST' && path === full('/api/office2d/:officeId/move')) {
    const emp = me()?.employeeId;
    if (!emp || mode !== '2d') return fail(409, 'wrong_mode', 'O escritório 2D não está ativo.');
    const { life } = ensure2d();
    const p: Pos2D = { id: emp, officeId: OFF, x: Number(body.x), y: Number(body.y), dir: String(body.dir), moving: body.moving === true, seat: (body.seat as string | null) ?? null };
    humanPos.set(emp, p);
    life.setControlled(emp, { x: p.x, y: p.y, face: angleOfDir(p.dir as never), seatId: p.seat });
    return ok({ ...p, corrected: false });
  }
  if (method === 'POST' && path === full('/api/office2d/:officeId/chat/open')) return ok({ ...openChat(String(body.employeeId)), mode: 'demo' });
  if ((m = path.match(/^\/api\/office2d\/[^/]+\/objects\/([^/]+)\/(remote|remote\/devices|printers)$/)) && method === 'GET') {
    const r = fx()[`GET ${path}`] ?? FX.admin[`GET ${path}`];
    return r ? ok(r) : fail(404, 'not_found', 'Objeto não encontrado.');
  }
  if ((m = path.match(/^\/api\/office2d\/[^/]+\/objects\/([^/]+)\/remote\/request$/)) && method === 'POST') {
    const list = (FX.admin[`GET ${path.replace('/request', '/devices')}`]?.devices ?? []) as Json[];
    const dev = list.find((d) => d.id === body.deviceId) ?? list.find((d) => d.bound) ?? list[0];
    if (!dev) return fail(404, 'not_found', 'Dispositivo não encontrado.');
    return ok({ requestId: `rar_${Date.now()}`, mode: 'demo', status: 'demo_recorded', provider: dev.provider, device: { id: dev.id, name: dev.name }, note: `Demonstração: o pedido de acesso a ${dev.name} foi registrado, mas nada foi aberto nem conectado.`, correlationId: crypto.randomUUID() });
  }
  if ((m = path.match(/^\/api\/office2d\/[^/]+\/objects\/[^/]+\/print\/jobs$/)) && method === 'POST') return printJob(u, body);
  if (method === 'GET' && path === full('/api/admin/office2d/:officeId/draft')) return admin ? ok(get(path)) : deny();
  if (method === 'GET' && path === full('/api/admin/office2d/:officeId/devices')) return admin ? ok(get(path)) : deny();
  if (method === 'GET' && /^\/api\/admin\//.test(path)) {
    if (!admin) return deny();
    const r = FX.admin[`GET ${path}${u.search}`] ?? FX.admin[`GET ${path}`];
    return r ? ok(r) : fail(404, 'not_found', 'Não encontrado.');
  }

  // ---- ações do 3D ----
  if (method === 'POST' && path === `/api/offices/${OFF}/actions/chat/open`) {
    const o = (operationalView().objects as Json)[String(body.objectId)];
    const peer = o?.seat?.employee;
    return peer ? ok(openChat(peer.id)) : fail(404, 'not_found', 'Não há colaborador neste posto.');
  }
  if (method === 'GET' && (m = path.match(/^\/api\/chat\/conversations\/([^/]+)\/messages$/))) {
    const c = convs.get(m[1]);
    return c ? ok({ mode: 'demo', messages: c.msgs }) : fail(404, 'not_found', 'Conversa não encontrada.');
  }
  if (method === 'POST' && (m = path.match(/^\/api\/chat\/conversations\/([^/]+)\/messages$/))) {
    if (role === 'viewer') return fail(403, 'forbidden', 'O perfil de visualizador não envia mensagens.');
    const c = convs.get(m[1]);
    const text = String(body.body ?? '').trim();
    if (!c || !text) return fail(400, 'bad_request', 'Mensagem vazia ou longa demais.');
    const msg: Msg = { id: `msg_${Date.now()}`, senderRef: me()?.employeeId ?? 'me', mine: true, body: text, createdAt: Date.now() };
    c.msgs.push(msg);
    const busy = activeLife().views().find((v) => v.id === c.peer)?.status === 'in_call';
    setTimeout(() => c.msgs.push({ id: `msg_${Date.now()}`, senderRef: c.peer, mine: false, body: busy ? 'Estou em atendimento agora, te respondo em seguida!' : REPLIES[Math.floor(Math.random() * REPLIES.length)], createdAt: Date.now() }), 1800 + Math.random() * 1800);
    return ok({ mode: 'demo', message: msg }, 201);
  }
  if (method === 'POST' && path === `/api/offices/${OFF}/actions/remote/request`) {
    if (body.confirm !== true) return fail(400, 'confirmation_required', 'O acesso remoto precisa de confirmação explícita.');
    const o = (operationalView().objects as Json)[String(body.objectId)];
    const name = o?.name ?? 'o dispositivo';
    return ok({ requestId: `rar_${Date.now()}`, mode: 'demo', status: 'demo_recorded', provider: 'anydesk', device: { id: 'dev', name }, note: `Demonstração: o pedido de acesso remoto a ${name} foi registrado, mas nada foi aberto nem conectado.`, object: name, correlationId: crypto.randomUUID() });
  }
  if (method === 'POST' && path === `/api/offices/${OFF}/actions/transfer`) {
    if (body.confirm !== true) return fail(400, 'confirmation_required', 'A transferência precisa de confirmação explícita.');
    const o = (operationalView().objects as Json)[String(body.objectId)];
    const t = (get('/api/tickets/active') as Json).tickets.find((x: Json) => x.id === body.ticketId);
    return ok({ mode: 'demo', transferId: `trf_${Date.now()}`, ticket: { ...t, version: (t?.version ?? 1) + 1, queue: o?.seat?.employee?.department ?? 'Atendimento' }, recipient: o?.seat?.employee, confirmedAt: Date.now(), correlationId: crypto.randomUUID(), replayed: false });
  }
  if (method === 'POST' && path === `/api/offices/${OFF}/actions/print/dialog`) return ok({ status: 'dialog_opened', note: 'O diálogo de impressão do navegador foi aberto. O sistema não sabe qual impressora foi escolhida nem se o documento foi impresso.', correlationId: crypto.randomUUID() });
  if (method === 'POST' && path === `/api/offices/${OFF}/actions/print/jobs`) return printJob(u, body);
  if (method === 'GET' && (m = path.match(/^\/api\/print\/jobs\/([^/]+)$/))) {
    const j = jobs.get(m[1]);
    return j ? ok({ job: jobView(j) }) : fail(404, 'not_found', 'Trabalho de impressão não encontrado.');
  }
  if (method === 'POST' && (m = path.match(/^\/api\/offices\/[^/]+\/actions\/(dashboard|cad)\/open$/))) {
    const o = (operationalView().objects as Json)[String(body.objectId)];
    return ok({ name: o?.name ?? 'Painel', url: '/demo/dashboard.html', mode: 'demo', correlationId: crypto.randomUUID() });
  }
  if (method === 'POST' && path === '/api/demo/outage') return ok({ integrations: get('/api/integrations/status').integrations });
  if (method === 'GET' && path === `/api/offices/${OFF}/draft`) return role === 'admin' ? ok(get(path)) : deny();

  // edições do administrador (editor, vínculos, TVs): a demonstração é somente leitura para o que mudaria o escritório
  if (method !== 'GET') return fail(409, 'static_demo', 'Esta versão de demonstração roda no navegador e não grava alterações do escritório. Rode o projeto localmente para usar o editor completo.');
  const r = fx()[`GET ${path}${u.search}`] ?? fx()[`GET ${path}`];
  return r ? ok(r) : fail(404, 'not_found', `Sem dados de demonstração para ${path}.`);
}

function printJob(u: URL, _body: Json): Res {
  if (u.searchParams.get('confirm') !== 'true') return fail(400, 'confirmation_required', 'O envio para a impressora precisa de confirmação explícita.');
  const id = `prn_${Date.now()}`;
  const j = { id, fileName: u.searchParams.get('fileName') ?? 'documento.pdf', bytes: 0, createdAt: Date.now() };
  jobs.set(id, j);
  const printer = u.searchParams.get('deviceId') ?? 'dev_prn_at_01';
  return ok({ job: jobView(j), printer: { id: printer, name: printer === 'dev_prn_recepcao' ? 'IMP-RECEPCAO' : 'IMP-ATD-01' }, retentionMinutes: 10, correlationId: crypto.randomUUID() }, 201);
}

// ---------- instalação ----------
export function installStaticBackend() {
  // ?embed: a demonstração está num quadro dentro de uma página. A roda do mouse sobre o mapa NÃO dá zoom (atrapalharia rolar a
  // página): o movimento é repassado à página que embute. Listas e painéis do app continuam rolando normalmente.
  if (new URLSearchParams(location.search).has('embed')) {
    window.addEventListener(
      'wheel',
      (e) => {
        const t = e.target as HTMLElement | null;
        if (!t || (t.tagName !== 'CANVAS' && !t.closest?.('[data-engine], .office2d-canvas'))) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        window.parent?.postMessage({ o3dWheel: e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY }, location.origin);
      },
      { capture: true, passive: false },
    );
  }
  // ?auto=2d|3d: entra direto como administradora no modo pedido (usado pelas páginas que embutem a demonstração)
  const auto = new URLSearchParams(location.search).get('auto');
  if (auto === '2d' || auto === '3d') {
    role = 'admin';
    mode = auto;
    modeVersion = Date.now();
    try {
      sessionStorage.setItem('o3d-role', 'admin');
    } catch {
      /* ok */
    }
    // no 2D a câmera começa perto demais para um quadro embutido: afasta assim que os controles aparecem
    if (auto === '2d') {
      let tries = 0;
      const t = setInterval(() => {
        const btn = document.querySelector<HTMLButtonElement>('[aria-label="Afastar"]');
        if (btn) {
          for (let i = 0; i < 4; i++) btn.click();
          clearInterval(t);
        } else if (++tries > 60) clearInterval(t);
      }, 300);
    }
  }
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const rel = url.startsWith(location.origin) ? url.slice(location.origin.length) : url;
    if (!rel.startsWith('/api/')) return realFetch(input as never, init);
    const method = (init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET')).toUpperCase();
    let body: Json = {};
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = {};
      }
    }
    await new Promise((r) => setTimeout(r, 15));
    let res: Res | null = null;
    try {
      res = handle(method, rel, body);
    } catch (e) {
      console.error('[demo estática]', method, rel, e);
      res = fail(500, 'error', 'Erro inesperado na demonstração.');
    }
    const r = res ?? fail(404, 'not_found', 'Rota inexistente.');
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  (window as unknown as { EventSource: unknown }).EventSource = MockEventSource;
  startLoop();
  void TILE;
  void SPEED_2D;
}
