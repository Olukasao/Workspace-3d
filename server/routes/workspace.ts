/**
 * Ambiente virtual: modo global 2D/3D (escolhido só pelo administrador) e escritório 2D.
 * - GET  /api/workspace                                  modo em vigor (qualquer perfil logado)
 * - GET  /api/admin/workspace-mode, PUT { mode, confirm } administrador: troca o modo para a empresa toda, ao vivo
 * - GET  /api/office2d/:officeId                         layout publicado (ou o padrão) e quem senta em cada estação
 * - POST /api/office2d/:officeId/join, /move             entrar no escritório e propor a posição (o servidor valida)
 * - GET  /api/admin/office2d/:officeId/draft             administrador: rascunho do layout (ou publicado/padrão)
 * - PUT  /api/admin/office2d/:officeId/draft             grava o rascunho (versão-base; 409 em conflito; 422 se inválido)
 * - POST /api/admin/office2d/:officeId/publish           publica o rascunho: todos os conectados recebem na hora
 * - PUT  /api/admin/office2d/:officeId/seats/:stationId  vincula (ou desvincula) um colaborador a uma estação
 * - POST /api/office2d/:officeId/chat/open               abre a conversa direta com um colega (cartão da pessoa no 2D)
 * - GET  /api/office2d/:officeId/objects/:objectId/remote          TV do 2D: dispositivo vinculado e se o usuário pode conectar
 * - GET  /api/office2d/:officeId/objects/:objectId/remote/devices  lista de dispositivos para escolher (como o catálogo do AnyDesk), com a permissão de cada um
 * - POST /api/office2d/:officeId/objects/:objectId/remote/request  { deviceId?, confirm } prepara a conexão com o dispositivo escolhido (AnyDesk ou RustDesk); nunca conecta sozinho
 * - GET  /api/office2d/:officeId/objects/:objectId/printers          impressora do 2D: lista de impressoras para escolher
 * - POST /api/office2d/:officeId/objects/:objectId/print/jobs      corpo = PDF; envia à fila da impressora escolhida (?deviceId=&fileName=&confirm=true)
 * - GET  /api/admin/office2d/:officeId/devices                     administrador: dispositivos para vincular e o vínculo de cada objeto
 * - PUT  /api/admin/office2d/:officeId/objects/:objectId/device    { deviceId | null } vincula um dispositivo a uma TV do layout
 * - GET  /api/admin/office2d/:officeId/tiled             exporta o layout no formato JSON do Tiled
 */
import express, { type Router } from 'express';
import { sha256 } from '../assets/glb';
import { WORKSPACE_MODES, isWorkspaceMode } from '../../shared/workspace';
import { DIRS, layoutToTiled, validateLayout, type Layout2D } from '../../shared/office2d';
import { defaultLayout2D } from '../../shared/office2dDefault';
import type { AppContext } from '../app';
import { currentUser, requireRole } from '../auth';
import { one } from '../db/driver';
import { HttpError, audit, correlationId, h, idempotent, newId, str } from '../http';
import { loadOffice } from '../office';

export function workspaceRoutes(r: Router, ctx: AppContext) {
  const { db, live, office2d, integrations } = ctx;

  // ---------- modo global ----------
  r.get('/workspace', h(async (_req, res) => res.json(await live.workspaceState(currentUser(res).companyId))));
  r.get('/admin/workspace-mode', requireRole('admin'), h(async (_req, res) => res.json({ ...(await live.workspaceState(currentUser(res).companyId)), options: WORKSPACE_MODES })));
  r.put('/admin/workspace-mode', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    const { mode, confirm } = (req.body ?? {}) as { mode?: unknown; confirm?: unknown };
    if (!isWorkspaceMode(mode)) throw new HttpError(400, 'bad_request', `Modo inválido. Use: ${WORKSPACE_MODES.join(' ou ')}.`);
    const before = await live.workspaceState(user.companyId);
    if (before.mode !== mode && confirm !== true) throw new HttpError(400, 'confirm_required', 'Trocar o ambiente muda a tela de todos os usuários conectados. Confirme a troca.');
    const state = await live.setWorkspaceMode(user.companyId, mode, user.id);
    if (before.mode !== mode) await audit(db, { user, action: 'workspace.mode', targetType: 'company', targetId: user.companyId, result: 'completed', mode: 'real', detail: { from: before.mode, to: mode }, correlationId: correlationId(res) });
    res.json({ ...state, options: WORKSPACE_MODES });
  }));

  // ---------- escritório 2D (todos) ----------
  const seatList = async (companyId: string, officeId: string) =>
    db.query<{ stationId: string; employeeId: string; name: string; department: string }>(
      'SELECT a.station_id AS stationId, a.employee_id AS employeeId, e.name AS name, e.department AS department FROM seat2d_assignments a JOIN employees e ON e.id = a.employee_id WHERE a.company_id = ? AND a.office_id = ? AND e.active = 1',
      [companyId, officeId],
    );
  const requireMode2d = async (companyId: string) => {
    if ((await live.workspaceState(companyId)).mode !== '2d') throw new HttpError(409, 'wrong_mode', 'O escritório 2D não está ativo: o administrador escolheu o ambiente 3D.');
  };

  r.get('/office2d/:officeId', h(async (req, res) => {
    const user = currentUser(res);
    await loadOffice(db, user, req.params.officeId);
    const { layout, version, published } = await office2d.layoutOf(user.companyId, req.params.officeId);
    res.json({ layout, version, published, seats: await seatList(user.companyId, req.params.officeId) });
  }));

  // quem está no mapa agora (para quem só observa, por exemplo enquanto o Workspace dele está fechado)
  r.get('/office2d/:officeId/positions', h(async (req, res) => {
    const user = currentUser(res);
    await loadOffice(db, user, req.params.officeId);
    await requireMode2d(user.companyId);
    res.json({ positions: office2d.list(user.companyId, req.params.officeId) });
  }));

  r.post('/office2d/:officeId/join', h(async (req, res) => {
    const user = currentUser(res);
    await loadOffice(db, user, req.params.officeId);
    await requireMode2d(user.companyId);
    res.json(await office2d.join(user, req.params.officeId));
  }));

  r.post('/office2d/:officeId/move', h(async (req, res) => {
    const user = currentUser(res);
    await loadOffice(db, user, req.params.officeId);
    await requireMode2d(user.companyId);
    const b = (req.body ?? {}) as Record<string, unknown>;
    // só o que o servidor usa: o resto do corpo é ignorado (a posição vale sempre para o colaborador da sessão)
    if (typeof b.x !== 'number' || typeof b.y !== 'number' || !Number.isFinite(b.x) || !Number.isFinite(b.y) || Math.abs(b.x) > 1e5 || Math.abs(b.y) > 1e5) throw new HttpError(400, 'bad_request', 'Posição inválida.');
    if (!DIRS.includes(b.dir as never)) throw new HttpError(400, 'bad_request', 'Direção inválida.');
    if (b.seat !== null && b.seat !== undefined && (typeof b.seat !== 'string' || b.seat.length > 40)) throw new HttpError(400, 'bad_request', 'Estação inválida.');
    res.json(await office2d.move(user, req.params.officeId, { x: b.x, y: b.y, dir: b.dir as never, moving: b.moving === true, seat: (b.seat as string | null | undefined) ?? null }));
  }));

  // conversa direta com um colega, a partir do cartão da pessoa no 2D (mesmo provedor e mesma trilha do chat do 3D)
  r.post('/office2d/:officeId/chat/open', h(async (req, res) => {
    const user = currentUser(res);
    await loadOffice(db, user, req.params.officeId);
    if (user.role === 'viewer') throw new HttpError(403, 'forbidden', 'O perfil de visualizador não abre conversas.');
    const peerId = (req.body as { employeeId?: unknown })?.employeeId;
    if (typeof peerId !== 'string' || peerId === user.employeeId) throw new HttpError(400, 'bad_request', 'Escolha um colega.');
    const peer = await one<{ id: string; name: string; chat_ref: string | null }>(db, 'SELECT id, name, chat_ref FROM employees WHERE id = ? AND company_id = ? AND active = 1', [peerId, user.companyId]);
    if (!peer) throw new HttpError(404, 'not_found', 'Colaborador não encontrado.');
    const mode = integrations.chat.mode;
    try {
      integrations.ensureUp('chat');
      const self = user.employeeId ? await one<{ id: string; name: string; chat_ref: string | null }>(db, 'SELECT id, name, chat_ref FROM employees WHERE id = ? AND company_id = ?', [user.employeeId, user.companyId]) : null;
      const out = await integrations.chat.openDirect(user, self ? { id: self.id, name: self.name, chatRef: self.chat_ref } : null, { id: peer.id, name: peer.name, chatRef: peer.chat_ref });
      await audit(db, { user, action: 'chat.open', targetType: 'employee', targetId: peer.id, result: 'completed', mode, detail: { conversationId: out.conversationId, created: out.created, from: '2d' }, correlationId: correlationId(res) });
      res.json({ ...out, mode, peer: { id: peer.id, name: peer.name } });
    } catch (e) {
      await audit(db, { user, action: 'chat.open', targetType: 'employee', targetId: peer.id, result: 'failed', mode, detail: { error: (e as Error).message, from: '2d' }, correlationId: correlationId(res) });
      throw e;
    }
  }));

  // ---------- editor do administrador ----------
  const draftRow = (companyId: string, officeId: string, status: 'draft' | 'published') =>
    one<{ layout_json: string; version: number; updated_at: number }>(db, 'SELECT layout_json, version, updated_at FROM office2d_layouts WHERE company_id = ? AND office_id = ? AND status = ?', [companyId, officeId, status]);

  r.get('/admin/office2d/:officeId/draft', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    await loadOffice(db, user, req.params.officeId);
    const [draft, published] = await Promise.all([draftRow(user.companyId, req.params.officeId, 'draft'), draftRow(user.companyId, req.params.officeId, 'published')]);
    const src = draft ?? published;
    const layout: Layout2D = src ? (JSON.parse(src.layout_json) as Layout2D) : defaultLayout2D();
    res.json({ layout, version: Number(draft?.version ?? 0), publishedVersion: Number(published?.version ?? 0), isDefault: !src, seats: await seatList(user.companyId, req.params.officeId) });
  }));

  r.put('/admin/office2d/:officeId/draft', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    await loadOffice(db, user, req.params.officeId);
    const { layout, baseVersion } = (req.body ?? {}) as { layout?: unknown; baseVersion?: unknown };
    if (!Number.isInteger(baseVersion)) throw new HttpError(400, 'bad_request', 'Informe a versão-base do rascunho.');
    const check = validateLayout(layout);
    if (!check.layout) throw new HttpError(422, 'invalid_layout', 'O layout tem problemas e não foi salvo.', { details: check.errors });
    const version = await db.tx(async (tx) => {
      const cur = await one<{ version: number }>(tx, "SELECT version FROM office2d_layouts WHERE company_id = ? AND office_id = ? AND status = 'draft'", [user.companyId, req.params.officeId]);
      const curVersion = Number(cur?.version ?? 0);
      if (curVersion !== baseVersion) throw new HttpError(409, 'draft_conflict', 'Outro administrador salvou este rascunho antes. Recarregue para continuar.', { currentVersion: curVersion });
      const json = JSON.stringify(check.layout);
      const now = Date.now();
      if (cur) await tx.exec("UPDATE office2d_layouts SET layout_json = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE company_id = ? AND office_id = ? AND status = 'draft'", [json, user.id, now, user.companyId, req.params.officeId]);
      else await tx.exec("INSERT INTO office2d_layouts (company_id, office_id, status, version, layout_json, updated_by, updated_at) VALUES (?, ?, 'draft', 1, ?, ?, ?)", [user.companyId, req.params.officeId, json, user.id, now]);
      return curVersion + 1;
    });
    await audit(db, { user, action: 'office2d.draft', targetType: 'office', targetId: req.params.officeId, result: 'completed', mode: 'real', detail: { version }, correlationId: correlationId(res) });
    res.json({ version });
  }));

  r.post('/admin/office2d/:officeId/publish', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    const officeId = req.params.officeId;
    await loadOffice(db, user, officeId);
    const { baseVersion } = (req.body ?? {}) as { baseVersion?: unknown };
    const draft = await draftRow(user.companyId, officeId, 'draft');
    if (!draft) throw new HttpError(409, 'no_draft', 'Salve o rascunho antes de publicar.');
    if (Number(draft.version) !== baseVersion) throw new HttpError(409, 'draft_conflict', 'O rascunho mudou desde que você o abriu. Recarregue para continuar.', { currentVersion: Number(draft.version) });
    const check = validateLayout(JSON.parse(draft.layout_json));
    if (!check.layout) throw new HttpError(422, 'invalid_layout', 'O rascunho tem problemas e não foi publicado.', { details: check.errors });
    const stationIds = new Set(check.layout.stations.map((s) => s.id));
    const version = await db.tx(async (tx) => {
      const cur = await one<{ version: number }>(tx, "SELECT version FROM office2d_layouts WHERE company_id = ? AND office_id = ? AND status = 'published'", [user.companyId, officeId]);
      const next = Number(cur?.version ?? 0) + 1;
      const now = Date.now();
      if (cur) await tx.exec("UPDATE office2d_layouts SET layout_json = ?, version = ?, updated_by = ?, updated_at = ? WHERE company_id = ? AND office_id = ? AND status = 'published'", [draft.layout_json, next, user.id, now, user.companyId, officeId]);
      else await tx.exec("INSERT INTO office2d_layouts (company_id, office_id, status, version, layout_json, updated_by, updated_at) VALUES (?, ?, 'published', ?, ?, ?, ?)", [user.companyId, officeId, next, draft.layout_json, user.id, now]);
      // estações que deixaram de existir perdem o vínculo
      const rows = await tx.query<{ station_id: string }>('SELECT station_id FROM seat2d_assignments WHERE company_id = ? AND office_id = ?', [user.companyId, officeId]);
      for (const s of rows) if (!stationIds.has(s.station_id)) await tx.exec('DELETE FROM seat2d_assignments WHERE company_id = ? AND office_id = ? AND station_id = ?', [user.companyId, officeId, s.station_id]);
      return next;
    });
    await office2d.layoutChanged(user.companyId, officeId);
    await office2d.seatsChanged(user.companyId, officeId);
    await audit(db, { user, action: 'office2d.publish', targetType: 'office', targetId: officeId, result: 'completed', mode: 'real', detail: { version }, correlationId: correlationId(res) });
    res.json({ version });
  }));

  r.put('/admin/office2d/:officeId/seats/:stationId', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    const officeId = req.params.officeId;
    await loadOffice(db, user, officeId);
    const employeeId = (req.body as { employeeId?: unknown } | undefined)?.employeeId ?? null;
    if (employeeId !== null && typeof employeeId !== 'string') throw new HttpError(400, 'bad_request', 'Informe o colaborador ou null para liberar a estação.');
    const [draft, published] = await Promise.all([draftRow(user.companyId, officeId, 'draft'), draftRow(user.companyId, officeId, 'published')]);
    const src = draft ?? published;
    const layout: Layout2D = src ? (JSON.parse(src.layout_json) as Layout2D) : defaultLayout2D();
    if (!layout.stations.some((s) => s.id === req.params.stationId)) throw new HttpError(404, 'not_found', 'Estação não encontrada neste layout.');
    if (employeeId) {
      const emp = await one<{ id: string }>(db, 'SELECT id FROM employees WHERE id = ? AND company_id = ? AND active = 1', [employeeId, user.companyId]);
      if (!emp) throw new HttpError(404, 'not_found', 'Colaborador não encontrado.');
    }
    await db.tx(async (tx) => {
      await tx.exec('DELETE FROM seat2d_assignments WHERE company_id = ? AND office_id = ? AND station_id = ?', [user.companyId, officeId, req.params.stationId]);
      if (employeeId) {
        await tx.exec('DELETE FROM seat2d_assignments WHERE company_id = ? AND office_id = ? AND employee_id = ?', [user.companyId, officeId, employeeId]); // uma pessoa, uma estação
        await tx.exec('INSERT INTO seat2d_assignments (company_id, office_id, station_id, employee_id, updated_at) VALUES (?, ?, ?, ?, ?)', [user.companyId, officeId, req.params.stationId, employeeId, Date.now()]);
      }
    });
    await office2d.seatsChanged(user.companyId, officeId);
    await audit(db, { user, action: 'office2d.seat', targetType: 'station', targetId: req.params.stationId, result: 'completed', mode: 'real', detail: { employeeId }, correlationId: correlationId(res) });
    res.json({ seats: await seatList(user.companyId, officeId) });
  }));

  // ---------- TV do 2D: acesso remoto ao dispositivo que mostra a tela ----------
  // O vínculo (objeto do layout → dispositivo gerenciado) e a permissão (administrador ou concessão do dispositivo) são reavaliados no servidor.
  // A conexão em si, o consentimento e a autenticação acontecem no AnyDesk ou no RustDesk: aqui nada é executado nem conectado sozinho.
  const TV_KINDS = ['tv_player', 'pc', 'tv'];
  type User = ReturnType<typeof currentUser>;
  const layoutOf = async (companyId: string, officeId: string, preferDraft: boolean): Promise<Layout2D> => {
    const [draft, published] = await Promise.all([draftRow(companyId, officeId, 'draft'), draftRow(companyId, officeId, 'published')]);
    const src = preferDraft ? (draft ?? published) : (published ?? draft);
    return src ? (JSON.parse(src.layout_json) as Layout2D) : defaultLayout2D();
  };
  const tvObject = async (user: User, officeId: string, objectId: string, preferDraft: boolean, assets: string[] = ['tv']) => {
    await loadOffice(db, user, officeId);
    const o = (await layoutOf(user.companyId, officeId, preferDraft)).objects.find((x) => x.id === objectId);
    if (!o || !assets.includes(o.asset)) throw new HttpError(404, 'not_found', assets.includes('printer') ? 'Objeto não encontrado neste layout.' : 'TV não encontrada neste layout.');
    return o;
  };
  interface TvDevice { device_id: string; name: string; kind: string; remote_provider: string | null; remote_address: string | null; active: number }
  const tvDevice = (user: User, officeId: string, objectId: string) =>
    one<TvDevice>(
      db,
      'SELECT b.device_id, d.name, d.kind, d.remote_provider, d.remote_address, d.active FROM object2d_devices b JOIN managed_devices d ON d.id = b.device_id AND d.company_id = b.company_id WHERE b.company_id = ? AND b.office_id = ? AND b.object_id = ?',
      [user.companyId, officeId, objectId],
    );
  /** Estado da ação "gerenciar a TV" para o usuário (a mesma função vale na hora de pedir). */
  const tvState = async (user: User, officeId: string, objectId: string) => {
    const dev = await tvDevice(user, officeId, objectId);
    const no = (state: 'forbidden' | 'not_configured', reason: string) => ({ state, reason, dev: null as TvDevice | null });
    if (user.role === 'viewer') return no('forbidden', 'O perfil de visualizador não executa ações.');
    if (!dev || dev.active !== 1) return no('not_configured', dev ? 'O dispositivo vinculado a esta TV está inativo.' : 'Nenhum dispositivo está vinculado a esta TV. O administrador vincula no editor do escritório.');
    if (!dev.remote_provider || !dev.remote_address) return no('not_configured', 'O dispositivo da TV não tem acesso remoto cadastrado (AnyDesk ou RustDesk).');
    if (user.role !== 'admin' && !(await one(db, 'SELECT 1 AS ok FROM remote_access_grants WHERE user_id = ? AND company_id = ? AND device_id = ?', [user.id, user.companyId, dev.device_id]))) return no('forbidden', 'Você não tem permissão de acesso remoto para o dispositivo desta TV.');
    return { state: 'ready' as const, reason: undefined, dev };
  };

  r.get('/office2d/:officeId/objects/:objectId/remote', h(async (req, res) => {
    const user = currentUser(res);
    await requireMode2d(user.companyId);
    const obj = await tvObject(user, req.params.officeId, req.params.objectId, false);
    const st = await tvState(user, req.params.officeId, obj.id);
    res.json({ state: st.state, reason: st.reason, mode: integrations.remote.mode, device: st.dev ? { id: st.dev.device_id, name: st.dev.name, provider: st.dev.remote_provider } : null });
  }));

  // Lista de dispositivos para escolher (como o catálogo "Meus dispositivos" do AnyDesk): todo dispositivo com acesso remoto cadastrado,
  // cada um com o que o usuário pode fazer nele. O dispositivo ligado à TV vem marcado, mas qualquer um permitido pode ser escolhido.
  interface RemoteRow { id: string; name: string; kind: string; location: string | null; remote_provider: string | null; remote_address: string | null; active: number }
  const usable = async (user: User, d: Pick<RemoteRow, 'id' | 'active' | 'remote_provider' | 'remote_address'>, granted?: Set<string>): Promise<string | null> => {
    if (user.role === 'viewer') return 'O perfil de visualizador não executa ações.';
    if (d.active !== 1) return 'O dispositivo está inativo.';
    if (!d.remote_provider || !d.remote_address) return 'O dispositivo não tem acesso remoto cadastrado (AnyDesk ou RustDesk).';
    const g = granted ?? new Set((await db.query<{ device_id: string }>('SELECT device_id FROM remote_access_grants WHERE user_id = ? AND company_id = ?', [user.id, user.companyId])).map((x) => x.device_id));
    if (user.role !== 'admin' && !g.has(d.id)) return 'Você não tem permissão de acesso remoto para este dispositivo.';
    return null;
  };

  r.get('/office2d/:officeId/objects/:objectId/remote/devices', h(async (req, res) => {
    const user = currentUser(res);
    await requireMode2d(user.companyId);
    const obj = await tvObject(user, req.params.officeId, req.params.objectId, false);
    const [rows, grants, bound] = await Promise.all([
      db.query<RemoteRow>("SELECT id, name, kind, location, remote_provider, remote_address, active FROM managed_devices WHERE company_id = ? AND active = 1 AND remote_provider IS NOT NULL AND kind <> 'printer' ORDER BY name", [user.companyId]),
      db.query<{ device_id: string }>('SELECT device_id FROM remote_access_grants WHERE user_id = ? AND company_id = ?', [user.id, user.companyId]),
      tvDevice(user, req.params.officeId, obj.id),
    ]);
    const granted = new Set(grants.map((g) => g.device_id));
    const devices = [];
    for (const d of rows) {
      const reason = await usable(user, d, granted);
      devices.push({ id: d.id, name: d.name, kind: d.kind, location: d.location, provider: d.remote_provider, canConnect: !reason, reason: reason ?? undefined, bound: d.id === bound?.device_id });
    }
    devices.sort((a, b) => Number(b.bound) - Number(a.bound) || Number(b.canConnect) - Number(a.canConnect) || a.name.localeCompare(b.name));
    res.json({ mode: integrations.remote.mode, devices });
  }));

  r.post('/office2d/:officeId/objects/:objectId/remote/request', h(async (req, res) => {
    const user = currentUser(res);
    const cid = correlationId(res);
    await requireMode2d(user.companyId);
    const obj = await tvObject(user, req.params.officeId, req.params.objectId, false);
    const body = (req.body ?? {}) as { deviceId?: unknown; confirm?: unknown };
    // sem deviceId vale o dispositivo ligado à TV; com deviceId, o que a pessoa escolheu na lista (e que ela tem permissão de usar)
    const bound = await tvDevice(user, req.params.officeId, obj.id);
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId : bound?.device_id;
    if (!deviceId) throw new HttpError(409, 'not_configured', 'Nenhum dispositivo está vinculado a esta TV: escolha um dispositivo na lista.');
    const dev = await one<RemoteRow>(db, 'SELECT id, name, kind, location, remote_provider, remote_address, active FROM managed_devices WHERE id = ? AND company_id = ?', [deviceId, user.companyId]);
    if (!dev || dev.kind === 'printer') throw new HttpError(404, 'not_found', 'Dispositivo não encontrado.');
    const reason = await usable(user, dev);
    if (reason) throw new HttpError(user.role === 'viewer' || /permiss/.test(reason) ? 403 : 409, /permiss|visualizador/.test(reason) ? 'forbidden' : 'not_configured', reason);
    if (body.confirm !== true) throw new HttpError(400, 'confirmation_required', 'O acesso remoto precisa de confirmação explícita.');
    const mode = integrations.remote.mode;
    try {
      integrations.ensureUp('remote');
      const out = await integrations.remote.prepare({ id: dev.id, name: dev.name, remoteProvider: dev.remote_provider, remoteAddress: dev.remote_address });
      const requestId = newId('rar');
      await db.exec('INSERT INTO remote_access_requests (id, company_id, device_id, object_id, requested_by, provider, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [requestId, user.companyId, dev.id, obj.id, user.id, dev.remote_provider ?? 'none', mode, out.status, Date.now()]);
      await audit(db, { user, action: 'remote.request', targetType: 'device', targetId: dev.id, objectId: obj.id, result: out.status, mode, detail: { requestId, provider: dev.remote_provider, origin: 'office2d', chosen: typeof body.deviceId === 'string' }, correlationId: cid });
      // na demonstração o endereço não é devolvido: nada é aberto
      res.json({ requestId, mode, status: out.status, provider: dev.remote_provider, device: { id: dev.id, name: dev.name }, note: out.note, address: mode === 'real' ? out.address : undefined, command: mode === 'real' ? out.command : undefined, launchUrl: mode === 'real' ? out.launchUrl : undefined, correlationId: cid });
    } catch (e) {
      await audit(db, { user, action: 'remote.request', targetType: 'device', targetId: dev.id, objectId: obj.id, result: 'failed', mode, detail: { error: (e as Error).message, origin: 'office2d' }, correlationId: cid });
      throw e;
    }
  }));

  // ---------- impressora do 2D: escolher a impressora na lista e mandar o PDF para a fila dela ----------
  r.get('/office2d/:officeId/objects/:objectId/printers', h(async (req, res) => {
    const user = currentUser(res);
    await requireMode2d(user.companyId);
    const obj = await tvObject(user, req.params.officeId, req.params.objectId, false, ['printer']);
    const [rows, bound] = await Promise.all([
      db.query<{ id: string; name: string; location: string | null }>("SELECT id, name, location FROM managed_devices WHERE company_id = ? AND active = 1 AND kind = 'printer' ORDER BY name", [user.companyId]),
      tvDevice(user, req.params.officeId, obj.id),
    ]);
    const reason = user.role === 'viewer' ? 'O perfil de visualizador não executa ações.' : undefined;
    const printers = rows.map((d) => ({ id: d.id, name: d.name, location: d.location, canPrint: !reason, reason, bound: d.id === bound?.device_id }));
    printers.sort((a, b) => Number(b.bound) - Number(a.bound) || a.name.localeCompare(b.name));
    res.json({ mode: integrations.print.mode, queue: { available: integrations.print.configured, reason: integrations.print.configured ? undefined : integrations.print.detail }, printers });
  }));

  /** Corpo = bytes do PDF; mesmas garantias do 3D (confirmação, assinatura, tamanho, idempotência e clique duplo), para a impressora ESCOLHIDA. */
  r.post('/office2d/:officeId/objects/:objectId/print/jobs', express.raw({ type: () => true, limit: ctx.cfg.printMaxBytes }), h(async (req, res) => {
    const user = currentUser(res);
    const cid = correlationId(res);
    await requireMode2d(user.companyId);
    const obj = await tvObject(user, req.params.officeId, req.params.objectId, false, ['printer']);
    if (user.role === 'viewer') throw new HttpError(403, 'forbidden', 'O perfil de visualizador não executa ações.');
    const bound = await tvDevice(user, req.params.officeId, obj.id);
    const deviceId = str(req.query.deviceId, 40) ?? bound?.device_id;
    if (!deviceId) throw new HttpError(409, 'not_configured', 'Nenhuma impressora está vinculada a este objeto: escolha uma na lista.');
    const printer = await one<{ id: string; name: string }>(db, "SELECT id, name FROM managed_devices WHERE id = ? AND company_id = ? AND active = 1 AND kind = 'printer'", [deviceId, user.companyId]);
    if (!printer) throw new HttpError(404, 'not_found', 'Impressora não encontrada.');
    if (req.query.confirm !== 'true') throw new HttpError(400, 'confirmation_required', 'O envio para a impressora precisa de confirmação explícita.');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'bad_request', 'Documento ausente.');
    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    const hash = sha256(bytes);
    const fileName = (str(req.query.fileName, 200) ?? 'documento.pdf').replace(/[\\/:*?"<>|]/g, '_');
    const out = await idempotent(db, user, 'print', req.header('idempotency-key'), { officeId: req.params.officeId, objectId: obj.id, deviceId: printer.id, hash }, () =>
      ctx.printApi!.printSubmit({ user, cid, objectId: obj.id, printer: { device_id: printer.id, device_name: printer.name }, fileName, body, bytes, hash, mode: integrations.print.mode }),
    );
    res.status(out.status).json({ ...out.body, replayed: out.replayed });
  }));

  r.get('/admin/office2d/:officeId/devices', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    await loadOffice(db, user, req.params.officeId);
    const devices = await db.query<{ id: string; name: string; kind: string; location: string | null; remote_provider: string | null; active: number }>('SELECT id, name, kind, location, remote_provider, active FROM managed_devices WHERE company_id = ? AND active = 1 ORDER BY name', [user.companyId]);
    const links = await db.query<{ object_id: string; device_id: string }>('SELECT object_id, device_id FROM object2d_devices WHERE company_id = ? AND office_id = ?', [user.companyId, req.params.officeId]);
    res.json({ devices: devices.filter((d) => TV_KINDS.includes(d.kind) || d.kind === 'printer').map((d) => ({ id: d.id, name: d.name, kind: d.kind, location: d.location, remoteProvider: d.remote_provider })), links: Object.fromEntries(links.map((l) => [l.object_id, l.device_id])) });
  }));

  r.put('/admin/office2d/:officeId/objects/:objectId/device', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    const officeId = req.params.officeId;
    const obj = await tvObject(user, officeId, req.params.objectId, true, ['tv', 'printer']);
    const deviceId = (req.body as { deviceId?: unknown })?.deviceId ?? null;
    if (deviceId !== null && typeof deviceId !== 'string') throw new HttpError(400, 'bad_request', 'deviceId deve ser um id ou null.');
    if (deviceId) {
      const dev = await one<{ kind: string }>(db, 'SELECT kind FROM managed_devices WHERE id = ? AND company_id = ? AND active = 1', [deviceId, user.companyId]);
      if (!dev) throw new HttpError(404, 'not_found', 'Dispositivo não encontrado.');
      if (obj.asset === 'printer' ? dev.kind !== 'printer' : !TV_KINDS.includes(dev.kind)) throw new HttpError(422, 'wrong_kind', obj.asset === 'printer' ? 'A impressora do mapa só pode ser vinculada a uma impressora do inventário.' : 'A TV só pode ser vinculada a um PC ou a um player de TV.');
    }
    await db.tx(async (tx) => {
      await tx.exec('DELETE FROM object2d_devices WHERE company_id = ? AND office_id = ? AND object_id = ?', [user.companyId, officeId, obj.id]);
      if (deviceId) await tx.exec('INSERT INTO object2d_devices (company_id, office_id, object_id, device_id, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [user.companyId, officeId, obj.id, deviceId, user.id, Date.now()]);
    });
    await audit(db, { user, action: 'office2d.tvDevice', targetType: 'object', targetId: obj.id, result: 'completed', mode: 'real', detail: { deviceId }, correlationId: correlationId(res) });
    res.json({ ok: true, deviceId });
  }));

  r.get('/admin/office2d/:officeId/tiled', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    await loadOffice(db, user, req.params.officeId);
    const which = req.query.which === 'published' ? 'published' : 'draft';
    const row = (await draftRow(user.companyId, req.params.officeId, which)) ?? (await draftRow(user.companyId, req.params.officeId, 'published'));
    const layout: Layout2D = row ? (JSON.parse(row.layout_json) as Layout2D) : defaultLayout2D();
    res.setHeader('Content-Disposition', 'attachment; filename="escritorio-2d.tmj"');
    res.json(layoutToTiled(layout));
  }));
}
