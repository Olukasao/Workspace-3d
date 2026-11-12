import type { Router } from 'express';
import type { AppContext } from '../app';
import { currentUser, requireRole } from '../auth';
import { one } from '../db/driver';
import { HttpError, audit, correlationId, h, newId, str } from '../http';
import { descendants, deskOf, indexObjects, type KindIndex } from '../../shared/scene';
import { allowedUrl, listAssets, loadBindings, loadOffice, loadSeats, objectInOffice, parseScene, publishedScene } from '../office';
import type { ServiceId } from '../providers/types';

const SERVICES: ServiceId[] = ['chat', 'presence', 'remote', 'transfer', 'print'];

export function adminRoutes(r: Router, { db, cfg, integrations, live }: AppContext) {
  // Diretório para busca/seleção: somente dados profissionais mínimos (nome, setor, ramal), sempre da empresa da sessão.
  r.get('/directory', h(async (_req, res) => {
    const user = currentUser(res);
    const rows = await db.query<{ id: string; name: string; department: string; extension: string }>('SELECT id, name, department, extension FROM employees WHERE company_id = ? AND active = 1 ORDER BY name', [user.companyId]);
    res.json({ employees: rows });
  }));

  r.get('/admin/directory', requireRole('admin'), h(async (_req, res) => {
    const user = currentUser(res);
    const rows = await db.query<{ id: string; name: string; department: string; extension: string; active: number; accepts_transfers: number }>('SELECT id, name, department, extension, active, accepts_transfers FROM employees WHERE company_id = ? ORDER BY name', [user.companyId]);
    res.json({ employees: rows.map((e) => ({ id: e.id, name: e.name, department: e.department, extension: e.extension, active: e.active === 1, acceptsTransfers: e.accepts_transfers === 1 })) });
  }));

  r.get('/admin/devices', requireRole('admin'), h(async (_req, res) => {
    const user = currentUser(res);
    const rows = await db.query<{ id: string; name: string; kind: string; location: string | null; remote_provider: string | null; active: number }>('SELECT id, name, kind, location, remote_provider, active FROM managed_devices WHERE company_id = ? ORDER BY name', [user.companyId]);
    res.json({ devices: rows.map((d) => ({ id: d.id, name: d.name, kind: d.kind, location: d.location, remoteProvider: d.remote_provider, active: d.active === 1 })) });
  }));

  // Ativar/desativar colaborador ou dispositivo (simula saída de colaborador / remoção de equipamento => vínculos órfãos).
  r.patch('/admin/employees/:id', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    const active = (req.body as { active?: unknown })?.active === true ? 1 : 0;
    const out = await db.exec('UPDATE employees SET active = ? WHERE id = ? AND company_id = ?', [active, req.params.id, user.companyId]);
    if (!out.affected) throw new HttpError(404, 'not_found', 'Colaborador não encontrado.');
    live.invalidate(user.companyId);
    await audit(db, { user, action: 'employee.set_active', targetType: 'employee', targetId: req.params.id, result: 'completed', mode: 'real', detail: { active: !!active }, correlationId: correlationId(res) });
    res.json({ ok: true });
  }));
  r.patch('/admin/devices/:id', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    const active = (req.body as { active?: unknown })?.active === true ? 1 : 0;
    const out = await db.exec('UPDATE managed_devices SET active = ? WHERE id = ? AND company_id = ?', [active, req.params.id, user.companyId]);
    if (!out.affected) throw new HttpError(404, 'not_found', 'Dispositivo não encontrado.');
    await audit(db, { user, action: 'device.set_active', targetType: 'device', targetId: req.params.id, result: 'completed', mode: 'real', detail: { active: !!active }, correlationId: correlationId(res) });
    res.json({ ok: true });
  }));

  /** Vínculos do mapa com estado explícito: ok, órfão por objeto removido, por colaborador desligado ou por dispositivo removido. */
  r.get('/admin/offices/:id/bindings', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    const office = await loadOffice(db, user, req.params.id);
    const ids = new Set(parseScene(office.draft_json).objects.map((o) => o.id));
    const published = await publishedScene(db, office);
    const publishedIds = new Set(published?.doc.objects.map((o) => o.id) ?? []);
    const place = (objectId: string) => (ids.has(objectId) ? (publishedIds.has(objectId) ? 'ok' : 'draft_only') : publishedIds.has(objectId) ? 'removed_in_draft' : 'object_missing');
    const seats = (await loadSeats(db, user.companyId, req.params.id)).map((s) => ({
      objectId: s.object_id, employeeId: s.employee_id, employeeName: s.name, department: s.department,
      state: place(s.object_id) === 'object_missing' ? 'orphan_object' : !s.name || s.active !== 1 ? 'orphan_employee' : 'ok', objectState: place(s.object_id),
    }));
    const bindings = (await loadBindings(db, user.companyId, req.params.id)).map((b) => ({
      objectId: b.object_id, type: b.binding_type, deviceId: b.device_id, deviceName: b.device_name, config: b.config_json ? (JSON.parse(b.config_json) as Record<string, unknown>) : null,
      state: place(b.object_id) === 'object_missing' ? 'orphan_object' : b.binding_type === 'device' && (!b.device_name || b.device_active !== 1) ? 'orphan_device' : 'ok', objectState: place(b.object_id),
    }));
    res.json({ seats, bindings });
  }));

  /**
   * Mesa ↔ colaborador (employeeId null deixa a mesa vaga). O vínculo é da MESA: é a posição fixa do colaborador.
   * Pedido feito num computador que está sobre uma mesa vai para a mesa. Computador avulso (sem mesa) ainda aceita vínculo direto.
   */
  r.put('/admin/offices/:id/seats/:objectId', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    const { id: officeId } = req.params;
    let objectId = req.params.objectId;
    const employeeId = (req.body as { employeeId?: unknown })?.employeeId;
    const obj = await objectInOffice(db, user, officeId, objectId);
    // cena onde o objeto está (rascunho, senão publicada) para achar a mesa e os computadores sobre ela
    const office = await loadOffice(db, user, officeId);
    const draftDoc = parseScene(office.draft_json);
    const doc = draftDoc.objects.some((o) => o.id === objectId) ? draftDoc : ((await publishedScene(db, office))?.doc ?? draftDoc);
    const kinds: KindIndex = Object.fromEntries((await listAssets(db, user.companyId)).map((a) => [a.id, { defaultKind: a.defaultKind, category: a.category }]));
    const byId = indexObjects(doc);
    const desk = obj ? deskOf(byId, obj.id, kinds) : null;
    if (desk) objectId = desk.id;
    // vínculos antigos feitos direto nos computadores sobre esta mesa saem (uma pessoa por mesa)
    const onDesk = desk ? descendants(doc, desk.id).filter((d) => d.kind === 'workstation').map((d) => d.id) : [];
    const clearIds = [objectId, ...onDesk];
    const marks = clearIds.map(() => '?').join(', ');
    if (employeeId === null) {
      await db.exec(`DELETE FROM seat_assignments WHERE company_id = ? AND office_id = ? AND object_id IN (${marks})`, [user.companyId, officeId, ...clearIds]);
    } else {
      if (!obj) throw new HttpError(409, 'object_not_saved', 'Grave o rascunho antes de vincular este objeto.');
      if (!desk && obj.kind !== 'workstation') throw new HttpError(422, 'wrong_kind', 'Só mesas de trabalho (ou computadores avulsos) recebem colaborador.');
      const emp = typeof employeeId === 'string' ? await one<{ id: string }>(db, 'SELECT id FROM employees WHERE id = ? AND company_id = ? AND active = 1', [employeeId, user.companyId]) : null;
      if (!emp) throw new HttpError(404, 'not_found', 'Colaborador não encontrado no diretório da empresa.');
      // um colaborador ocupa um posto por mapa: mover de posto libera o anterior
      await db.tx(async (tx) => {
        await tx.exec(`DELETE FROM seat_assignments WHERE company_id = ? AND office_id = ? AND (object_id IN (${marks}) OR employee_id = ?)`, [user.companyId, officeId, ...clearIds, emp.id]);
        await tx.exec('INSERT INTO seat_assignments (id, company_id, office_id, object_id, employee_id, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [newId('seat'), user.companyId, officeId, objectId, emp.id, user.id, Date.now()]);
      });
    }
    live.invalidate(user.companyId);
    await audit(db, { user, action: 'seat.assign', targetType: 'employee', targetId: typeof employeeId === 'string' ? employeeId : '-', objectId, result: 'completed', mode: 'real', correlationId: correlationId(res) });
    res.json({ ok: true, objectId, desk: desk ? { id: desk.id, name: desk.name } : null });
  }));

  // Objeto ↔ dispositivo / painel / link de CAD. Corpo: { type, deviceId? , name?, url? } ou { type, remove: true }.
  r.put('/admin/offices/:id/bindings/:objectId', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    const { id: officeId, objectId } = req.params;
    const body = (req.body ?? {}) as { type?: unknown; deviceId?: unknown; name?: unknown; url?: unknown; remove?: unknown };
    const type = body.type === 'device' || body.type === 'dashboard' || body.type === 'cad_link' ? body.type : null;
    if (!type) throw new HttpError(400, 'bad_request', 'Tipo de vínculo inválido.');
    if (body.remove === true) {
      await db.exec('DELETE FROM integration_bindings WHERE company_id = ? AND office_id = ? AND object_id = ? AND binding_type = ?', [user.companyId, officeId, objectId, type]);
    } else {
      const obj = await objectInOffice(db, user, officeId, objectId);
      if (!obj) throw new HttpError(409, 'object_not_saved', 'Grave o rascunho antes de vincular este objeto.');
      let deviceId: string | null = null;
      let config: string | null = null;
      if (type === 'device') {
        if (!['workstation', 'printer', 'tv'].includes(obj.kind)) throw new HttpError(422, 'wrong_kind', 'Este tipo de objeto não recebe dispositivo.');
        const dev = typeof body.deviceId === 'string' ? await one<{ id: string; kind: string }>(db, 'SELECT id, kind FROM managed_devices WHERE id = ? AND company_id = ? AND active = 1', [body.deviceId, user.companyId]) : null;
        if (!dev) throw new HttpError(404, 'not_found', 'Dispositivo não encontrado no inventário da empresa.');
        const expected = obj.kind === 'printer' ? ['printer'] : obj.kind === 'tv' ? ['tv_player', 'pc'] : ['pc'];
        if (!expected.includes(dev.kind)) throw new HttpError(422, 'wrong_device_kind', 'O tipo do dispositivo não combina com este objeto.');
        deviceId = dev.id;
      } else {
        const name = str(body.name, 120);
        const hosts = type === 'dashboard' ? cfg.dashboardAllowedHosts : cfg.cadAllowedHosts;
        const url = allowedUrl(body.url, hosts, type === 'dashboard' && cfg.demoMode);
        if (type === 'dashboard' && obj.kind !== 'tv') throw new HttpError(422, 'wrong_kind', 'Painéis só podem ser associados a TVs.');
        if (!name) throw new HttpError(400, 'bad_request', 'Informe um nome para o painel ou link.');
        if (!url) throw new HttpError(422, 'url_not_allowed', type === 'dashboard' ? 'Endereço não autorizado. Use um caminho /demo/… ou um host https listado em DASHBOARD_ALLOWED_HOSTS.' : 'Endereço não autorizado. Use um host https listado em CAD_ALLOWED_HOSTS.');
        config = JSON.stringify({ name, url });
      }
      await db.tx(async (tx) => {
        await tx.exec('DELETE FROM integration_bindings WHERE company_id = ? AND office_id = ? AND object_id = ? AND binding_type = ?', [user.companyId, officeId, objectId, type]);
        await tx.exec('INSERT INTO integration_bindings (id, company_id, office_id, object_id, binding_type, device_id, config_json, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [newId('bnd'), user.companyId, officeId, objectId, type, deviceId, config, user.id, Date.now()]);
      });
    }
    await audit(db, { user, action: `binding.${type}`, targetType: 'object', targetId: objectId, objectId, result: body.remove === true ? 'removed' : 'completed', mode: 'real', correlationId: correlationId(res) });
    res.json({ ok: true });
  }));

  r.get('/admin/audit', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
    const rows = await db.query<{ id: string; name: string | null; actor_role: string; action: string; target_type: string; target_id: string; object_id: string | null; result: string; mode: string; correlation_id: string; created_at: number; detail_json: string | null }>(
      `SELECT a.id, u.name, a.actor_role, a.action, a.target_type, a.target_id, a.object_id, a.result, a.mode, a.correlation_id, a.created_at, a.detail_json
         FROM action_audit a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.company_id = ? ORDER BY a.created_at DESC LIMIT ${limit}`,
      [user.companyId],
    );
    res.json({
      entries: rows.map((a) => ({ id: a.id, actorName: a.name ?? '—', actorRole: a.actor_role, action: a.action, targetType: a.target_type, targetId: a.target_id, objectId: a.object_id, result: a.result, mode: a.mode, correlationId: a.correlation_id, createdAt: Number(a.created_at), detail: a.detail_json ? (JSON.parse(a.detail_json) as Record<string, unknown>) : undefined })),
    });
  }));

  // Falha simulada de um conector — só existe no modo demonstração.
  r.post('/demo/outage', requireRole('admin'), h(async (req, res) => {
    if (!cfg.demoMode) throw new HttpError(404, 'not_found', 'Disponível apenas no modo demonstração.');
    const { service, down } = (req.body ?? {}) as { service?: unknown; down?: unknown };
    if (!SERVICES.includes(service as ServiceId)) throw new HttpError(400, 'bad_request', 'Serviço desconhecido.');
    if (down === true) integrations.outages.add(service as ServiceId);
    else integrations.outages.delete(service as ServiceId);
    await audit(db, { user: currentUser(res), action: 'demo.outage', targetType: 'integration', targetId: String(service), result: down === true ? 'down' : 'up', mode: 'demo', correlationId: correlationId(res) });
    res.json({ integrations: integrations.status() });
  }));
}
