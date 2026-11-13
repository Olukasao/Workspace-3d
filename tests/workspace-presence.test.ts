import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seatOfObject } from '../shared/office2d';
import { defaultLayout2D } from '../shared/office2dDefault';
import { ADMIN, Client, OPERATOR, startServer, type TestServer } from './helpers';

const OFFICE = 'off_sede_1';
const TOKEN = 'segredo-do-teste-do-workspace';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Pos = { id: string; x: number; y: number; dir: string; moving: boolean; seat: string | null; auto?: boolean };
type Join = { me: Pos; positions: Pos[] };

describe('presença só pelo Workspace aberto (fora da demonstração)', () => {
  let s: TestServer;
  let admin: Client, operator: Client, company: string;
  const hook = (body: unknown, token: string | null = TOKEN) => new Client(s.url).request('PUT', '/api/integrations/workspace-presence', body, token ? { Authorization: `Bearer ${token}` } : {});
  const join = () => operator.post<Join>(`/api/office2d/${OFFICE}/join`);

  beforeAll(async () => {
    s = await startServer({ DEMO_MODE: 'false', WORKSPACE_PRESENCE_TOKEN: TOKEN });
    admin = await new Client(s.url).login(ADMIN);
    operator = await new Client(s.url).login(OPERATOR);
    company = ((await operator.get<{ user: { companyId: string } }>('/api/auth/me')).body.user.companyId);
    expect((await admin.put('/api/admin/workspace-mode', { mode: '2d', confirm: true })).status).toBe(200);
  }, 30000);
  afterAll(async () => {
    s.ctx.ara.close();
    s.ctx.office2d.stop();
    await s.close();
  });

  it('o sinal exige o token do servidor; com token errado, ausente ou campos inválidos nada muda', async () => {
    expect((await hook({ companyId: company, employeeIds: [] }, null)).status).toBe(401);
    expect((await hook({ companyId: company, employeeIds: [] }, 'errado')).status).toBe(401);
    expect((await hook({ companyId: 'outra-empresa', employeeIds: [] })).status).toBe(400);
    expect((await hook({ companyId: company })).status).toBe(400);
    expect((await hook({ companyId: company, employeeIds: [1, 2] })).status).toBe(400);
  });

  it('sem o Workspace aberto a pessoa não aparece no mapa: só observa, mesmo com o Office 3D aberto', async () => {
    const r = await join();
    expect(r.status).toBe(409);
    expect((r.body as { error?: string }).error).toBe('not_online');
    expect((await operator.get<{ positions: Pos[] }>(`/api/office2d/${OFFICE}/positions`)).body.positions.map((p) => p.id)).not.toContain('emp_otavio');
  });

  it('com o Workspace aberto ela aparece, entra pela entrada e é levada até a mesa; ids desconhecidos são ignorados', async () => {
    const ok = await hook({ companyId: company, employeeIds: ['emp_otavio', 'emp_inexistente'] });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ accepted: 1, ignored: 1 });
    const j = await join();
    expect(j.status).toBe(200);
    expect(j.body.me.seat).toBeNull();
    expect(j.body.me.auto).toBe(true);
    let me = j.body.me;
    for (let i = 0; i < 100 && me.seat !== 'st5'; i++) {
      await sleep(250);
      me = (await join()).body.me;
    }
    expect(me.seat).toBe('st5');
  }, 40000);

  it('em atendimento a pessoa vai direto para o computador e senta', async () => {
    const layout = defaultLayout2D();
    const sp = seatOfObject(layout.objects.find((o) => o.id === layout.stations.find((st) => st.id === 'st5')!.objectId)!)!;
    // levanta e se afasta alguns passos da mesa
    let y = sp.y;
    for (let i = 0; i < 3; i++) {
      await sleep(160);
      y += 14;
      expect((await operator.post(`/api/office2d/${OFFICE}/move`, { x: sp.x, y, dir: 'down', moving: true, seat: null })).status).toBe(200);
    }
    let me = (await join()).body.me;
    expect(me.seat).toBeNull();
    expect(me.y).toBeGreaterThan(sp.y + 20);
    expect((await operator.post('/api/live/call', { action: 'start' })).status).toBe(200);
    for (let i = 0; i < 60 && me.seat !== 'st5'; i++) {
      await sleep(200);
      me = (await join()).body.me;
    }
    expect(me.seat).toBe('st5');
  }, 30000);

  it('quando o Workspace fecha a pessoa some do mapa e o sinal por evento também funciona', async () => {
    expect((await hook({ companyId: company, employeeId: 'emp_otavio', open: false })).body).toEqual({ accepted: 1, ignored: 0 });
    await s.ctx.office2d.sweep();
    expect(s.ctx.office2d.list(company, OFFICE).map((p) => p.id)).not.toContain('emp_otavio');
    expect((await join()).status).toBe(409);
    expect((await hook({ companyId: company, employeeId: 'emp_otavio', open: true })).body).toEqual({ accepted: 1, ignored: 0 });
    await s.ctx.office2d.sweep();
    expect(s.ctx.office2d.list(company, OFFICE).map((p) => p.id)).toContain('emp_otavio');
  });
});

describe('sinal desligado', () => {
  it('sem WORKSPACE_PRESENCE_TOKEN o endereço responde "não configurado"', async () => {
    const s = await startServer();
    try {
      const r = await new Client(s.url).request('PUT', '/api/integrations/workspace-presence', { companyId: 'x', employeeIds: [] }, { Authorization: 'Bearer qualquer' });
      expect(r.status).toBe(409);
    } finally {
      s.ctx.ara.close();
      s.ctx.office2d.stop();
      await s.close();
    }
  });
});
