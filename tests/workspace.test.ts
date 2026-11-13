import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultAvatar2D, validateAvatar2D, type Avatar2DConfig } from '../shared/avatar2d';
import { defaultAvatar } from '../shared/avatarCatalog';
import { TILE, seatOfObject, type Layout2D } from '../shared/office2d';
import { defaultLayout2D } from '../shared/office2dDefault';
import { DemoCallSource, LiveHub } from '../server/live';
import { ADMIN, Client, OPERATOR, OTHER_ADMIN, VIEWER, startServer, type TestServer } from './helpers';

/** Lê eventos SSE de /api/live/stream com a sessão do cliente. */
async function stream(base: string, c: Client) {
  const ac = new AbortController();
  const res = await fetch(base + '/api/live/stream', { headers: { Cookie: c.cookie }, signal: ac.signal });
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(chunk)?.[1];
          const data = /^data: (.+)$/m.exec(chunk)?.[1];
          if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
        }
      }
    } catch {
      /* fechado */
    }
  })();
  const waitFor = async (pred: (e: { event: string; data: Record<string, unknown> }) => boolean, ms = 4000) => {
    const t0 = Date.now();
    for (;;) {
      const hit = events.find(pred);
      if (hit) return hit;
      if (Date.now() - t0 > ms) throw new Error('evento não chegou');
      await new Promise((r) => setTimeout(r, 30));
    }
  };
  return { events, waitFor, close: () => ac.abort() };
}

const OFFICE = 'off_sede_1';
let s: TestServer;
let admin: Client, operator: Client, viewer: Client, other: Client;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Pos = { id: string; x: number; y: number; dir: string; moving: boolean; seat: string | null; corrected?: boolean };

beforeAll(async () => {
  s = await startServer({ PRESENCE_GRACE_MS: '700' });
  admin = await new Client(s.url).login(ADMIN);
  operator = await new Client(s.url).login(OPERATOR);
  viewer = await new Client(s.url).login(VIEWER);
  other = await new Client(s.url).login(OTHER_ADMIN);
}, 30000);
afterAll(async () => {
  s.ctx.ara.close();
  s.ctx.office2d.stop();
  await s.close();
});

const setMode = (c: Client, mode: string, confirm = true) => c.put<{ mode: string; version: number }>('/api/admin/workspace-mode', { mode, confirm });

describe('modo global 2D / 3D (só o administrador troca)', () => {
  it('o padrão é 3D; qualquer perfil lê o modo; só o administrador lê as opções e troca', async () => {
    for (const c of [admin, operator, viewer]) expect((await c.get<{ mode: string }>('/api/workspace')).body.mode).toBe('3d');
    expect((await admin.get('/api/admin/workspace-mode')).status).toBe(200);
    for (const c of [operator, viewer]) {
      expect((await c.get('/api/admin/workspace-mode')).status).toBe(403);
      expect((await setMode(c, '2d')).status).toBe(403);
    }
    expect((await s.ctx.live.workspaceState('co_acme')).mode).toBe('3d');
  });

  it('a troca exige confirmação e um modo válido; trocar para o modo em vigor não faz nada', async () => {
    expect((await setMode(admin, '2d', false)).status).toBe(400);
    expect((await admin.put('/api/admin/workspace-mode', { mode: '2d' })).status).toBe(400);
    expect((await setMode(admin, '4d')).status).toBe(400);
    expect((await setMode(admin, '3d')).status).toBe(200); // já é 3D: sem efeito
    expect((await admin.get<{ mode: string }>('/api/workspace')).body.mode).toBe('3d');
  });

  it('todos os conectados recebem a troca em tempo real (evento e snapshot novo), preservando a sessão; outra empresa não é afetada', async () => {
    const [a, o, v, x] = await Promise.all([stream(s.url, admin), stream(s.url, operator), stream(s.url, viewer), stream(s.url, other)]);
    try {
      await Promise.all([a, o, v, x].map((st) => st.waitFor((e) => e.event === 'snapshot')));
      const r = await setMode(admin, '2d');
      expect(r.status).toBe(200);
      for (const st of [a, o, v]) {
        const ev = await st.waitFor((e) => e.event === 'mode');
        expect(ev.data.mode).toBe('2d');
        const snap = await st.waitFor((e) => e.event === 'snapshot' && (e.data.workspace as { mode: string }).mode === '2d');
        expect(snap.data.avatarStyle).toBe('sprite2d'); // as aparências passam a ser as do 2D
      }
      expect((await operator.get<{ mode: string }>('/api/workspace')).body.mode).toBe('2d'); // mesma sessão, sem novo login
      await sleep(300);
      expect(x.events.some((e) => e.event === 'mode')).toBe(false);
      expect((await other.get<{ mode: string }>('/api/workspace')).body.mode).toBe('3d');
    } finally {
      for (const st of [a, o, v, x]) st.close();
    }
  });

  it('o modo persiste: um servidor novo (mesmo banco) continua no 2D; a versão cresce a cada troca', async () => {
    const fresh = new LiveHub(s.ctx.db, s.ctx.cfg.live, new DemoCallSource(), true);
    const st = await fresh.workspaceState('co_acme');
    expect(st.mode).toBe('2d');
    expect(st.version).toBeGreaterThan(0);
    const back = (await setMode(admin, '3d')).body;
    expect(back.mode).toBe('3d');
    expect(back.version).toBeGreaterThan(st.version);
    const again = (await setMode(admin, '2d')).body;
    expect(again.version).toBeGreaterThan(back.version);
    const audit = (await admin.get<{ entries: Array<{ action: string }> }>('/api/admin/audit?limit=50')).body.entries;
    expect(audit.filter((e) => e.action === 'workspace.mode').length).toBeGreaterThanOrEqual(3);
  });
});

describe('escritório 2D: entrada e movimentação validadas pelo servidor', () => {
  let layout: Layout2D;
  let me: Pos;
  // no navegador há sempre uma conexão em tempo real aberta; sem ela a pessoa conta como offline e sai do escritório
  const online: Array<{ close: () => void }> = [];
  beforeAll(async () => {
    for (const c of [operator, admin]) online.push(await stream(s.url, c));
  });
  afterAll(() => online.forEach((o) => o.close()));
  const move = (c: Client, x: number, y: number, extra: Record<string, unknown> = {}) => c.post<Pos>(`/api/office2d/${OFFICE}/move`, { x, y, dir: 'down', moving: true, seat: null, ...extra });

  it('no modo 3D, entrar e mover são recusados (o escritório 2D não está ativo)', async () => {
    await setMode(admin, '3d');
    expect((await operator.post(`/api/office2d/${OFFICE}/join`)).status).toBe(409);
    expect((await move(operator, 100, 100)).status).toBe(409);
    await setMode(admin, '2d');
  });

  it('o layout é o padrão até o administrador publicar; entrar coloca a pessoa numa entrada livre', async () => {
    const r = (await operator.get<{ layout: Layout2D; version: number; published: boolean }>(`/api/office2d/${OFFICE}`)).body;
    expect(r.published).toBe(false);
    expect(r.version).toBe(0);
    layout = r.layout;
    expect(layout.stations).toHaveLength(12);
    const j = await operator.post<{ me: Pos; positions: Pos[] }>(`/api/office2d/${OFFICE}/join`);
    expect(j.status).toBe(200);
    me = j.body.me;
    expect(me.id).toBe('emp_otavio');
    expect(me.seat).toBe('st5'); // a estação vinculada a ele no demo: ele entra sentado nela
    const sp5 = seatOfObject(layout.objects.find((o) => o.id === layout.stations.find((s) => s.id === 'st5')!.objectId)!)!;
    expect([me.x, me.y]).toEqual([sp5.x, sp5.y]);
    expect(j.body.positions.map((p) => p.id)).toContain('emp_otavio');
    expect((await operator.post<{ me: Pos }>(`/api/office2d/${OFFICE}/join`)).body.me).toMatchObject({ x: me.x, y: me.y }); // entrar de novo não duplica nem muda
  });

  it('aceita um passo plausível; recusa parede, salto e velocidade absurda, mantendo a posição anterior', async () => {
    await sleep(120);
    const ok = await move(operator, me.x + 3, me.y);
    expect(ok.status).toBe(200);
    expect(ok.body.corrected).toBe(false);
    expect(ok.body.x).toBeCloseTo(me.x + 3);
    await sleep(120);
    const wall = await move(operator, 2 * TILE + 16, me.y); // parede externa à esquerda, longe: salto E parede
    expect(wall.body.corrected).toBe(true);
    expect(wall.body.x).toBeCloseTo(me.x + 3);
    await sleep(120);
    const jump = await move(operator, me.x + 300, me.y - 200);
    expect(jump.body.corrected).toBe(true);
    await sleep(120);
    const fast = await move(operator, me.x + 3 + 90, me.y); // 90 px em ~0,12 s = 750 px/s
    expect(fast.body.corrected).toBe(true);
    expect((await move(operator, Number.NaN, 1)).status).toBe(400);
    expect((await move(operator, 10, 10, { dir: 'cima' })).status).toBe(400);
  });

  it('não atravessa parede fina com um salto curto; andar normal até lá funciona', async () => {
    // a parede interna x=16 tem aberturas só em y=7,8 e 21,22: de (15, 14) para (17, 14) atravessaria parede
    const wallRowY = 14 * TILE + 16;
    await sleep(120);
    const jump = await move(operator, 17 * TILE + 16, wallRowY);
    expect(jump.body.corrected).toBe(true);
  });

  it('só se move a si mesmo: campos "id" e "employeeId" no corpo são ignorados', async () => {
    await sleep(120);
    const before = (await operator.get<{ me: Pos }>(`/api/office2d/${OFFICE}`)).status;
    expect(before).toBe(200);
    const r = await operator.post<Pos>(`/api/office2d/${OFFICE}/move`, { x: me.x + 4, y: me.y, dir: 'down', moving: true, seat: null, id: 'emp_aline', employeeId: 'emp_aline' });
    expect(r.body.id).toBe('emp_otavio');
    const adminJoin = await admin.post<{ me: Pos; positions: Pos[] }>(`/api/office2d/${OFFICE}/join`);
    const otavio = adminJoin.body.positions.find((p) => p.id === 'emp_otavio')!;
    expect(otavio.x).toBeCloseTo(me.x + 4);
    expect(adminJoin.body.me.id).toBe('emp_aline');
  });

  it('sentar: só no lugar de uma estação livre, perto e sem parede no caminho; ocupada por outra pessoa, não', async () => {
    const st = layout.stations.find((s) => s.id === 'st12')!; // sem pessoa vinculada
    const sp = seatOfObject(layout.objects.find((o) => o.id === st.objectId)!)!;
    await sleep(120);
    const far = await move(operator, sp.x, sp.y, { seat: st.id, moving: false }); // está longe da mesa
    expect(far.body.corrected).toBe(true);
    // leva a pessoa até lá em passos plausíveis (sem parede no caminho: a mesa fica no mesmo ambiente depois de uma porta; usa a rota do mapa)
    const { findPath, gridOf } = await import('../shared/office2d');
    const grid = gridOf(layout);
    const path = findPath(grid, { x: Math.floor(me.x / TILE), y: Math.floor(me.y / TILE) }, { x: sp.cx, y: sp.cy });
    expect(path.length).toBeGreaterThan(5);
    let cur = { x: me.x + 4, y: me.y };
    for (const c of path) {
      const tx = c.x * TILE + TILE / 2;
      const ty = c.y * TILE + TILE / 2;
      while (Math.hypot(tx - cur.x, ty - cur.y) > 0.5) {
        const d = Math.hypot(tx - cur.x, ty - cur.y);
        const step = Math.min(d, 5);
        cur = { x: cur.x + ((tx - cur.x) / d) * step, y: cur.y + ((ty - cur.y) / d) * step };
        await sleep(45);
        const r = await move(operator, cur.x, cur.y);
        if (r.body.corrected) {
          cur = { x: r.body.x, y: r.body.y };
          break;
        }
      }
    }
    await sleep(120);
    const sit = await move(operator, sp.x, sp.y, { seat: st.id, moving: false });
    expect(sit.body.corrected).toBe(false);
    expect(sit.body).toMatchObject({ seat: st.id, x: sp.x, y: sp.y, dir: sp.dir });
    // outra pessoa tenta a mesma estação (ocupada): recusada
    await admin.post(`/api/office2d/${OFFICE}/join`);
    const stolen = await admin.post<Pos>(`/api/office2d/${OFFICE}/move`, { x: sp.x, y: sp.y, dir: 'up', moving: false, seat: st.id });
    expect(stolen.body.corrected).toBe(true);
  }, 120000);

  it('visualizador e usuário de outra empresa: sem entrada (observador / 404)', async () => {
    expect((await viewer.post(`/api/office2d/${OFFICE}/join`)).status).toBe(409);
    expect((await other.get(`/api/office2d/${OFFICE}`)).status).toBe(404);
    expect((await other.post(`/api/office2d/${OFFICE}/join`)).status).toBe(404);
    expect((await viewer.get(`/api/office2d/${OFFICE}`)).status).toBe(200); // pode ver o mapa
  });

  it('as posições chegam em lotes aos colegas da empresa (e só a eles); quem fica offline sai do escritório', async () => {
    const watcher = await stream(s.url, viewer); // visualizador não recebe presença
    const peer = await stream(s.url, admin);
    try {
      await peer.waitFor((e) => e.event === 'snapshot');
      const j = (await operator.post<{ me: Pos }>(`/api/office2d/${OFFICE}/join`)).body.me;
      await sleep(150);
      await move(operator, j.x + 2, j.y, { seat: j.seat });
      const ev = await peer.waitFor((e) => e.event === 'p2d' && (e.data.p as Pos[]).some((p) => p.id === 'emp_otavio'));
      expect((ev.data.p as Pos[])[0]).toHaveProperty('x');
      expect(watcher.events.some((e) => e.event === 'p2d')).toBe(false);
    } finally {
      watcher.close();
      peer.close();
    }
  });
});

describe('editor do escritório 2D (administrador): rascunho, publicação, estações', () => {
  let v = 0;
  const draft = () => admin.get<{ layout: Layout2D; version: number; publishedVersion: number; isDefault: boolean }>(`/api/admin/office2d/${OFFICE}/draft`);

  it('só o administrador edita; o rascunho começa no layout padrão', async () => {
    for (const c of [operator, viewer]) {
      expect((await c.get(`/api/admin/office2d/${OFFICE}/draft`)).status).toBe(403);
      expect((await c.put(`/api/admin/office2d/${OFFICE}/draft`, { layout: defaultLayout2D(), baseVersion: 0 })).status).toBe(403);
      expect((await c.post(`/api/admin/office2d/${OFFICE}/publish`, { baseVersion: 0 })).status).toBe(403);
      expect((await c.get(`/api/admin/office2d/${OFFICE}/tiled`)).status).toBe(403);
    }
    expect((await other.get(`/api/admin/office2d/${OFFICE}/draft`)).status).toBe(404); // outra empresa
    const d = (await draft()).body;
    expect(d.isDefault).toBe(true);
    expect(d.version).toBe(0);
  });

  it('o servidor recusa layout inválido (422, sem salvar) e conflito de versão (409)', async () => {
    const base = defaultLayout2D();
    const bad = { ...base, objects: [...base.objects, { id: 'x1', asset: 'plant', x: 2, y: 5, rot: 0 }] }; // sobre a parede
    const r = await admin.put<{ details: string[] }>(`/api/admin/office2d/${OFFICE}/draft`, { layout: bad, baseVersion: 0 });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toMatch(/parede/);
    expect((await admin.put(`/api/admin/office2d/${OFFICE}/draft`, { layout: { ...base, weapon: 1 }, baseVersion: 0 })).status).toBe(422);
    expect((await admin.put(`/api/admin/office2d/${OFFICE}/draft`, { layout: base })).status).toBe(400);
    expect((await draft()).body.version).toBe(0); // nada foi salvo
    const ok = await admin.put<{ version: number }>(`/api/admin/office2d/${OFFICE}/draft`, { layout: base, baseVersion: 0 });
    expect(ok.status).toBe(200);
    v = ok.body.version;
    expect(v).toBe(1);
    expect((await admin.put(`/api/admin/office2d/${OFFICE}/draft`, { layout: base, baseVersion: 0 })).status).toBe(409); // base antiga
  });

  it('estações: vincula uma pessoa por estação, move o vínculo, libera; só o administrador', async () => {
    const st = defaultLayout2D().stations;
    const put = (c: Client, station: string, employeeId: string | null) => c.put<{ seats: Array<{ stationId: string; employeeId: string }> }>(`/api/admin/office2d/${OFFICE}/seats/${station}`, { employeeId });
    expect((await put(operator, st[0].id, 'emp_otavio')).status).toBe(403);
    expect((await put(admin, 'nao-existe', 'emp_otavio')).status).toBe(404);
    expect((await put(admin, st[0].id, 'emp_inexistente')).status).toBe(404);
    const mine = (seats: Array<{ stationId: string; employeeId: string }>, emp: string) => seats.filter((x) => x.employeeId === emp);
    expect(mine((await put(admin, st[0].id, 'emp_otavio')).body.seats, 'emp_otavio')).toEqual([expect.objectContaining({ stationId: st[0].id })]);
    const moved = mine((await put(admin, st[1].id, 'emp_otavio')).body.seats, 'emp_otavio'); // uma pessoa, uma estação: o vínculo anterior sai
    expect(moved).toHaveLength(1);
    expect(moved[0].stationId).toBe(st[1].id);
    expect(mine((await put(admin, st[1].id, null)).body.seats, 'emp_otavio')).toEqual([]);
    expect(mine((await put(admin, st[2].id, 'emp_ana')).body.seats, 'emp_ana')).toEqual([expect.objectContaining({ stationId: st[2].id })]); // st3 passou a ser da Ana
  });

  it('publicar: o layout vira o oficial, todos recebem o aviso, quem estava sentado numa estação removida levanta e vínculos órfãos saem', async () => {
    const peer = await stream(s.url, operator);
    try {
      await peer.waitFor((e) => e.event === 'snapshot');
      const base = (await draft()).body.layout;
      const joined = (await operator.post<{ me: Pos }>(`/api/office2d/${OFFICE}/join`)).body.me;
      expect(joined.seat).toBe('st12'); // sentou na estação st12 no teste anterior
      // novo layout: sem a estação st12 (e a mesa dela) e sem a estação st3
      const next: Layout2D = JSON.parse(JSON.stringify(base));
      const gone = next.stations.find((x) => x.id === 'st12')!;
      next.stations = next.stations.filter((x) => x.id !== 'st12' && x.id !== 'st3');
      next.objects = next.objects.filter((o) => o.id !== gone.objectId);
      expect((await admin.put(`/api/admin/office2d/${OFFICE}/draft`, { layout: next, baseVersion: v })).status).toBe(200);
      v++;
      expect((await admin.post(`/api/admin/office2d/${OFFICE}/publish`, { baseVersion: v - 1 })).status).toBe(409); // base desatualizada
      const pub = await admin.post<{ version: number }>(`/api/admin/office2d/${OFFICE}/publish`, { baseVersion: v });
      expect(pub.status).toBe(200);
      expect(pub.body.version).toBe(1);
      await peer.waitFor((e) => e.event === 'layout2d' && e.data.version === 1);
      const now = (await operator.get<{ layout: Layout2D; version: number; published: boolean }>(`/api/office2d/${OFFICE}`)).body;
      expect(now.published).toBe(true);
      expect(now.version).toBe(1);
      expect(now.layout.stations.map((x) => x.id)).not.toContain('st12');
      const after = (await admin.post<{ positions: Pos[] }>(`/api/office2d/${OFFICE}/join`)).body.positions.find((p) => p.id === 'emp_otavio')!;
      expect(after.seat).toBeNull(); // a estação deixou de existir: levantou
      const seats = (await admin.get<{ seats: Array<{ stationId: string }> }>(`/api/admin/office2d/${OFFICE}/draft`)).body.seats;
      expect(seats.find((x) => x.stationId === 'st3')).toBeUndefined(); // vínculo órfão removido
    } finally {
      peer.close();
    }
  });

  it('exporta no formato do Tiled (camadas de piso, paredes, colisão, objetos e entradas)', async () => {
    const r = await admin.get<{ layers: Array<{ name: string }>; orientation: string }>(`/api/admin/office2d/${OFFICE}/tiled?which=published`);
    expect(r.status).toBe(200);
    expect(r.body.orientation).toBe('orthogonal');
    expect(r.body.layers.map((l) => l.name)).toEqual(['piso', 'paredes', 'colisao', 'objetos', 'entradas']);
  });
});

describe('ausente e avatar 2D', () => {
  it('"ausente" vale só para a própria pessoa; digitando e em atendimento têm prioridade', async () => {
    const st = await stream(s.url, operator);
    try {
      await st.waitFor((e) => e.event === 'snapshot');
      const person = async () => ((await admin.get<{ people: Array<{ employeeId: string; status: string }> }>('/api/live/snapshot')).body.people.find((p) => p.employeeId === 'emp_otavio')!).status;
      expect((await operator.post('/api/live/away', { away: 'sim' })).status).toBe(400);
      expect((await operator.post('/api/live/away', { away: true, employeeId: 'emp_aline' })).status).toBe(200);
      expect(await person()).toBe('away');
      await operator.post('/api/live/typing', { state: 'start' });
      expect(await person()).toBe('typing'); // digitando vence ausente
      await operator.post('/api/live/typing', { state: 'stop' });
      expect(await person()).toBe('away');
      await operator.post('/api/live/away', { away: false });
      expect(await person()).toBe('online');
    } finally {
      st.close();
    }
  });

  it('no modo 2D o avatar é o sprite: padrão válido, edição só do próprio, config do 3D recusada; ao voltar ao 3D a escolha do 3D continua', async () => {
    const mine = (await operator.get<{ style: string; config: Avatar2DConfig; version: number; saved: boolean }>('/api/avatar/me')).body;
    expect(mine.style).toBe('sprite2d');
    expect(mine.saved).toBe(false);
    expect(validateAvatar2D(mine.config)).toEqual([]);
    expect(mine.config).toEqual(defaultAvatar2D('emp_otavio'));
    const changed: Avatar2DConfig = { ...mine.config, hair: 'bun', hairColor: '#a0652a', glasses: true, headsetAlways: true };
    const saved = await operator.put<{ version: number; config: Avatar2DConfig }>('/api/avatar/me', { config: changed, baseVersion: mine.version });
    expect(saved.status).toBe(200);
    expect(saved.body.config.hair).toBe('bun');
    expect((await operator.put('/api/avatar/me', { config: defaultAvatar('x'), baseVersion: saved.body.version })).status).toBe(422); // config do MakeHuman
    expect((await operator.put('/api/avatar/me', { config: { ...changed, hair: 'laser' }, baseVersion: saved.body.version })).status).toBe(422);
    expect((await admin.put('/api/avatar/employees/emp_otavio', { config: changed, baseVersion: saved.body.version })).status).toBe(403);
    // presença: os colegas recebem a aparência 2D
    const snap = (await admin.get<{ people: Array<{ employeeId: string; appearance: { config: Avatar2DConfig } | null }> }>('/api/live/snapshot')).body.people.find((p) => p.employeeId === 'emp_otavio');
    expect(snap?.appearance?.config.hair).toBe('bun');
    // volta ao 3D: a escolha do estilo 3D não foi tocada
    await setMode(admin, '3d');
    const back = (await operator.get<{ style: string }>('/api/avatar/me')).body;
    expect(back.style).not.toBe('sprite2d');
    await setMode(admin, '2d');
    expect((await operator.get<{ config: Avatar2DConfig }>('/api/avatar/me')).body.config.hair).toBe('bun'); // e a do 2D continua
    await setMode(admin, '3d');
  });
});
