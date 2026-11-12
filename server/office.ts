/**
 * Regras de domínio do mapa: rascunho × publicação, catálogo, vínculos e a visão operacional
 * (o que cada perfil pode ver e acionar em cada objeto). Toda consulta leva o company_id da sessão.
 */
import { deskOf, indexObjects, isDesk, roomAt, seatWorld, validateScene, worldTransform, type AssetIndex, type KindIndex } from '../shared/scene';
import type { ActionId, ActionState, AssetDefinition, EmployeePublic, IntegrationStatus, OfficeInfo, OperationalObject, OperationalView, SceneDoc, SceneObject, SessionUser } from '../shared/types';
import { one, type Db } from './db/driver';
import { HttpError, newId } from './http';
import type { Integrations } from './providers';

interface OfficeRow {
  id: string;
  company_id: string;
  floor_id: string;
  name: string;
  draft_json: string;
  draft_version: number;
  draft_updated_by: string | null;
  draft_updated_at: number;
  published_revision_id: string | null;
  building_id: string;
  building_name: string;
  floor_name: string;
  floor_level: number;
}

const OFFICE_SELECT = `SELECT o.id, o.company_id, o.floor_id, o.name, o.draft_json, o.draft_version, o.draft_updated_by, o.draft_updated_at, o.published_revision_id,
       b.id AS building_id, b.name AS building_name, f.name AS floor_name, f.level AS floor_level
  FROM offices o JOIN floors f ON f.id = o.floor_id JOIN buildings b ON b.id = f.building_id`;

/** Mapa da empresa do usuário. Um ID de outra empresa responde 404 (não revela que existe). */
export async function loadOffice(db: Db, user: SessionUser, officeId: string): Promise<OfficeRow> {
  const row = await one<OfficeRow>(db, `${OFFICE_SELECT} WHERE o.id = ? AND o.company_id = ?`, [officeId, user.companyId]);
  if (!row) throw new HttpError(404, 'not_found', 'Mapa não encontrado.');
  return row;
}

export async function listOffices(db: Db, user: SessionUser): Promise<OfficeInfo[]> {
  const rows = await db.query<OfficeRow>(`${OFFICE_SELECT} WHERE o.company_id = ? ORDER BY b.name, f.level`, [user.companyId]);
  return Promise.all(rows.map((r) => officeInfo(db, r)));
}

export async function officeInfo(db: Db, o: OfficeRow): Promise<OfficeInfo> {
  const rev = o.published_revision_id
    ? await one<{ id: string; rev_number: number; published_at: number; name: string | null }>(db, 'SELECT r.id, r.rev_number, r.published_at, u.name FROM office_revisions r LEFT JOIN users u ON u.id = r.published_by WHERE r.id = ? AND r.company_id = ?', [o.published_revision_id, o.company_id])
    : null;
  return {
    id: o.id,
    name: o.name,
    companyId: o.company_id,
    building: { id: o.building_id, name: o.building_name },
    floor: { id: o.floor_id, name: o.floor_name, level: Number(o.floor_level) },
    draftVersion: Number(o.draft_version),
    publishedRevision: rev ? { id: rev.id, number: Number(rev.rev_number), publishedAt: Number(rev.published_at), publishedBy: rev.name ?? '—' } : null,
  };
}

interface AssetRow {
  id: string; company_id: string | null; slug: string; name: string; category: string; default_kind: string; mount: string; pivot: string; file_url: string; thumb_url: string | null; file_hash: string; file_bytes: number;
  width_m: number; depth_m: number; height_m: number; surface_height_m: number | null; triangles: number; license: string; author: string; source_url: string; attribution: string; origin: string; version: number; status: string;
}

const toAsset = (r: AssetRow): AssetDefinition => ({
  id: r.id, companyId: r.company_id, slug: r.slug, name: r.name, category: r.category, defaultKind: r.default_kind as AssetDefinition['defaultKind'], mount: r.mount as AssetDefinition['mount'], url: r.file_url, thumbUrl: r.thumb_url,
  fileHash: r.file_hash, fileBytes: Number(r.file_bytes), width: Number(r.width_m), depth: Number(r.depth_m), height: Number(r.height_m), surfaceHeight: r.surface_height_m === null ? null : Number(r.surface_height_m),
  pivot: r.pivot as AssetDefinition['pivot'], triangles: Number(r.triangles), license: r.license, author: r.author, sourceUrl: r.source_url, attribution: r.attribution, origin: r.origin as AssetDefinition['origin'], version: Number(r.version), status: r.status as AssetDefinition['status'],
});

/** Catálogo visível para a empresa: aprovados globais + uploads da própria empresa. */
export async function listAssets(db: Db, companyId: string): Promise<AssetDefinition[]> {
  const rows = await db.query<AssetRow>("SELECT * FROM asset_definitions WHERE (company_id IS NULL OR company_id = ?) AND status = 'approved' ORDER BY category, name", [companyId]);
  return rows.map(toAsset);
}

export async function assetIndex(db: Db, companyId: string): Promise<AssetIndex> {
  return Object.fromEntries((await listAssets(db, companyId)).map((a) => [a.id, a]));
}

export function parseScene(json: string): SceneDoc {
  return JSON.parse(json) as SceneDoc;
}

/** Grava o rascunho se a versão-base ainda for a atual. Caso contrário, conflito (outro editor gravou antes). */
export async function saveDraft(db: Db, user: SessionUser, officeId: string, doc: unknown, baseVersion: number): Promise<{ version: number; updatedAt: number }> {
  const office = await loadOffice(db, user, officeId);
  const errors = validateScene(doc, await assetIndex(db, user.companyId), office.floor_id);
  if (errors.length) throw new HttpError(422, 'invalid_scene', 'A cena tem problemas e não foi gravada.', { details: errors.slice(0, 20) });
  const now = Date.now();
  const res = await db.exec('UPDATE offices SET draft_json = ?, draft_version = draft_version + 1, draft_updated_by = ?, draft_updated_at = ? WHERE id = ? AND company_id = ? AND draft_version = ?', [JSON.stringify(doc), user.id, now, officeId, user.companyId, baseVersion]);
  if (!res.affected) await throwConflict(db, user, officeId);
  return { version: baseVersion + 1, updatedAt: now };
}

async function throwConflict(db: Db, user: SessionUser, officeId: string): Promise<never> {
  const cur = await one<{ draft_version: number; draft_updated_at: number; name: string | null }>(db, 'SELECT o.draft_version, o.draft_updated_at, u.name FROM offices o LEFT JOIN users u ON u.id = o.draft_updated_by WHERE o.id = ? AND o.company_id = ?', [officeId, user.companyId]);
  throw new HttpError(409, 'draft_conflict', 'Outra pessoa gravou este mapa depois que você o abriu. Recarregue para ver a versão atual antes de gravar de novo.', {
    currentVersion: Number(cur?.draft_version ?? 0),
    updatedBy: cur?.name ?? null,
    updatedAt: Number(cur?.draft_updated_at ?? 0),
  });
}

/**
 * Publica o rascunho gravado, de forma atômica: dentro de uma transação, confere a versão, cria a revisão imutável
 * e aponta o mapa para ela. Operadores passam a ver a nova revisão; se algo falhar, nada muda.
 */
export async function publish(db: Db, user: SessionUser, officeId: string, baseVersion: number, note: string | null): Promise<{ revisionId: string; number: number; publishedAt: number }> {
  await loadOffice(db, user, officeId);
  const assets = await assetIndex(db, user.companyId);
  return db.tx(async (tx) => {
    const revisionId = newId('rev');
    const now = Date.now();
    // a checagem de versão e a troca do ponteiro são uma única instrução: dois publicadores não passam juntos
    const upd = await tx.exec('UPDATE offices SET published_revision_id = ? WHERE id = ? AND company_id = ? AND draft_version = ?', [revisionId, officeId, user.companyId, baseVersion]);
    if (!upd.affected) await throwConflict(tx, user, officeId);
    const office = await one<{ draft_json: string; floor_id: string }>(tx, 'SELECT draft_json, floor_id FROM offices WHERE id = ? AND company_id = ?', [officeId, user.companyId]);
    const errors = validateScene(parseScene(office!.draft_json), assets, office!.floor_id);
    if (errors.length) throw new HttpError(422, 'invalid_scene', 'O rascunho tem problemas e não pode ser publicado.', { details: errors.slice(0, 20) });
    const last = await one<{ n: number | null }>(tx, 'SELECT MAX(rev_number) AS n FROM office_revisions WHERE office_id = ?', [officeId]);
    const number = Number(last?.n ?? 0) + 1;
    await tx.exec('INSERT INTO office_revisions (id, company_id, office_id, rev_number, scene_json, draft_version, note, published_by, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [revisionId, user.companyId, officeId, number, office!.draft_json, baseVersion, note, user.id, now]);
    return { revisionId, number, publishedAt: now };
  });
}

export async function publishedScene(db: Db, office: Pick<OfficeRow, 'published_revision_id' | 'company_id'>): Promise<{ id: string; number: number; publishedAt: number; doc: SceneDoc } | null> {
  if (!office.published_revision_id) return null;
  const r = await one<{ id: string; rev_number: number; published_at: number; scene_json: string }>(db, 'SELECT id, rev_number, published_at, scene_json FROM office_revisions WHERE id = ? AND company_id = ?', [office.published_revision_id, office.company_id]);
  return r ? { id: r.id, number: Number(r.rev_number), publishedAt: Number(r.published_at), doc: parseScene(r.scene_json) } : null;
}

// ---------- vínculos ----------

export interface SeatRow {
  object_id: string;
  employee_id: string;
  name: string | null;
  department: string | null;
  extension: string | null;
  active: number | null;
  accepts_transfers: number | null;
}

export interface BindingRow {
  object_id: string;
  binding_type: 'device' | 'dashboard' | 'cad_link';
  device_id: string | null;
  config_json: string | null;
  device_name: string | null;
  device_kind: string | null;
  device_location: string | null;
  device_active: number | null;
  remote_provider: string | null;
  remote_address: string | null;
}

export async function loadSeats(db: Db, companyId: string, officeId: string): Promise<SeatRow[]> {
  return db.query<SeatRow>(
    'SELECT s.object_id, s.employee_id, e.name, e.department, e.extension, e.active, e.accepts_transfers FROM seat_assignments s LEFT JOIN employees e ON e.id = s.employee_id AND e.company_id = s.company_id WHERE s.company_id = ? AND s.office_id = ?',
    [companyId, officeId],
  );
}

export async function loadBindings(db: Db, companyId: string, officeId: string): Promise<BindingRow[]> {
  return db.query<BindingRow>(
    `SELECT b.object_id, b.binding_type, b.device_id, b.config_json, d.name AS device_name, d.kind AS device_kind, d.location AS device_location, d.active AS device_active, d.remote_provider, d.remote_address
       FROM integration_bindings b LEFT JOIN managed_devices d ON d.id = b.device_id AND d.company_id = b.company_id WHERE b.company_id = ? AND b.office_id = ?`,
    [companyId, officeId],
  );
}

/** Painel/links só abrem se forem caminho local de demonstração ou https de host autorizado no servidor. */
export function allowedUrl(url: unknown, allowedHosts: string[], allowLocalDemo: boolean): string | null {
  if (typeof url !== 'string' || url.length > 500) return null;
  if (allowLocalDemo && /^\/demo\/[A-Za-z0-9._\-/?=&%]*$/.test(url) && !url.includes('..')) return url;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return allowedHosts.includes(u.hostname.toLowerCase()) ? u.toString() : null;
  } catch {
    return null;
  }
}

const ACTIONS_BY_KIND: Record<string, ActionId[]> = {
  desk: ['chat', 'transfer'],
  workstation: ['chat', 'remote', 'transfer'],
  printer: ['print', 'printQueue'],
  tv: ['dashboard', 'remote'],
};

/**
 * Visão operacional da última revisão PUBLICADA: cena + estado de cada objeto acionável para o usuário atual.
 * Os estados (disponível, não configurado, sem permissão, indisponível) são decididos aqui, no servidor.
 */
export async function operationalView(db: Db, user: SessionUser, officeId: string, integrations: Integrations): Promise<OperationalView> {
  const office = await loadOffice(db, user, officeId);
  const info = await officeInfo(db, office);
  const statuses: IntegrationStatus[] = integrations.status();
  const published = await publishedScene(db, office);
  if (!published) return { office: info, revision: null, doc: null, objects: {}, integrations: statuses };

  const [seats, bindings, grants, catalog] = await Promise.all([
    loadSeats(db, user.companyId, officeId),
    loadBindings(db, user.companyId, officeId),
    db.query<{ device_id: string }>('SELECT device_id FROM remote_access_grants WHERE user_id = ? AND company_id = ?', [user.id, user.companyId]),
    listAssets(db, user.companyId),
  ]);
  const kinds: KindIndex = Object.fromEntries(catalog.map((a) => [a.id, { defaultKind: a.defaultKind, category: a.category }]));
  const seatByObject = new Map(seats.map((s) => [s.object_id, s]));
  const bindingsByObject = new Map<string, BindingRow[]>();
  for (const b of bindings) bindingsByObject.set(b.object_id, [...(bindingsByObject.get(b.object_id) ?? []), b]);
  const granted = new Set(grants.map((g) => g.device_id));

  // presença: só para quem pode acionar (operador/administrador); falha do provedor não derruba o mapa
  const canAct = user.role !== 'viewer';
  let presence: Record<string, string> | null = null;
  let presenceDown = false;
  if (canAct) {
    try {
      integrations.ensureUp('presence');
      if (integrations.presence.configured) presence = await integrations.presence.presence(user.companyId, seats.filter((s) => s.active === 1).map((s) => s.employee_id));
    } catch {
      presenceDown = true;
    }
  }

  const byId = indexObjects(published.doc);
  const objects: Record<string, OperationalObject> = {};
  // Ocupante: o vínculo é da MESA (posição fixa). O computador sobre a mesa herda o ocupante dela.
  // Vínculos antigos feitos direto no computador continuam valendo (a mesa herda deles se não tiver o próprio).
  const deskSeat = new Map<string, SeatRow>();
  for (const o of published.doc.objects) {
    if (!isDesk(o, kinds)) continue;
    const own = seatByObject.get(o.id);
    const legacy = own ? undefined : published.doc.objects.find((c) => c.kind === 'workstation' && seatByObject.has(c.id) && deskOf(byId, c.id, kinds)?.id === o.id);
    const row = own ?? (legacy ? seatByObject.get(legacy.id) : undefined);
    if (row) deskSeat.set(o.id, row);
  }
  const seatOf = (o: SceneObject): { row?: SeatRow; desk: SceneObject | null } => {
    const desk = deskOf(byId, o.id, kinds);
    if (o.kind === 'workstation' && seatByObject.has(o.id)) return { row: seatByObject.get(o.id), desk };
    return { row: desk ? deskSeat.get(desk.id) : undefined, desk };
  };
  const st = (id: ActionId): ActionState['mode'] => {
    const svc = id === 'printQueue' ? 'print' : id === 'dashboard' || id === 'cad' ? null : id === 'print' ? null : id;
    return svc ? integrations.get(svc).mode : 'real';
  };
  for (const o of published.doc.objects) {
    if (o.kind === 'wall' || o.kind === 'opening') continue;
    const wt = worldTransform(byId, o.id);
    const room = o.kind === 'room' ? null : roomAt(published.doc, wt.x, wt.z);
    const desk = isDesk(o, kinds);
    const out: OperationalObject = { objectId: o.id, kind: desk ? 'desk' : o.kind, name: o.name, roomId: room?.id ?? null, actions: {} };
    const objBindings = bindingsByObject.get(o.id) ?? [];
    const deviceBinding = objBindings.find((b) => b.binding_type === 'device');
    const dashboard = objBindings.find((b) => b.binding_type === 'dashboard');
    const cad = objBindings.find((b) => b.binding_type === 'cad_link');

    const occ = desk || o.kind === 'workstation' ? seatOf(o) : null;
    if (occ) {
      const seat = occ.row;
      if (occ.desk) {
        const p = seatWorld(byId, occ.desk, kinds);
        out.seatPosition = { deskId: occ.desk.id, deskName: occ.desk.name, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, rotY: p.rotY };
      }
      if (!seat) out.seat = { state: 'vacant' };
      else if (!seat.name || seat.active !== 1) out.seat = { state: 'orphan', note: seat.name ? 'O colaborador vinculado a esta mesa não está mais ativo no diretório.' : 'O colaborador vinculado a esta mesa não existe mais no diretório.' };
      else {
        const employee: EmployeePublic = { id: seat.employee_id, name: seat.name, department: seat.department ?? '', extension: seat.extension ?? '' };
        out.seat = { state: 'occupied', employee };
        if (canAct) out.presence = presenceDown || !presence ? { state: 'unknown', mode: integrations.presence.mode } : { state: (presence[seat.employee_id] ?? 'offline') as 'available', mode: integrations.presence.mode };
      }
    }
    if (o.kind === 'workstation' || o.kind === 'printer' || o.kind === 'tv') {
      if (!deviceBinding) out.device = { state: 'none' };
      else if (!deviceBinding.device_name || deviceBinding.device_active !== 1) out.device = { state: 'orphan', id: deviceBinding.device_id ?? undefined, name: deviceBinding.device_name ?? undefined };
      else out.device = { state: 'linked', id: deviceBinding.device_id!, name: deviceBinding.device_name, deviceKind: deviceBinding.device_kind ?? undefined, location: deviceBinding.device_location ?? undefined };
    }
    if (o.kind === 'tv') {
      const cfg = dashboard?.config_json ? (JSON.parse(dashboard.config_json) as { name?: string; url?: string }) : null;
      out.dashboard = cfg?.name ? { name: cfg.name } : null;
    }

    const actionIds = [...(ACTIONS_BY_KIND[out.kind] ?? []), ...(cad ? (['cad'] as ActionId[]) : [])];
    for (const id of actionIds) out.actions[id] = actionState(id, { user, o, out, seat: occ?.row, deviceBinding, dashboard, cad, granted, integrations, mode: st(id) });
    objects[o.id] = out;
  }
  return { office: info, revision: { id: published.id, number: published.number, publishedAt: published.publishedAt }, doc: published.doc, objects, integrations: statuses };
}

interface ActionCtx {
  user: SessionUser;
  o: SceneObject;
  out: OperationalObject;
  seat?: SeatRow;
  deviceBinding?: BindingRow;
  dashboard?: BindingRow;
  cad?: BindingRow;
  granted: Set<string>;
  integrations: Integrations;
  mode: 'demo' | 'real';
}

/** Estado de uma ação para o usuário. A mesma função é reaplicada quando a ação é executada (nunca se confia no cliente). */
export function actionState(id: ActionId, c: ActionCtx): ActionState {
  const { user, out, integrations, mode } = c;
  const no = (state: ActionState['state'], reason: string): ActionState => ({ state, reason, mode });
  if (user.role === 'viewer') return no('forbidden', 'O perfil de visualizador não executa ações.');
  const service = id === 'printQueue' ? 'print' : id === 'chat' || id === 'remote' || id === 'transfer' ? id : null;
  const provider = service ? integrations.get(service) : null;

  if (id === 'chat' || id === 'transfer') {
    if (out.seat?.state === 'vacant') return no('not_configured', 'Mesa vaga: não há colaborador vinculado a esta mesa.');
    if (out.seat?.state === 'orphan') return no('not_configured', out.seat.note ?? 'Vínculo de colaborador órfão.');
    if (out.seat?.employee?.id === user.employeeId) return no('forbidden', 'Esta é a sua própria mesa.');
    if (id === 'transfer' && c.seat?.accepts_transfers !== 1) return no('forbidden', 'Este colaborador não recebe transferências de atendimento.');
  }
  if (id === 'remote') {
    if (out.device?.state === 'none') return no('not_configured', 'Nenhum dispositivo gerenciado vinculado a este objeto.');
    if (out.device?.state === 'orphan') return no('not_configured', 'O dispositivo vinculado foi removido do inventário.');
    if (!c.deviceBinding?.remote_provider || !c.deviceBinding.remote_address) return no('not_configured', 'O dispositivo não tem acesso remoto cadastrado.');
    if (user.role !== 'admin' && !c.granted.has(c.deviceBinding.device_id ?? '')) return no('forbidden', 'Você não tem permissão de acesso remoto para este dispositivo.');
  }
  if (id === 'printQueue') {
    if (out.device?.state !== 'linked' || c.deviceBinding?.device_kind !== 'printer') return no('not_configured', out.device?.state === 'orphan' ? 'A impressora vinculada foi removida do inventário.' : 'Nenhuma impressora cadastrada vinculada a este objeto.');
  }
  if (id === 'dashboard') {
    const cfg = c.dashboard?.config_json ? (JSON.parse(c.dashboard.config_json) as { url?: string }) : null;
    if (!cfg?.url) return no('not_configured', 'Nenhum painel associado a esta TV.');
    if (!allowedUrl(cfg.url, integrations.cfg.dashboardAllowedHosts, integrations.cfg.demoMode)) return no('forbidden', 'O endereço do painel não está na lista autorizada pelo servidor.');
    return { state: 'available', mode: cfg.url.startsWith('/demo/') ? 'demo' : 'real' };
  }
  if (id === 'cad') {
    const cfg = c.cad?.config_json ? (JSON.parse(c.cad.config_json) as { url?: string }) : null;
    if (!cfg?.url) return no('not_configured', 'Nenhum link de projeto associado.');
    if (!allowedUrl(cfg.url, integrations.cfg.cadAllowedHosts, false)) return no('not_configured', 'Integração a confirmar: o host do link não está autorizado (CAD_ALLOWED_HOSTS).');
    return { state: 'available', mode: 'real' };
  }
  if (provider && service) {
    if (!provider.configured) return no('not_configured', provider.detail ?? 'Integração não configurada.');
    if (integrations.isDown(service)) return no('unavailable', 'Serviço indisponível no momento. O mapa continua funcionando.');
  }
  return { state: 'available', mode };
}

/** Recalcula o estado de UMA ação no momento da execução e recusa se não estiver disponível. */
export async function requireAction(db: Db, user: SessionUser, officeId: string, objectId: string, action: ActionId, integrations: Integrations): Promise<{ view: OperationalView; object: OperationalObject; seat?: SeatRow; bindings: BindingRow[] }> {
  const view = await operationalView(db, user, officeId, integrations);
  const object = view.objects[objectId];
  if (!object) throw new HttpError(404, 'not_found', 'Objeto não encontrado na revisão publicada.');
  const state = object.actions[action];
  if (!state) throw new HttpError(400, 'unsupported_action', 'Este tipo de objeto não oferece essa ação.');
  if (state.state === 'forbidden') throw new HttpError(403, 'forbidden', state.reason ?? 'Sem permissão.');
  if (state.state === 'not_configured') throw new HttpError(409, 'not_configured', state.reason ?? 'Não configurado.');
  if (state.state === 'unavailable') throw new HttpError(503, 'provider_unavailable', state.reason ?? 'Serviço indisponível.');
  const seats = await loadSeats(db, user.companyId, officeId);
  const bindings = (await loadBindings(db, user.companyId, officeId)).filter((b) => b.object_id === objectId);
  return { view, object, seat: seats.find((s) => s.object_id === objectId), bindings };
}

/** O objeto existe no rascunho ou na revisão publicada deste mapa? (vínculos só para objetos reais) */
export async function objectInOffice(db: Db, user: SessionUser, officeId: string, objectId: string): Promise<SceneObject | null> {
  const office = await loadOffice(db, user, officeId);
  const draft = parseScene(office.draft_json).objects.find((o) => o.id === objectId);
  if (draft) return draft;
  const pub = await publishedScene(db, office);
  return pub?.doc.objects.find((o) => o.id === objectId) ?? null;
}
