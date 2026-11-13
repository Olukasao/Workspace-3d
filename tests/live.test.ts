import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AVATAR_CATALOG, LOOKS, defaultAvatar, switchBase, validateAvatar, type AvatarConfig } from '../shared/avatarCatalog';
import { ARA_CHARACTERS, defaultAraAvatar, validateAraAvatar, validateForStyle, type AraPresetConfig } from '../shared/avatarAra';
import { ADMIN, Client, OPERATOR, OTHER_ADMIN, VIEWER, startServer, type TestServer } from './helpers';

/** Lê eventos SSE de /api/live/stream com a sessão do cliente. */
async function stream(base: string, c: Client) {
  const ac = new AbortController();
  const res = await fetch(base + '/api/live/stream', { headers: { Cookie: c.cookie }, signal: ac.signal });
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  (async () => {
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
  return { status: res.status, events, waitFor, close: () => ac.abort() };
}

const OTAVIO = 'emp_otavio'; // operador
const ALINE = 'emp_aline'; // administradora

let s: TestServer;
let admin: Client;
let operator: Client;
let viewer: Client;
let other: Client;

beforeAll(async () => {
  s = await startServer({ PRESENCE_GRACE_MS: '700', TYPING_TTL_MS: '600', SPEAKING_TTL_MS: '600' });
  admin = await new Client(s.url).login(ADMIN);
  operator = await new Client(s.url).login(OPERATOR);
  viewer = await new Client(s.url).login(VIEWER);
  other = await new Client(s.url).login(OTHER_ADMIN);
});
afterAll(() => s.close());

const person = async (c: Client, id: string) => ((await c.get<{ people: Array<Record<string, unknown>> }>('/api/live/snapshot')).body.people.find((p) => p.employeeId === id)) as Record<string, unknown> & { status: string; call: { speaking: boolean | null } | null; appearance: { version: number; config: AvatarConfig } | null; version: number };

describe('catálogo de avatares', () => {
  it('looks prontos são válidos; há casual e corporativo para as duas bases', () => {
    for (const l of LOOKS) expect(validateAvatar({ v: 1, skin: 'pele-1', face: 'rosto-1', headsetAlways: false, ...l.config }), l.id).toEqual([]);
    for (const base of ['male', 'female']) for (const style of ['casual', 'corporate']) expect(LOOKS.some((l) => l.base === base && l.style === style)).toBe(true);
  });
  it('trocar o corpo preserva o compatível e usa peça padrão no incompatível', () => {
    const m = { ...defaultAvatar('x'), ...LOOKS.find((l) => l.id === 'm-corp')!.config };
    const f = switchBase(m, 'female');
    expect(f.base).toBe('female');
    expect(f.hair).toBe(m.hair); // cabelo serve nas duas bases
    expect(f.glasses).toBe(m.glasses);
    expect(f.top).not.toBe(m.top); // terno masculino não serve
    expect(f.beard).toBe('none');
    expect(validateAvatar(f)).toEqual([]);
  });
  it('toda peça do catálogo tem arquivo distribuído em cada base; nada fora do catálogo é distribuído', () => {
    const m = JSON.parse(readFileSync(path.join(import.meta.dirname, '../public/assets/avatars/manifest.json'), 'utf8')) as { bases: Record<string, { items: Array<{ id: string; file: string; meta: Record<string, string> }> }>; files: Record<string, unknown> };
    for (const c of AVATAR_CATALOG) {
      for (const b of c.bases) {
        const it = m.bases[b].items.find((i) => i.id === c.id);
        expect(it, `${c.id} (${b})`).toBeTruthy();
        expect(m.files[it!.file], it!.file).toBeTruthy();
        expect(existsSync(path.join(import.meta.dirname, '../public/assets/avatars', it!.file)), it!.file).toBe(true);
        expect(it!.meta.license, `${c.id}: licença`).toBeTruthy();
      }
    }
    for (const [b, base] of Object.entries(m.bases)) for (const it of base.items) expect(AVATAR_CATALOG.some((c) => c.id === it.id && c.bases.includes(b as 'male' | 'female')), `${it.id} (${b}) fora do catálogo`).toBe(true);
  });
  it('recusa peça fora do catálogo, incompatível ou cor fora da paleta', () => {
    const ok = defaultAvatar('y');
    expect(validateAvatar({ ...ok, top: 'top.inexistente' }).join(' ')).toMatch(/não existe/);
    expect(validateAvatar({ ...ok, base: 'female', beard: 'beard.wdg_scruffy_beard' }).join(' ')).toMatch(/compatível|não existe/);
    expect(validateAvatar({ ...ok, hairColor: '#ff00ff' }).join(' ')).toMatch(/Cor/);
    expect(validateAvatar({ ...ok, extra: 1 }).join(' ')).toMatch(/desconhecidos/);
  });
});

describe('aparência persistida (estilo MakeHuman)', () => {
  beforeAll(async () => {
    expect((await admin.put('/api/admin/avatar-style', { style: 'makehuman' })).status).toBe(200);
  });
  afterAll(async () => {
    await admin.put('/api/admin/avatar-style', { style: 'ara3d' });
  });
  it('só o próprio colaborador edita; outro colaborador (nem admin) não edita o meu avatar', async () => {
    const mine = (await operator.get<{ config: AvatarConfig; version: number }>('/api/avatar/me')).body;
    const changed = { ...mine.config, topColor: 'vinho' };
    expect((await admin.put(`/api/avatar/employees/${OTAVIO}`, { config: changed, baseVersion: mine.version })).status).toBe(403);
    expect((await other.put(`/api/avatar/employees/${OTAVIO}`, { config: changed, baseVersion: mine.version })).status).toBe(403);
    expect((await viewer.put('/api/avatar/me', { config: changed, baseVersion: 0 })).status).toBe(409); // sem colaborador
    const ok = await operator.put<{ version: number }>(`/api/avatar/employees/${OTAVIO}`, { config: changed, baseVersion: mine.version });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(mine.version + 1);
  });
  it('versão detecta gravação concorrente; configuração inválida é recusada', async () => {
    const mine = (await operator.get<{ config: AvatarConfig; version: number }>('/api/avatar/me')).body;
    expect((await operator.put('/api/avatar/me', { config: mine.config, baseVersion: mine.version - 1 })).status).toBe(409);
    expect((await operator.put('/api/avatar/me', { config: { ...mine.config, shoes: 'shoes.zzz' }, baseVersion: mine.version })).status).toBe(422);
  });
  it('salvar publica a nova aparência imediatamente para os colegas (inclusive em atendimento)', async () => {
    const st = await stream(s.url, admin);
    const op = await stream(s.url, operator); // o operador está no aplicativo (conectado)
    await st.waitFor((e) => e.event === 'snapshot');
    await op.waitFor((e) => e.event === 'snapshot');
    await operator.post('/api/live/call', { action: 'start', speakingSignal: false });
    const mine = (await operator.get<{ config: AvatarConfig; version: number }>('/api/avatar/me')).body;
    await operator.put('/api/avatar/me', { config: { ...mine.config, hairColor: 'ruivo' }, baseVersion: mine.version });
    const ev = await st.waitFor((e) => e.event === 'person' && e.data.employeeId === OTAVIO && (e.data.appearance as { config: AvatarConfig } | null)?.config.hairColor === 'ruivo');
    try {
      expect(ev.data.status).toBe('in_call');
    } finally {
      await operator.post('/api/live/call', { action: 'end' });
      st.close();
      op.close();
    }
  });
});

describe('estilo de avatar da empresa (Ara 3D Gen padrão; MakeHuman opcional do admin)', () => {
  it('o padrão é Ara 3D Gen e a aparência inicial é um personagem da galeria, estável por pessoa', async () => {
    const info = (await admin.get<{ style: string; options: Array<{ id: string }> }>('/api/admin/avatar-style')).body;
    expect(info.style).toBe('ara3d');
    expect(info.options.map((o) => o.id)).toEqual(['ara3d', 'makehuman']);
    const mine = (await operator.get<{ style: string; config: AraPresetConfig; saved: boolean }>('/api/avatar/me')).body;
    expect(mine.style).toBe('ara3d');
    expect(mine.saved).toBe(false);
    expect(validateAraAvatar(mine.config)).toEqual([]);
    expect(mine.config).toEqual(defaultAraAvatar(OTAVIO)); // o gênero não é deduzido do nome: é sorteado pelo ID
    const cat = (await operator.get<{ style: string; ara: unknown[] }>('/api/avatar/catalog')).body;
    expect(cat.style).toBe('ara3d');
    expect(cat.ara).toHaveLength(ARA_CHARACTERS.length);
  });

  it('só o administrador troca o estilo; valor inválido é recusado; operador não consegue', async () => {
    expect((await operator.put('/api/admin/avatar-style', { style: 'makehuman' })).status).toBe(403);
    expect((await viewer.put('/api/admin/avatar-style', { style: 'makehuman' })).status).toBe(403);
    expect((await admin.put('/api/admin/avatar-style', { style: 'pixel' })).status).toBe(400);
    expect((await operator.get('/api/admin/avatar-style')).status).toBe(403);
  });

  it('salvar no estilo Ara: personagem da galeria vale; personagem inexistente e configuração de outro estilo são recusados', async () => {
    const mine = (await operator.get<{ version: number; config: AraPresetConfig }>('/api/avatar/me')).body;
    const ok = await operator.put<{ version: number; style: string }>('/api/avatar/me', { config: { ...mine.config, character: 'ara-f2' }, baseVersion: mine.version });
    expect(ok.status).toBe(200);
    expect(ok.body.style).toBe('ara3d');
    expect((await operator.put('/api/avatar/me', { config: { ...mine.config, character: 'ara-zzz' }, baseVersion: ok.body.version })).status).toBe(422);
    expect((await operator.put('/api/avatar/me', { config: defaultAvatar(OTAVIO), baseVersion: ok.body.version })).status).toBe(422); // config do MakeHuman no estilo Ara
    expect((await operator.put('/api/avatar/me', { config: { ...mine.config, extra: 1 }, baseVersion: ok.body.version })).status).toBe(422);
    expect((await admin.put(`/api/avatar/employees/${OTAVIO}`, { config: mine.config, baseVersion: ok.body.version })).status).toBe(403); // nem o admin edita o de outra pessoa
  });

  it('o admin troca o estilo ao vivo: todos recebem snapshot novo; trocar não apaga a escolha de nenhum estilo', async () => {
    const watcher = await stream(s.url, admin);
    try {
      const snap0 = await watcher.waitFor((e) => e.event === 'snapshot');
      expect(snap0.data.avatarStyle).toBe('ara3d');
      expect((await person(admin, OTAVIO)).appearance?.config).toMatchObject({ style: 'ara3d', character: 'ara-f2' });
      expect((await admin.put('/api/admin/avatar-style', { style: 'makehuman' })).status).toBe(200);
      const snap1 = await watcher.waitFor((e) => e.event === 'snapshot' && e.data.avatarStyle === 'makehuman');
      const otavio = (snap1.data.people as Array<{ employeeId: string; appearance: { config: Record<string, unknown> } | null }>).find((p) => p.employeeId === OTAVIO)!;
      expect(otavio.appearance?.config?.style).not.toBe('ara3d'); // no MakeHuman vale o que ele salvou lá (ou nada)
      const mh = (await operator.get<{ style: string; config: Record<string, unknown> }>('/api/avatar/me')).body;
      expect(mh.style).toBe('makehuman');
      expect(validateForStyle('makehuman', mh.config)).toEqual([]);
      expect((await person(admin, ALINE)).status).toBe('online'); // a conexão aberta continua contando depois da troca
      expect((await admin.put('/api/admin/avatar-style', { style: 'ara3d' })).status).toBe(200);
      await watcher.waitFor((e) => e.event === 'snapshot' && e.data.avatarStyle === 'ara3d' && e !== snap0);
      expect((await operator.get<{ config: AraPresetConfig }>('/api/avatar/me')).body.config.character).toBe('ara-f2'); // a escolha do Ara continua lá
      expect((await person(admin, ALINE)).status).toBe('online');
    } finally {
      await admin.put('/api/admin/avatar-style', { style: 'ara3d' });
      watcher.close();
    }
  });

  it('a troca é por empresa: o administrador de outra empresa não muda o estilo desta', async () => {
    expect((await other.put('/api/admin/avatar-style', { style: 'makehuman' })).status).toBe(200);
    expect((await admin.get<{ style: string }>('/api/admin/avatar-style')).body.style).toBe('ara3d');
    expect((await other.get<{ style: string }>('/api/admin/avatar-style')).body.style).toBe('makehuman');
    await other.put('/api/admin/avatar-style', { style: 'ara3d' });
  });

  it('a galeria distribuída bate com a lista compartilhada: todo personagem tem GLB, LOD1 e miniatura, com origem e licença', () => {
    const dir = path.join(import.meta.dirname, '../public/assets/avatars-ara');
    const m = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { characters: Array<{ id: string; name: string; gender: string; style: string; file: string; lod1: string }>; generator: { license: string }; data: { license: string } };
    expect(m.characters.map((c) => [c.id, c.name, c.gender, c.style])).toEqual(ARA_CHARACTERS.map((c) => [c.id, c.name, c.gender, c.style]));
    for (const c of m.characters) {
      expect(existsSync(path.join(dir, c.file)), c.file).toBe(true);
      expect(existsSync(path.join(dir, c.lod1)), c.lod1).toBe(true);
      expect(existsSync(path.join(dir, 'thumbs', c.id + '.webp')), 'miniatura ' + c.id).toBe(true);
    }
    expect(m.generator.license).toMatch(/MIT/);
    expect(m.data.license).toMatch(/CC0/);
    for (const g of ['male', 'female']) for (const st of ['casual', 'corporate']) expect(ARA_CHARACTERS.some((c) => c.gender === g && c.style === st), g + ' ' + st).toBe(true);
  });
});

describe('presença ao vivo', () => {
  it('conectar fica online; prioridade: atendimento > digitação > online; fala só como booleano', async () => {
    const st = await stream(s.url, operator);
    await st.waitFor((e) => e.event === 'snapshot');
    expect((await person(admin, OTAVIO)).status).toBe('online');
    await operator.post('/api/live/typing', { state: 'start', text: 'conteúdo que não pode chegar' });
    expect((await person(admin, OTAVIO)).status).toBe('typing');
    expect(JSON.stringify(await person(admin, OTAVIO))).not.toMatch(/conteúdo/);
    await operator.post('/api/live/call', { action: 'start', speakingSignal: true });
    let p = await person(admin, OTAVIO);
    expect(p.status).toBe('in_call'); // atendimento vence digitação
    expect(p.call?.speaking).toBe(false);
    await operator.post('/api/live/speaking', { speaking: true });
    expect((await person(admin, OTAVIO)).call?.speaking).toBe(true);
    await new Promise((r) => setTimeout(r, 900)); // fala expira
    expect((await person(admin, OTAVIO)).call?.speaking).toBe(false);
    await operator.post('/api/live/typing', { state: 'start' });
    await operator.post('/api/live/call', { action: 'end' });
    p = await person(admin, OTAVIO);
    expect(p.status).toBe('typing'); // recalculado a partir do que ainda vale
    await new Promise((r) => setTimeout(r, 800)); // digitação expira
    expect((await person(admin, OTAVIO)).status).toBe('online');
    st.close();
  });

  it('duas sessões do mesmo colaborador: fechar uma mantém; fechar a última remove após a tolerância', async () => {
    const second = await new Client(s.url).login(ADMIN);
    const a = await stream(s.url, admin);
    const b = await stream(s.url, second);
    await a.waitFor((e) => e.event === 'snapshot');
    await b.waitFor((e) => e.event === 'snapshot');
    expect((await person(operator, ALINE)).status).toBe('online');
    a.close();
    await new Promise((r) => setTimeout(r, 1000));
    expect((await person(operator, ALINE)).status).toBe('online');
    b.close();
    await new Promise((r) => setTimeout(r, 300));
    expect((await person(operator, ALINE)).status).toBe('online'); // ainda dentro da tolerância
    await new Promise((r) => setTimeout(r, 1000));
    expect((await person(operator, ALINE)).status).toBe('offline');
  });

  it('reconexão recebe snapshot com aparência e estado, sem duplicar a pessoa', async () => {
    const st1 = await stream(s.url, operator);
    const snap1 = await st1.waitFor((e) => e.event === 'snapshot');
    st1.close();
    const st2 = await stream(s.url, operator);
    const snap2 = await st2.waitFor((e) => e.event === 'snapshot');
    const people = snap2.data.people as Array<{ employeeId: string; appearance: unknown }>;
    expect(people.filter((p) => p.employeeId === OTAVIO).length).toBe(1);
    expect(people.find((p) => p.employeeId === OTAVIO)?.appearance).toBeTruthy();
    expect(Number(snap2.data.seq)).toBeGreaterThanOrEqual(Number(snap1.data.seq));
    st2.close();
  });

  it('versão nunca regride depois de um resync; leituras simultâneas não perdem a conexão da pessoa', async () => {
    const st = await stream(s.url, operator);
    await st.waitFor((e) => e.event === 'snapshot');
    const before = (await person(admin, OTAVIO)).version;
    // revincular a mesma mesa dispara invalidate (o servidor esquece o estado em memória e manda resync)
    const seat = (await admin.get<{ objects: Record<string, { seat?: { employee?: { id: string } } }> }>('/api/offices/off_sede_1/operational')).body;
    const deskId = Object.entries(seat.objects).find(([, o]) => o.seat?.employee?.id === OTAVIO)![0];
    expect((await admin.put(`/api/admin/offices/off_sede_1/seats/${deskId}`, { employeeId: OTAVIO })).status).toBe(200);
    await st.waitFor((e) => e.event === 'resync');
    // várias leituras e uma conexão nova ao mesmo tempo, com a pessoa ainda fora da memória
    const st2Promise = stream(s.url, operator);
    await Promise.all([person(admin, OTAVIO), person(admin, OTAVIO), person(admin, OTAVIO)]);
    const st2 = await st2Promise;
    await st2.waitFor((e) => e.event === 'snapshot');
    await operator.post('/api/live/typing', { state: 'start' });
    const after = await person(admin, OTAVIO);
    expect(after.status).toBe('typing'); // a conexão continua contada (sem corrida que a perca)
    expect(after.version).toBeGreaterThan(before); // antes da correção, a versão voltava a 0 e o cliente descartava os eventos
    await operator.post('/api/live/typing', { state: 'stop' });
    st.close();
    st2.close();
  });

  it('escopo: outra empresa não vê esta empresa; visualizador não recebe presença; ninguém publica pelo outro', async () => {
    const otherSnap = (await other.get<{ people: Array<{ employeeId: string }> }>('/api/live/snapshot')).body.people.map((p) => p.employeeId);
    expect(otherSnap).not.toContain(OTAVIO);
    expect(otherSnap).toEqual(['emp_outra_rui']);
    const v = (await viewer.get<{ people: unknown[]; presenceVisible: boolean }>('/api/live/snapshot')).body;
    expect(v.presenceVisible).toBe(false);
    expect(v.people).toEqual([]);
    // o corpo não permite escolher de quem é o sinal: só vale para a sessão autenticada
    await admin.post('/api/live/call', { action: 'start', employeeId: OTAVIO });
    expect((await person(admin, OTAVIO)).status).not.toBe('in_call');
    await admin.post('/api/live/call', { action: 'end' });
  });
});
