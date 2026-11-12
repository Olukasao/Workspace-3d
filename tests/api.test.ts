import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OperationalView, SceneDoc } from '../shared/types';
import { ADMIN, Client, OFFICE, OPERATOR, OTHER_ADMIN, VIEWER, key, startServer, tinyPdf, type TestServer } from './helpers';

let s: TestServer;
let admin: Client;
let operator: Client;
let viewer: Client;
let other: Client;

beforeAll(async () => {
  s = await startServer();
  admin = await new Client(s.url).login(ADMIN);
  operator = await new Client(s.url).login(OPERATOR);
  viewer = await new Client(s.url).login(VIEWER);
  other = await new Client(s.url).login(OTHER_ADMIN);
});
afterAll(() => s.close());

const view = async (c: Client) => (await c.get<OperationalView>(`/api/offices/${OFFICE}/operational`)).body;
const draft = async (c: Client) => (await c.get<{ doc: SceneDoc; version: number }>(`/api/offices/${OFFICE}/draft`)).body;

describe('autenticação, perfis e empresa', () => {
  it('sem sessão não entra; senha errada é recusada', async () => {
    expect((await new Client(s.url).get(`/api/offices/${OFFICE}/operational`)).status).toBe(401);
    expect((await new Client(s.url).post('/api/auth/login', { email: ADMIN, password: 'errada' })).status).toBe(401);
  });

  it('operador e visualizador veem a publicação, mas não abrem nem gravam o rascunho', async () => {
    for (const c of [operator, viewer]) {
      expect((await c.get(`/api/offices/${OFFICE}/operational`)).status).toBe(200);
      expect((await c.get(`/api/offices/${OFFICE}/draft`)).status).toBe(403);
      expect((await c.put(`/api/offices/${OFFICE}/draft`, { doc: {}, baseVersion: 1 })).status).toBe(403);
      expect((await c.post(`/api/offices/${OFFICE}/publish`, { baseVersion: 1 })).status).toBe(403);
      expect((await c.get('/api/admin/audit')).status).toBe(403);
    }
  });

  it('usuário de outra empresa não alcança mapa, vínculos, ações nem diretório desta empresa', async () => {
    expect((await other.get(`/api/offices/${OFFICE}/operational`)).status).toBe(404);
    expect((await other.get(`/api/offices/${OFFICE}/draft`)).status).toBe(404);
    expect((await other.put(`/api/offices/${OFFICE}/draft`, { doc: (await draft(admin)).doc, baseVersion: 1 })).status).toBe(404);
    expect((await other.post(`/api/offices/${OFFICE}/publish`, { baseVersion: 1 })).status).toBe(404);
    expect((await other.put(`/api/admin/offices/${OFFICE}/seats/ws_at_06`, { employeeId: 'emp_ana' })).status).toBe(404);
    expect((await other.post(`/api/offices/${OFFICE}/actions/chat/open`, { objectId: 'ws_at_01' })).status).toBe(404);
    const dir = (await other.get<{ employees: Array<{ id: string }> }>('/api/admin/directory')).body.employees.map((e) => e.id);
    expect(dir).toEqual(['emp_outra_rui']);
    const offices = (await other.get<{ offices: Array<{ id: string }> }>('/api/offices')).body.offices.map((o) => o.id);
    expect(offices).toEqual(['off_outra_1']);
    // o admin da outra empresa não vincula um colaborador desta empresa no próprio mapa
    expect((await other.put('/api/admin/offices/off_outra_1/seats/qualquer', { employeeId: 'emp_ana' })).status).toBe(409);
  });

  it('mutação sem o cabeçalho do aplicativo é recusada', async () => {
    const res = await fetch(`${s.url}/api/auth/logout`, { method: 'POST', headers: { Cookie: admin.cookie } });
    expect(res.status).toBe(400);
  });

  it('o diretório expõe só dados profissionais mínimos', async () => {
    const emp = (await operator.get<{ employees: Array<Record<string, unknown>> }>('/api/directory')).body.employees[0];
    expect(Object.keys(emp).sort()).toEqual(['department', 'extension', 'id', 'name']);
  });
});

describe('visão operacional', () => {
  it('diferencia mesa ocupada, mesa vaga e vínculo órfão', async () => {
    const v = await view(operator);
    expect(v.objects.ws_at_01.seat).toMatchObject({ state: 'occupied', employee: { name: 'Ana Ribeiro', department: 'Atendimento', extension: '2101' } });
    expect(v.objects.ws_at_06.seat).toEqual({ state: 'vacant' });
    expect(v.objects.ws_at_06.actions.chat).toMatchObject({ state: 'not_configured', reason: expect.stringContaining('Mesa vaga') });
    expect(v.objects.ws_noc_02.seat?.state).toBe('orphan'); // colaborador desligado
    expect(v.objects.ws_at_04.device?.state).toBe('orphan'); // dispositivo removido
    expect(v.objects.ws_at_04.actions.remote?.state).toBe('not_configured');
    expect(v.objects.tv_reuniao.actions.dashboard?.state).toBe('not_configured');
    expect(v.objects.tv_noc_01.actions.dashboard).toEqual({ state: 'available', mode: 'demo' });
  });

  it('visualizador vê os dados profissionais, sem presença e sem ações', async () => {
    const v = await view(viewer);
    expect(v.objects.ws_at_01.seat?.employee?.name).toBe('Ana Ribeiro');
    expect(v.objects.ws_at_01.presence).toBeUndefined();
    expect(Object.values(v.objects.ws_at_01.actions).every((a) => a.state === 'forbidden')).toBe(true);
    expect((await viewer.post(`/api/offices/${OFFICE}/actions/chat/open`, { objectId: 'ws_at_01' })).status).toBe(403);
  });

  it('acesso remoto é restrito por dispositivo e por operador', async () => {
    const v = await view(operator);
    expect(v.objects.ws_at_01.actions.remote?.state).toBe('available');
    expect(v.objects.ws_at_03.actions.remote).toMatchObject({ state: 'forbidden' }); // sem concessão para este PC
    expect((await view(admin)).objects.ws_at_03.actions.remote?.state).toBe('available');
    expect((await operator.post(`/api/offices/${OFFICE}/actions/remote/request`, { objectId: 'ws_at_03', confirm: true })).status).toBe(403);
  });

  it('provedor indisponível: o mapa continua carregando e as ações ficam "indisponíveis"', async () => {
    await admin.post('/api/demo/outage', { service: 'chat', down: true });
    await admin.post('/api/demo/outage', { service: 'presence', down: true });
    const v = await view(operator);
    expect(v.doc?.objects.length).toBeGreaterThan(50);
    expect(v.objects.ws_at_01.seat?.state).toBe('occupied');
    expect(v.objects.ws_at_01.presence).toEqual({ state: 'unknown', mode: 'demo' }); // indisponibilidade ≠ mesa vaga
    expect(v.objects.ws_at_01.actions.chat?.state).toBe('unavailable');
    expect(v.objects.ws_at_06.seat?.state).toBe('vacant');
    expect(v.integrations.find((i) => i.id === 'chat')?.state).toBe('unavailable');
    expect((await operator.post(`/api/offices/${OFFICE}/actions/chat/open`, { objectId: 'ws_at_01' })).status).toBe(503);
    // edição do mapa segue funcionando
    const d = await draft(admin);
    expect((await admin.put(`/api/offices/${OFFICE}/draft`, { doc: d.doc, baseVersion: d.version })).status).toBe(200);
    await admin.post('/api/demo/outage', { service: 'chat', down: false });
    await admin.post('/api/demo/outage', { service: 'presence', down: false });
    expect((await view(operator)).objects.ws_at_01.actions.chat?.state).toBe('available');
  });
});

describe('rascunho, conflito e publicação', () => {
  it('dois editores: o segundo a gravar recebe conflito e não sobrescreve', async () => {
    const admin2 = await new Client(s.url).login(ADMIN);
    const a = await draft(admin);
    const b = await draft(admin2);
    expect(a.version).toBe(b.version);
    a.doc.objects.find((o) => o.id === 'at_lixeira')!.t.x = 8.0;
    expect((await admin.put(`/api/offices/${OFFICE}/draft`, { doc: a.doc, baseVersion: a.version })).status).toBe(200);
    b.doc.objects.find((o) => o.id === 'at_lixeira')!.t.x = 7.0;
    const conflict = await admin2.put(`/api/offices/${OFFICE}/draft`, { doc: b.doc, baseVersion: b.version });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ error: 'draft_conflict', currentVersion: a.version + 1 });
    expect((await draft(admin)).doc.objects.find((o) => o.id === 'at_lixeira')!.t.x).toBe(8.0);
    // publicar com versão antiga também é recusado
    expect((await admin2.post(`/api/offices/${OFFICE}/publish`, { baseVersion: b.version })).status).toBe(409);
  });

  it('operadores só veem a mudança depois de publicar; a publicação cria uma revisão nova', async () => {
    const before = await view(operator);
    const d = await draft(admin);
    d.doc.objects.find((o) => o.id === 'at_planta')!.name = 'Folhagem renomeada';
    const saved = await admin.put<{ version: number }>(`/api/offices/${OFFICE}/draft`, { doc: d.doc, baseVersion: d.version });
    expect(saved.status).toBe(200);
    expect((await view(operator)).objects.at_planta.name).toBe('Folhagem');
    const pub = await admin.post<{ number: number }>(`/api/offices/${OFFICE}/publish`, { baseVersion: saved.body.version, note: 'teste' });
    expect(pub.status).toBe(200);
    expect(pub.body.number).toBe((before.revision?.number ?? 0) + 1);
    const after = await view(operator);
    expect(after.objects.at_planta.name).toBe('Folhagem renomeada');
    expect(after.revision?.number).toBe(pub.body.number);
  });

  it('cena inválida (ciclo de parentesco) não é gravada', async () => {
    const d = await draft(admin);
    d.doc.objects.find((o) => o.id === 'at_mesa_01')!.parentId = 'ws_at_01';
    const r = await admin.put(`/api/offices/${OFFICE}/draft`, { doc: d.doc, baseVersion: d.version });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toMatch(/ciclo/);
  });

  it('trocar o modelo da TV preserva o ID da instância e os vínculos (dispositivo e painel)', async () => {
    const d = await draft(admin);
    const tv = d.doc.objects.find((o) => o.id === 'tv_noc_01')!;
    expect(tv.assetId).toBe('asset_tv-painel');
    tv.assetId = 'asset_tv-parede';
    const saved = await admin.put<{ version: number }>(`/api/offices/${OFFICE}/draft`, { doc: d.doc, baseVersion: d.version });
    expect((await admin.post(`/api/offices/${OFFICE}/publish`, { baseVersion: saved.body.version })).status).toBe(200);
    const v = await view(operator);
    expect(v.doc?.objects.find((o) => o.id === 'tv_noc_01')?.assetId).toBe('asset_tv-parede');
    expect(v.objects.tv_noc_01.device).toMatchObject({ state: 'linked', name: 'PLAYER-NOC-01' });
    expect(v.objects.tv_noc_01.dashboard?.name).toContain('Saúde da rede');
    expect(v.objects.tv_noc_01.actions.dashboard?.state).toBe('available');
  });

  it('remover um objeto vinculado deixa o vínculo órfão, com estado explícito para o administrador', async () => {
    const d = await draft(admin);
    d.doc.objects = d.doc.objects.filter((o) => o.id !== 'rec_bancada' && o.parentId !== 'rec_bancada');
    const saved = await admin.put<{ version: number }>(`/api/offices/${OFFICE}/draft`, { doc: d.doc, baseVersion: d.version });
    await admin.post(`/api/offices/${OFFICE}/publish`, { baseVersion: saved.body.version });
    const b = (await admin.get<{ seats: Array<{ objectId: string; state: string }> }>(`/api/admin/offices/${OFFICE}/bindings`)).body;
    expect(b.seats.find((x) => x.objectId === 'rec_bancada')?.state).toBe('orphan_object');
    expect(b.seats.find((x) => x.objectId === 'noc_mesa_02')?.state).toBe('orphan_employee');
    expect((await view(operator)).objects.ws_rec_01).toBeUndefined();
  });

  it('vínculo é da mesa: posição fixa no assento da cadeira, computador herda o ocupante, uma pessoa por mesa', async () => {
    let v = await view(operator);
    expect(v.objects.at_mesa_01).toMatchObject({ kind: 'desk', seat: { state: 'occupied', employee: { name: 'Ana Ribeiro' } } });
    expect(v.objects.ws_at_01.seat?.employee?.name).toBe('Ana Ribeiro'); // herdado da mesa
    // assento fixo = cadeira da mesa (0,72 m à frente), olhando para a mesa
    const mesa = v.doc!.objects.find((o) => o.id === 'at_mesa_01')!;
    expect(v.objects.at_mesa_01.seatPosition).toMatchObject({ deskId: 'at_mesa_01', x: mesa.t.x, z: Math.round((mesa.t.z + 0.72) * 100) / 100 });
    expect(v.objects.ws_at_01.seatPosition?.deskId).toBe('at_mesa_01');
    // pedido feito no computador vai para a mesa; a pessoa sai da mesa anterior
    const r = await admin.put<{ objectId: string }>(`/api/admin/offices/${OFFICE}/seats/ws_at_06`, { employeeId: 'emp_ana' });
    expect(r.body.objectId).toBe('at_mesa_06');
    v = await view(operator);
    expect(v.objects.at_mesa_06.seat?.employee?.name).toBe('Ana Ribeiro');
    expect(v.objects.ws_at_06.seat?.employee?.name).toBe('Ana Ribeiro');
    expect(v.objects.at_mesa_01.seat?.state).toBe('vacant');
    expect(Object.values(v.objects).filter((o) => o.kind === 'desk' && o.seat?.employee?.id === 'emp_ana').length).toBe(1);
    await admin.put(`/api/admin/offices/${OFFICE}/seats/at_mesa_01`, { employeeId: 'emp_ana' });
    v = await view(operator);
    expect(v.objects.at_mesa_01.seat?.employee?.name).toBe('Ana Ribeiro');
    expect(v.objects.at_mesa_06.seat?.state).toBe('vacant');
  });

  it('colaborador que sai da mesa: a mesa fica órfã até o administrador reatribuir', async () => {
    await admin.patch('/api/admin/employees/emp_carla', { active: false });
    let v = await view(operator);
    expect(v.objects.ws_at_03.seat?.state).toBe('orphan');
    expect(v.objects.ws_at_03.actions.chat?.state).toBe('not_configured');
    expect((await admin.put(`/api/admin/offices/${OFFICE}/seats/ws_at_03`, { employeeId: null })).status).toBe(200);
    v = await view(operator);
    expect(v.objects.ws_at_03.seat?.state).toBe('vacant');
    await admin.patch('/api/admin/employees/emp_carla', { active: true });
    expect((await admin.put(`/api/admin/offices/${OFFICE}/seats/ws_at_03`, { employeeId: 'emp_carla' })).status).toBe(200);
    expect((await admin.put(`/api/admin/offices/${OFFICE}/seats/at_lixeira`, { employeeId: 'emp_carla' })).status).toBe(422); // lixeira não é mesa
  });
});

describe('chat (demonstração)', () => {
  it('pedidos concorrentes de conversa direta devolvem a mesma conversa', async () => {
    const calls = await Promise.all(Array.from({ length: 6 }, () => operator.post<{ conversationId: string; created: boolean; mode: string }>(`/api/offices/${OFFICE}/actions/chat/open`, { objectId: 'ws_at_02' })));
    expect(calls.every((c) => c.status === 200)).toBe(true);
    expect(new Set(calls.map((c) => c.body.conversationId)).size).toBe(1);
    expect(calls.filter((c) => c.body.created).length).toBe(1);
    expect(calls[0].body.mode).toBe('demo');
    const id = calls[0].body.conversationId;
    expect((await operator.post(`/api/chat/conversations/${id}/messages`, { body: 'Olá, Bruno!' })).status).toBe(201);
    const msgs = (await operator.get<{ messages: Array<{ body: string; mine: boolean }> }>(`/api/chat/conversations/${id}/messages`)).body.messages;
    expect(msgs).toMatchObject([{ body: 'Olá, Bruno!', mine: true }]);
    // quem não participa da conversa (nem de outra empresa) não lê
    expect((await admin.get(`/api/chat/conversations/${id}/messages`)).status).toBe(404);
    expect((await other.get(`/api/chat/conversations/${id}/messages`)).status).toBe(404);
  });

  it('mesa vaga não abre chat e explica o motivo', async () => {
    const r = await operator.post(`/api/offices/${OFFICE}/actions/chat/open`, { objectId: 'ws_at_06' });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'not_configured', message: expect.stringContaining('Mesa vaga') });
  });
});

describe('transferência de atendimento (demonstração)', () => {
  it('exige confirmação, chave de idempotência e atendimento ativo', async () => {
    const tickets = (await operator.get<{ tickets: Array<{ id: string; version: number }>; mode: string }>('/api/tickets/active')).body;
    expect(tickets.mode).toBe('demo');
    expect(tickets.tickets.length).toBe(2);
    const t = tickets.tickets[0];
    const base = { objectId: 'ws_at_01', ticketId: t.id, expectedVersion: t.version };
    expect((await operator.post(`/api/offices/${OFFICE}/actions/transfer`, base, { 'Idempotency-Key': key() })).body).toMatchObject({ error: 'confirmation_required' });
    expect((await operator.post(`/api/offices/${OFFICE}/actions/transfer`, { ...base, confirm: true })).body).toMatchObject({ error: 'idempotency_key_required' });
    // administrador sem atendimento ativo recebe a explicação
    const none = (await admin.get<{ tickets: unknown[]; reason: string }>('/api/tickets/active')).body;
    expect(none.tickets).toEqual([]);
    expect(none.reason).toMatch(/não tem atendimento ativo/);
    expect((await admin.post(`/api/offices/${OFFICE}/actions/transfer`, { ...base, confirm: true }, { 'Idempotency-Key': key() })).body).toMatchObject({ error: 'no_active_ticket' });
  });

  it('clique duplo (mesma chave, ao mesmo tempo) transfere uma única vez', async () => {
    const t = (await operator.get<{ tickets: Array<{ id: string; version: number }> }>('/api/tickets/active')).body.tickets[0];
    const k = key();
    const body = { objectId: 'ws_at_01', ticketId: t.id, expectedVersion: t.version, confirm: true };
    const [a, b] = await Promise.all([operator.post<Record<string, unknown>>(`/api/offices/${OFFICE}/actions/transfer`, body, { 'Idempotency-Key': k }), operator.post<Record<string, unknown>>(`/api/offices/${OFFICE}/actions/transfer`, body, { 'Idempotency-Key': k })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.transferId).toBe(b.body.transferId);
    expect([a.body.replayed, b.body.replayed].sort()).toEqual([false, true]);
    expect(a.body).toMatchObject({ mode: 'demo', recipient: { name: 'Ana Ribeiro' } });
    const rows = await s.ctx.db.query('SELECT id FROM ticket_transfers WHERE ticket_id = ?', [t.id]);
    expect(rows.length).toBe(1);
    // segunda tentativa com OUTRA chave: o estado mudou, o servidor recusa
    const again = await operator.post(`/api/offices/${OFFICE}/actions/transfer`, body, { 'Idempotency-Key': key() });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: 'no_active_ticket' });
    expect((await operator.get<{ tickets: unknown[] }>('/api/tickets/active')).body.tickets.length).toBe(1);
  });

  it('destino inelegível e o próprio posto são recusados no servidor', async () => {
    const t = (await operator.get<{ tickets: Array<{ id: string; version: number }> }>('/api/tickets/active')).body.tickets[0];
    const post = (objectId: string) => operator.post(`/api/offices/${OFFICE}/actions/transfer`, { objectId, ticketId: t.id, expectedVersion: t.version, confirm: true }, { 'Idempotency-Key': key() });
    expect((await post('ws_at_04')).body).toMatchObject({ error: 'forbidden', message: expect.stringContaining('não recebe transferências') });
    expect((await post('ws_at_05')).body).toMatchObject({ error: 'forbidden', message: expect.stringContaining('própria mesa') });
    expect((await post('ws_at_06')).body).toMatchObject({ error: 'not_configured' });
    // versão desatualizada (outro processo mexeu no atendimento)
    const stale = await operator.post(`/api/offices/${OFFICE}/actions/transfer`, { objectId: 'ws_at_02', ticketId: t.id, expectedVersion: t.version + 5, confirm: true }, { 'Idempotency-Key': key() });
    expect(stale.body).toMatchObject({ error: 'ticket_changed' });
  });
});

describe('impressão', () => {
  const send = (c: Client, pdf: Uint8Array, k: string, name = 'relatorio.pdf') => c.request<Record<string, unknown>>('POST', `/api/offices/${OFFICE}/actions/print/jobs?objectId=prn_at_01&fileName=${name}&confirm=true`, pdf, { 'Idempotency-Key': k, 'Content-Type': 'application/pdf' });

  it('arquivo que não é PDF é recusado pela assinatura, mesmo com extensão .pdf', async () => {
    const r = await send(operator, new TextEncoder().encode('MZ isto não é um PDF'), key());
    expect(r.status).toBe(415);
    expect(r.body).toMatchObject({ error: 'invalid_type' });
  });

  it('arquivo acima do limite é recusado', async () => {
    const big = new Uint8Array(11 * 1024 * 1024);
    big.set(tinyPdf());
    expect((await send(operator, big, key())).status).toBe(413);
  });

  it('clique duplo não duplica o trabalho: mesma chave repete a resposta; chave diferente reaproveita o job recente', async () => {
    const pdf = tinyPdf('duplo');
    const k = key();
    const [a, b] = await Promise.all([send(operator, pdf, k), send(operator, pdf, k)]);
    const jobA = (a.body.job as { id: string }).id;
    expect((b.body.job as { id: string }).id).toBe(jobA);
    expect([a.body.replayed, b.body.replayed].sort()).toEqual([false, true]);
    const c = await send(operator, pdf, key());
    expect(c.status).toBe(200);
    expect(c.body.duplicateOf).toBe(jobA);
    const rows = await s.ctx.db.query('SELECT id FROM print_jobs WHERE file_hash IS NOT NULL AND user_id = ?', ['usr_operador']);
    expect(rows.length).toBe(1);
  });

  it('diferencia diálogo aberto, envio confirmado pela fila e conclusão reportada', async () => {
    const dialog = await operator.post(`/api/offices/${OFFICE}/actions/print/dialog`, { objectId: 'prn_at_01', fileName: 'a.pdf' });
    expect(dialog.body).toMatchObject({ status: 'dialog_opened', note: expect.stringContaining('não sabe') });
    const sent = await send(admin, tinyPdf('estados'), key());
    expect(sent.status).toBe(201);
    const job = sent.body.job as { id: string; status: string; mode: string };
    expect(job).toMatchObject({ status: 'queued', mode: 'demo' });
    await s.ctx.db.exec('UPDATE print_jobs SET created_at = created_at - 3000 WHERE id = ?', [job.id]);
    expect((await admin.get<{ job: { status: string; statusLabel: string } }>(`/api/print/jobs/${job.id}`)).body.job).toMatchObject({ status: 'sent', statusLabel: 'Envio confirmado pela fila' });
    await s.ctx.db.exec('UPDATE print_jobs SET created_at = created_at - 8000 WHERE id = ?', [job.id]);
    expect((await admin.get<{ job: { status: string } }>(`/api/print/jobs/${job.id}`)).body.job.status).toBe('completed');
    // retenção: o arquivo sai do disco quando a fila conclui
    const row = await s.ctx.db.query<{ stored_path: string | null }>('SELECT stored_path FROM print_jobs WHERE id = ?', [job.id]);
    expect(row[0].stored_path).toBeNull();
    // o trabalho de um usuário não é visível para outro
    expect((await operator.get(`/api/print/jobs/${job.id}`)).status).toBe(404);
  });

  it('visualizador não imprime; fila fora do ar responde indisponível', async () => {
    expect((await send(viewer, tinyPdf('v'), key())).status).toBe(403);
    await admin.post('/api/demo/outage', { service: 'print', down: true });
    expect((await send(operator, tinyPdf('fora'), key())).status).toBe(503);
    // o diálogo do navegador não depende da fila
    expect((await operator.post(`/api/offices/${OFFICE}/actions/print/dialog`, { objectId: 'prn_at_01' })).status).toBe(200);
    await admin.post('/api/demo/outage', { service: 'print', down: false });
  });
});

describe('acesso remoto', () => {
  it('pede confirmação, registra o pedido e, no modo demonstração, não devolve endereço nem link', async () => {
    expect((await operator.post(`/api/offices/${OFFICE}/actions/remote/request`, { objectId: 'ws_at_01' })).body).toMatchObject({ error: 'confirmation_required' });
    const r = await operator.post<Record<string, unknown>>(`/api/offices/${OFFICE}/actions/remote/request`, { objectId: 'ws_at_01', confirm: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: 'demo', status: 'registered', device: { name: 'PC-ATD-01' } });
    expect(r.body.address).toBeUndefined();
    expect(r.body.launchUrl).toBeUndefined();
    const audit = (await admin.get<{ entries: Array<{ action: string; result: string; mode: string; correlationId: string; actorName: string }> }>('/api/admin/audit?limit=200')).body.entries;
    const entry = audit.find((e) => e.action === 'remote.request' && e.result === 'registered');
    expect(entry).toMatchObject({ mode: 'demo', actorName: expect.stringContaining('Otávio') });
    expect(entry?.correlationId).toBe(r.headers.get('x-correlation-id'));
  });

  it('com REMOTE_PROVIDER=anydesk devolve o endereço autorizado; o link anydesk: só com ANYDESK_LAUNCH=uri', async () => {
    const real = await startServer({ REMOTE_PROVIDER: 'anydesk' });
    const uri = await startServer({ REMOTE_PROVIDER: 'anydesk', ANYDESK_LAUNCH: 'uri' });
    try {
      const a = await (await new Client(real.url).login(OPERATOR)).post<Record<string, unknown>>(`/api/offices/${OFFICE}/actions/remote/request`, { objectId: 'ws_at_01', confirm: true });
      expect(a.body).toMatchObject({ mode: 'real', status: 'launch_ready', address: '100000001', command: 'anydesk.exe 100000001' });
      expect(a.body.launchUrl).toBeUndefined();
      const b = await (await new Client(uri.url).login(OPERATOR)).post<Record<string, unknown>>(`/api/offices/${OFFICE}/actions/remote/request`, { objectId: 'ws_at_01', confirm: true });
      expect(b.body.launchUrl).toBe('anydesk:100000001');
    } finally {
      await real.close();
      await uri.close();
    }
  });
});

describe('painéis e links', () => {
  it('abre só painel autorizado; endereço fora da lista não é aceito no vínculo', async () => {
    const ok = await operator.post<Record<string, unknown>>(`/api/offices/${OFFICE}/actions/dashboard/open`, { objectId: 'tv_noc_02' });
    expect(ok.body).toMatchObject({ mode: 'demo', url: '/demo/dashboard.html?painel=chamados' });
    const bad = await admin.put(`/api/admin/offices/${OFFICE}/bindings/tv_reuniao`, { type: 'dashboard', name: 'Externo', url: 'https://exemplo-nao-autorizado.test/painel' });
    expect(bad.status).toBe(422);
    const js = await admin.put(`/api/admin/offices/${OFFICE}/bindings/tv_reuniao`, { type: 'dashboard', name: 'x', url: 'javascript:alert(1)' });
    expect(js.status).toBe(422);
    const cad = await admin.put(`/api/admin/offices/${OFFICE}/bindings/room_noc`, { type: 'cad_link', name: 'Planta', url: 'https://viewer.autodesk.com/id/abc' });
    expect(cad.status).toBe(422); // CAD_ALLOWED_HOSTS vazio: integração a confirmar
  });
});

describe('catálogo e upload de modelos', () => {
  const upload = (c: Client, bytes: Uint8Array, q: string) => c.request<Record<string, unknown>>('POST', `/api/assets/upload?${q}`, bytes, { 'Content-Type': 'model/gltf-binary' });
  const glb = () => new Uint8Array(readFileSync(path.join(import.meta.dirname, '../public/assets/models/mesa-reta.glb')));

  it('o catálogo traz licença, autor e medidas de cada asset', async () => {
    const assets = (await operator.get<{ assets: Array<Record<string, unknown>> }>('/api/assets')).body.assets;
    expect(assets.length).toBeGreaterThan(40);
    const copier = assets.find((a) => a.slug === 'copiadora')!;
    expect(copier).toMatchObject({ license: 'CC-BY 3.0', author: 'Bruno Oliveira', defaultKind: 'printer' });
    expect(String(copier.attribution)).toContain('poly.pizza');
  });

  it('recusa arquivo que não é GLB, GLB com recurso externo e arquivo grande demais', async () => {
    const q = 'name=Teste&license=CC0%201.0';
    expect((await upload(admin, new TextEncoder().encode('<html>não sou um modelo</html>'), q)).body).toMatchObject({ error: 'invalid_type' });
    // GLB mínimo cujo JSON aponta para um buffer externo
    const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'https://exemplo.test/dados.bin', byteLength: 4 }] }).padEnd(100, ' '));
    const ext = new Uint8Array(20 + json.length);
    const dv = new DataView(ext.buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, ext.length, true);
    dv.setUint32(12, json.length, true);
    dv.setUint32(16, 0x4e4f534a, true);
    ext.set(json, 20);
    expect((await upload(admin, ext, q)).body).toMatchObject({ error: 'external_resources' });
    expect((await upload(admin, new Uint8Array(9 * 1024 * 1024), q)).status).toBe(413);
    expect((await upload(operator, glb(), q)).status).toBe(403);
    expect((await upload(admin, glb(), 'name=SemLicenca')).status).toBe(400);
  });

  it('deduplica pelo hash sem misturar metadados: mesmo arquivo com outra licença vira outro cadastro que reaproveita o arquivo', async () => {
    const a = await upload(admin, glb(), 'name=Mesa%20enviada&license=CC0%201.0&kind=furniture');
    expect(a.status).toBe(201);
    const b = await upload(admin, glb(), 'name=Mesa%20enviada&license=CC0%201.0&kind=furniture');
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ reusedDefinition: true, deduplicatedFile: true });
    const c = await upload(admin, glb(), 'name=Mesa%20enviada&license=Propriet%C3%A1ria&kind=furniture');
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ reusedDefinition: false, deduplicatedFile: true });
    const [x, y, z] = [a, b, c].map((r) => r.body.asset as { id: string; fileHash: string; license: string; url: string });
    expect(x.id).toBe(y.id);
    expect(z.id).not.toBe(x.id);
    expect(z.fileHash).toBe(x.fileHash);
    expect([x.license, z.license]).toEqual(['CC0 1.0', 'Proprietária']);
    // o arquivo enviado é servido só para a própria empresa
    expect((await fetch(s.url + x.url, { headers: { Cookie: admin.cookie } })).status).toBe(200);
    expect((await fetch(s.url + x.url, { headers: { Cookie: other.cookie } })).status).toBe(404);
    expect((await other.get<{ assets: Array<{ id: string }> }>('/api/assets')).body.assets.some((k) => k.id === x.id)).toBe(false);
  });
});
