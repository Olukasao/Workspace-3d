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
 * - GET  /api/admin/office2d/:officeId/tiled             exporta o layout no formato JSON do Tiled
 */
import type { Router } from 'express';
import { WORKSPACE_MODES, isWorkspaceMode } from '../../shared/workspace';
import { DIRS, layoutToTiled, validateLayout, type Layout2D } from '../../shared/office2d';
import { defaultLayout2D } from '../../shared/office2dDefault';
import type { AppContext } from '../app';
import { currentUser, requireRole } from '../auth';
import { one } from '../db/driver';
import { HttpError, audit, correlationId, h } from '../http';
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
