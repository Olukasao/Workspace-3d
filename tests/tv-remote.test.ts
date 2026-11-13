import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RealRemoteAccess } from '../server/providers/real';
import { ProviderNotConfigured } from '../server/providers/types';
import { ADMIN, Client, OPERATOR, VIEWER, startServer, type TestServer } from './helpers';

const OFFICE = 'off_sede_1';
const TV_REUNIAO = 'o40'; // dispositivo AnyDesk, só o administrador tem permissão
const TV_ATENDIMENTO = 'o66'; // dispositivo RustDesk, o operador tem permissão

const base = (id: string) => `/api/office2d/${OFFICE}/objects/${id}/remote`;

describe('provedores reais: RustDesk e AnyDesk escolhidos pelo cadastro do dispositivo', () => {
  const dev = (remoteProvider: string | null, remoteAddress: string | null) => ({ id: 'd', name: 'PLAYER', remoteProvider, remoteAddress });

  it('RustDesk devolve só o ID e o comando oficial; o link só existe no modo uri; nunca senha', async () => {
    const manual = await new RealRemoteAccess('rustdesk', 'manual', 'manual').prepare(dev('rustdesk', '200 000 031'));
    expect(manual).toMatchObject({ status: 'launch_ready', address: '200000031', command: 'rustdesk.exe --connect 200000031' });
    expect(manual.launchUrl).toBeUndefined();
    const uri = await new RealRemoteAccess('both', 'manual', 'uri').prepare(dev('rustdesk', '200000031'));
    expect(uri.launchUrl).toBe('rustdesk://connection/new/200000031');
    expect(JSON.stringify([manual, uri])).not.toMatch(/password|senha=/i);
  });

  it('recusa endereço que pareça opção de comando, produto não habilitado e dispositivo sem cadastro', async () => {
    const both = new RealRemoteAccess('both', 'manual', 'manual');
    for (const bad of ['--password x', '123456789 --version', 'a b;rm -rf /', '', '12']) await expect(both.prepare(dev('rustdesk', bad))).rejects.toBeInstanceOf(ProviderNotConfigured);
    await expect(new RealRemoteAccess('anydesk', 'manual', 'manual').prepare(dev('rustdesk', '200000031'))).rejects.toThrow(/não está habilitado/);
    await expect(new RealRemoteAccess('rustdesk', 'manual', 'manual').prepare(dev('anydesk', '100000002'))).rejects.toThrow(/não está habilitado/);
    await expect(both.prepare(dev(null, null))).rejects.toThrow(/não tem acesso remoto/);
    expect((await both.prepare(dev('anydesk', '100 000 002'))).command).toBe('anydesk.exe 100000002');
  });
});

describe('TV do escritório 2D: gerenciar o que aparece pela conexão remota', () => {
  let s: TestServer;
  let admin: Client, operator: Client, viewer: Client;

  beforeAll(async () => {
    s = await startServer();
    admin = await new Client(s.url).login(ADMIN);
    operator = await new Client(s.url).login(OPERATOR);
    viewer = await new Client(s.url).login(VIEWER);
    expect((await admin.put('/api/admin/workspace-mode', { mode: '2d', confirm: true })).status).toBe(200);
  }, 30000);
  afterAll(async () => {
    s.ctx.ara.close();
    s.ctx.office2d.stop();
    await s.close();
  });

  it('cada perfil vê o estado certo: administrador pode nas duas, operador só na que tem permissão, visualizador em nenhuma', async () => {
    const a1 = (await admin.get<{ state: string; device: { provider: string } }>(base(TV_REUNIAO))).body;
    expect(a1.state).toBe('ready');
    expect(a1.device.provider).toBe('anydesk');
    expect((await admin.get<{ device: { provider: string } }>(base(TV_ATENDIMENTO))).body.device.provider).toBe('rustdesk');
    expect((await operator.get<{ state: string }>(base(TV_REUNIAO))).body.state).toBe('forbidden');
    expect((await operator.get<{ state: string }>(base(TV_ATENDIMENTO))).body.state).toBe('ready');
    expect((await viewer.get<{ state: string }>(base(TV_ATENDIMENTO))).body.state).toBe('forbidden');
    expect((await operator.get(base('o1'))).status).toBe(404); // não é uma TV
    expect((await operator.get(base('nao-existe'))).status).toBe(404);
  });

  it('pedir exige confirmação explícita e a permissão é reavaliada no servidor', async () => {
    expect((await operator.post(`${base(TV_ATENDIMENTO)}/request`, {})).status).toBe(400);
    expect((await operator.post(`${base(TV_REUNIAO)}/request`, { confirm: true })).status).toBe(403);
    expect((await viewer.post(`${base(TV_ATENDIMENTO)}/request`, { confirm: true })).status).toBe(403);
  });

  it('na demonstração a conexão só é registrada: nenhum endereço, comando ou link volta; a trilha guarda o pedido', async () => {
    const r = await operator.post<{ mode: string; status: string; provider: string; address?: string; command?: string; launchUrl?: string; requestId: string }>(`${base(TV_ATENDIMENTO)}/request`, { confirm: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: 'demo', status: 'registered', provider: 'rustdesk' });
    expect(r.body.address).toBeUndefined();
    expect(r.body.command).toBeUndefined();
    expect(r.body.launchUrl).toBeUndefined();
    const audit = await admin.get<{ entries: Array<{ action: string; targetId: string; objectId?: string; result: string }> }>('/api/admin/audit?action=remote.request');
    const row = audit.body.entries?.find((e) => e.objectId === TV_ATENDIMENTO);
    expect(row).toMatchObject({ action: 'remote.request', targetId: 'dev_player_atendimento' });
  });

  it('a lista de dispositivos mostra tudo o que tem acesso remoto, o da TV marcado e a permissão de cada um (impressora fora)', async () => {
    type Row = { id: string; kind: string; provider: string; canConnect: boolean; reason?: string; bound: boolean };
    const op = (await operator.get<{ devices: Row[] }>(`${base(TV_ATENDIMENTO)}/devices`)).body.devices;
    expect(op.map((d) => d.id)).not.toContain('dev_prn_at_01');
    expect(op.find((d) => d.bound)?.id).toBe('dev_player_atendimento');
    expect(op[0].id).toBe('dev_player_atendimento'); // o da TV vem primeiro
    expect(op.find((d) => d.id === 'dev_pc_at_01')).toMatchObject({ canConnect: true, provider: 'anydesk' });
    expect(op.find((d) => d.id === 'dev_player_reuniao')).toMatchObject({ canConnect: false });
    expect(op.find((d) => d.id === 'dev_player_reuniao')!.reason).toMatch(/permiss/);
    expect(op.find((d) => d.id === 'dev_pc_at_04')).toBeUndefined(); // inativo
    const adm = (await admin.get<{ devices: Row[] }>(`${base(TV_ATENDIMENTO)}/devices`)).body.devices;
    expect(adm.every((d) => d.canConnect)).toBe(true);
    expect((await viewer.get<{ devices: Row[] }>(`${base(TV_ATENDIMENTO)}/devices`)).body.devices.every((d) => !d.canConnect)).toBe(true);
  });

  it('o usuário escolhe o dispositivo: vale o escolhido (com permissão), não o da TV; sem permissão é 403 e a trilha guarda o escolhido', async () => {
    const pick = (c: Client, deviceId: string) => c.post<{ device: { id: string }; provider: string }>(`${base(TV_ATENDIMENTO)}/request`, { deviceId, confirm: true });
    const ok = await pick(operator, 'dev_pc_at_01');
    expect(ok.status).toBe(200);
    expect(ok.body.device.id).toBe('dev_pc_at_01');
    expect(ok.body.provider).toBe('anydesk');
    expect((await pick(operator, 'dev_player_reuniao')).status).toBe(403);
    expect((await pick(operator, 'dev_pc_at_04')).status).toBe(409); // inativo
    expect((await pick(operator, 'dev_prn_at_01')).status).toBe(404); // impressora não é dispositivo remoto
    expect((await pick(operator, 'dev_outra_prn')).status).toBe(404); // de outra empresa
    expect((await pick(admin, 'dev_player_reuniao')).status).toBe(200);
    const audit = await admin.get<{ entries: Array<{ targetId: string; objectId?: string }> }>('/api/admin/audit?action=remote.request');
    expect(audit.body.entries.some((e) => e.targetId === 'dev_pc_at_01' && e.objectId === TV_ATENDIMENTO)).toBe(true);
  });

  it('só o administrador vincula o dispositivo da TV; recusa objeto que não é TV, dispositivo de outra empresa ou de tipo errado', async () => {
    const put = (c: Client, obj: string, deviceId: unknown) => c.put(`/api/admin/office2d/${OFFICE}/objects/${obj}/device`, { deviceId });
    expect((await put(operator, TV_REUNIAO, null)).status).toBe(403);
    expect((await put(admin, 'o1', 'dev_pc_at_01')).status).toBe(404);
    expect((await put(admin, TV_REUNIAO, 'dev_outra_prn')).status).toBe(404);
    expect((await put(admin, TV_REUNIAO, 'dev_prn_at_01')).status).toBe(422);
    expect((await put(admin, TV_REUNIAO, 7)).status).toBe(400);
    const list = (await admin.get<{ devices: Array<{ id: string; kind: string }>; links: Record<string, string> }>(`/api/admin/office2d/${OFFICE}/devices`)).body;
    expect(list.devices.every((d) => ['tv_player', 'pc', 'tv'].includes(d.kind))).toBe(true);
    expect(list.links).toMatchObject({ [TV_REUNIAO]: 'dev_player_reuniao', [TV_ATENDIMENTO]: 'dev_player_atendimento' });
    // troca e desvincula
    expect((await put(admin, TV_REUNIAO, 'dev_player_noc_01')).status).toBe(200);
    expect((await admin.get<{ device: { id: string } }>(base(TV_REUNIAO))).body.device.id).toBe('dev_player_noc_01');
    expect((await put(admin, TV_REUNIAO, null)).status).toBe(200);
    const none = (await admin.get<{ state: string; reason: string; device: unknown }>(base(TV_REUNIAO))).body;
    expect(none).toMatchObject({ state: 'not_configured', device: null });
    expect(none.reason).toMatch(/Nenhum dispositivo/);
  });
});
