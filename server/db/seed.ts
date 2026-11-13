/**
 * Dados de demonstração (todos fictícios): duas empresas, uma conta por perfil, diretório, dispositivos,
 * cena inicial publicada, vínculos e atendimentos simulados. Idempotente: não duplica se já houver dados.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildSeedScene } from '../../shared/seedScene';
import { hashPassword } from '../auth';
import { ROOT } from '../config';
import { one, type Db } from './driver';

export const DEMO_PASSWORD = 'demo1234';

export const DEMO_ACCOUNTS = [
  { email: 'admin@demo.office3d.local', role: 'admin', label: 'Administrador', name: 'Aline Duarte (demo)' },
  { email: 'operador@demo.office3d.local', role: 'operator', label: 'Operador', name: 'Otávio Lima (demo)' },
  { email: 'visualizador@demo.office3d.local', role: 'viewer', label: 'Visualizador', name: 'Vera Antunes (demo)' },
  { email: 'admin@outra.office3d.local', role: 'admin', label: 'Administrador de outra empresa', name: 'Rui Camargo (demo)' },
] as const;

interface ManifestModel {
  id: string; slug: string; name: string; category: string; kind: string; mount: string; pivot: string; url: string; thumb: string; sha256: string; bytes: number; triangles: number;
  dimensions: { width: number; depth: number; height: number }; surfaceHeight: number | null; license: string; author: string; sourceUrl: string; attribution: string; origin: string; version: number;
}

/** Sincroniza o catálogo global aprovado a partir do manifesto distribuído (public/assets/manifest.json). */
export async function syncCatalog(db: Db): Promise<number> {
  const file = path.join(ROOT, 'public/assets/manifest.json');
  if (!existsSync(file)) return 0;
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as { models: ManifestModel[] };
  const now = Date.now();
  for (const m of manifest.models) {
    const thumb = existsSync(path.join(ROOT, 'public', m.thumb)) ? m.thumb : null;
    const values = [m.slug, m.name, m.category, m.kind, m.mount, m.pivot, m.url, thumb, m.sha256, m.bytes, m.dimensions.width, m.dimensions.depth, m.dimensions.height, m.surfaceHeight, m.triangles, m.license, m.author, m.sourceUrl, m.attribution, m.origin, m.version];
    const updated = await db.exec(
      `UPDATE asset_definitions SET slug = ?, name = ?, category = ?, default_kind = ?, mount = ?, pivot = ?, file_url = ?, thumb_url = ?, file_hash = ?, file_bytes = ?, width_m = ?, depth_m = ?, height_m = ?, surface_height_m = ?,
              triangles = ?, license = ?, author = ?, source_url = ?, attribution = ?, origin = ?, version = ? WHERE id = ? AND company_id IS NULL`,
      [...values, m.id],
    );
    if (!updated.affected) {
      await db.exec(
        `INSERT INTO asset_definitions (slug, name, category, default_kind, mount, pivot, file_url, thumb_url, file_hash, file_bytes, width_m, depth_m, height_m, surface_height_m, triangles, license, author, source_url, attribution, origin, version, id, company_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'approved', ?)`,
        [...values, m.id, now],
      );
    }
  }
  return manifest.models.length;
}

export async function seed(db: Db): Promise<{ created: boolean }> {
  await syncCatalog(db);
  if (await one(db, 'SELECT id FROM companies LIMIT 1')) return { created: false };
  const now = Date.now();
  const ACME = 'co_acme';
  const OUTRA = 'co_outra';
  await db.exec('INSERT INTO companies (id, name) VALUES (?, ?)', [ACME, 'Acme Telecom (demonstração)']);
  await db.exec('INSERT INTO companies (id, name) VALUES (?, ?)', [OUTRA, 'Outra Empresa (demonstração)']);

  // ---- diretório (dados profissionais mínimos: nome, setor, ramal) ----
  const employees: Array<[string, string, string, string, number, number]> = [
    ['emp_ana', 'Ana Ribeiro', 'Atendimento', '2101', 1, 1],
    ['emp_bruno', 'Bruno Tavares', 'Atendimento', '2102', 1, 1],
    ['emp_carla', 'Carla Nogueira', 'Atendimento', '2103', 1, 1],
    ['emp_diego', 'Diego Farias', 'Atendimento', '2104', 0, 1],
    ['emp_otavio', 'Otávio Lima', 'Atendimento', '2105', 1, 1],
    ['emp_helena', 'Helena Prado', 'Recepção', '2000', 1, 1],
    ['emp_igor', 'Igor Sampaio', 'Operações de rede', '2301', 1, 1],
    ['emp_marcos', 'Marcos Leal', 'Operações de rede', '2302', 1, 0],
    ['emp_aline', 'Aline Duarte', 'Administrativo', '2001', 0, 1],
  ];
  for (const [id, name, dept, ext, accepts, active] of employees) {
    await db.exec('INSERT INTO employees (id, company_id, name, department, extension, chat_ref, accepts_transfers, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, ACME, name, dept, ext, `demo:${id}`, accepts, active]);
  }
  await db.exec('INSERT INTO employees (id, company_id, name, department, extension, chat_ref, accepts_transfers, active) VALUES (?, ?, ?, ?, ?, ?, 1, 1)', ['emp_outra_rui', OUTRA, 'Rui Camargo', 'Diretoria', '100', 'demo:emp_outra_rui']);

  // ---- contas de demonstração: uma por perfil ----
  const hash = hashPassword(DEMO_PASSWORD);
  const users: Array<[string, string, string, string, string, string | null]> = [
    ['usr_admin', ACME, DEMO_ACCOUNTS[0].email, DEMO_ACCOUNTS[0].name, 'admin', 'emp_aline'],
    ['usr_operador', ACME, DEMO_ACCOUNTS[1].email, DEMO_ACCOUNTS[1].name, 'operator', 'emp_otavio'],
    ['usr_visualizador', ACME, DEMO_ACCOUNTS[2].email, DEMO_ACCOUNTS[2].name, 'viewer', null],
    ['usr_outra_admin', OUTRA, DEMO_ACCOUNTS[3].email, DEMO_ACCOUNTS[3].name, 'admin', 'emp_outra_rui'],
  ];
  for (const [id, company, email, name, role, emp] of users) {
    await db.exec('INSERT INTO users (id, company_id, email, name, role, password_hash, employee_id, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)', [id, company, email, name, role, hash, emp]);
  }

  // ---- prédio, andar e mapa (um andar operacional no MVP; o modelo já comporta mais) ----
  await db.exec('INSERT INTO buildings (id, company_id, name) VALUES (?, ?, ?)', ['bld_sede', ACME, 'Sede']);
  await db.exec('INSERT INTO floors (id, company_id, building_id, name, level) VALUES (?, ?, ?, ?, ?)', ['flr_sede_1', ACME, 'bld_sede', '1º andar', 1]);
  const scene = JSON.stringify(buildSeedScene('flr_sede_1'));
  await db.exec('INSERT INTO offices (id, company_id, floor_id, name, draft_json, draft_version, draft_updated_by, draft_updated_at, published_revision_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)', ['off_sede_1', ACME, 'flr_sede_1', 'Escritório Sede — 1º andar', scene, 'usr_admin', now, 'rev_seed_1']);
  await db.exec('INSERT INTO office_revisions (id, company_id, office_id, rev_number, scene_json, draft_version, note, published_by, published_at) VALUES (?, ?, ?, 1, ?, 1, ?, ?, ?)', ['rev_seed_1', ACME, 'off_sede_1', scene, 'Cena inicial de demonstração', 'usr_admin', now]);

  await db.exec('INSERT INTO buildings (id, company_id, name) VALUES (?, ?, ?)', ['bld_outra', OUTRA, 'Matriz']);
  await db.exec('INSERT INTO floors (id, company_id, building_id, name, level) VALUES (?, ?, ?, ?, ?)', ['flr_outra_1', OUTRA, 'bld_outra', 'Térreo', 0]);
  const empty = JSON.stringify({ schema: 1, units: 'm', floorId: 'flr_outra_1', objects: [] });
  await db.exec('INSERT INTO offices (id, company_id, floor_id, name, draft_json, draft_version, draft_updated_by, draft_updated_at, published_revision_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?, NULL)', ['off_outra_1', OUTRA, 'flr_outra_1', 'Matriz — térreo', empty, 'usr_outra_admin', now]);

  // ---- mesas: quem senta onde (posição fixa). at_mesa_06 fica vaga; noc_mesa_02 aponta para colaborador desligado => vínculo órfão.
  // O computador sobre a mesa herda o ocupante da mesa. ----
  const seats: Array<[string, string]> = [
    ['at_mesa_01', 'emp_ana'], ['at_mesa_02', 'emp_bruno'], ['at_mesa_03', 'emp_carla'], ['at_mesa_04', 'emp_diego'], ['at_mesa_05', 'emp_otavio'],
    ['rec_bancada', 'emp_helena'], ['noc_mesa_01', 'emp_igor'], ['noc_mesa_02', 'emp_marcos'],
  ];
  for (const [objectId, emp] of seats) {
    await db.exec('INSERT INTO seat_assignments (id, company_id, office_id, object_id, employee_id, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [`seat_${objectId}`, ACME, 'off_sede_1', objectId, emp, 'usr_admin', now]);
  }

  // ---- escritório 2D: quem senta em cada estação do layout padrão (independente das mesas do 3D) ----
  const seats2d: Array<[string, string]> = [['st1', 'emp_ana'], ['st2', 'emp_bruno'], ['st3', 'emp_carla'], ['st4', 'emp_diego'], ['st5', 'emp_otavio'], ['st6', 'emp_helena'], ['st7', 'emp_igor'], ['st8', 'emp_aline']];
  for (const [station, emp] of seats2d) {
    await db.exec('INSERT INTO seat2d_assignments (company_id, office_id, station_id, employee_id, updated_at) VALUES (?, ?, ?, ?, ?)', [ACME, 'off_sede_1', station, emp, now]);
  }

  // ---- dispositivos gerenciados (endereços de acesso remoto fictícios) ----
  const devices: Array<[string, string, string, string, string | null, string | null, number]> = [
    ['dev_pc_at_01', 'PC-ATD-01', 'pc', 'Atendimento, posto 01', 'anydesk', '100 000 001', 1],
    ['dev_pc_at_02', 'PC-ATD-02', 'pc', 'Atendimento, posto 02', 'anydesk', '100 000 002', 1],
    ['dev_pc_at_03', 'PC-ATD-03', 'pc', 'Atendimento, posto 03', 'anydesk', '100 000 003', 1],
    ['dev_pc_at_04', 'PC-ATD-04', 'pc', 'Atendimento, posto 04', 'anydesk', '100 000 004', 0],
    ['dev_pc_noc_01', 'PC-NOC-01', 'pc', 'NOC, posto 01', 'anydesk', '100 000 011', 1],
    ['dev_player_noc_01', 'PLAYER-NOC-01', 'tv_player', 'NOC, TV de rede', 'anydesk', '100 000 021', 1],
    ['dev_player_reuniao', 'PLAYER-REUNIAO', 'tv_player', 'Sala de reunião', 'anydesk', '100 000 022', 1],
    ['dev_player_atendimento', 'PLAYER-ATENDIMENTO', 'tv_player', 'Atendimento, TV de avisos', 'rustdesk', '200 000 031', 1],
    ['dev_prn_at_01', 'IMP-ATD-01', 'printer', 'Atendimento, junto à janela', null, null, 1],
  ];
  for (const [id, name, kind, location, provider, address, active] of devices) {
    await db.exec('INSERT INTO managed_devices (id, company_id, name, kind, location, remote_provider, remote_address, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, ACME, name, kind, location, provider, address, active]);
  }
  await db.exec('INSERT INTO managed_devices (id, company_id, name, kind, location, remote_provider, remote_address, active) VALUES (?, ?, ?, ?, ?, NULL, NULL, 1)', ['dev_outra_prn', OUTRA, 'IMP-MATRIZ', 'printer', 'Matriz']);

  // ---- vínculos objeto ↔ integração (por ID estável da instância) ----
  const bind = (objectId: string, type: string, deviceId: string | null, config: Record<string, unknown> | null) =>
    db.exec('INSERT INTO integration_bindings (id, company_id, office_id, object_id, binding_type, device_id, config_json, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [`bnd_${objectId}_${type}`, ACME, 'off_sede_1', objectId, type, deviceId, config ? JSON.stringify(config) : null, 'usr_admin', now]);
  await bind('ws_at_01', 'device', 'dev_pc_at_01', null);
  await bind('ws_at_02', 'device', 'dev_pc_at_02', null);
  await bind('ws_at_03', 'device', 'dev_pc_at_03', null);
  await bind('ws_at_04', 'device', 'dev_pc_at_04', null); // dispositivo removido => vínculo órfão
  await bind('ws_noc_01', 'device', 'dev_pc_noc_01', null);
  await bind('prn_at_01', 'device', 'dev_prn_at_01', null);
  await bind('tv_noc_01', 'device', 'dev_player_noc_01', null);
  await bind('tv_noc_01', 'dashboard', null, { name: 'Saúde da rede (demonstração)', url: '/demo/dashboard.html?painel=rede' });
  await bind('tv_noc_02', 'dashboard', null, { name: 'Fila de chamados (demonstração)', url: '/demo/dashboard.html?painel=chamados' });
  await bind('tv_reuniao', 'device', 'dev_player_reuniao', null);
  // tv_reuniao fica sem painel: demonstra o estado "não configurado"

  // ---- permissões de acesso remoto do operador (por dispositivo) ----
  for (const dev of ['dev_pc_at_01', 'dev_pc_at_02', 'dev_player_noc_01', 'dev_player_atendimento']) {
    await db.exec('INSERT INTO remote_access_grants (user_id, device_id, company_id) VALUES (?, ?, ?)', ['usr_operador', dev, ACME]);
  }

  // ---- TVs do escritório 2D (penduradas na parede): o player de cada uma. O operador só tem permissão na do atendimento (RustDesk) ----
  for (const [objectId, dev] of [['o40', 'dev_player_reuniao'], ['o66', 'dev_player_atendimento']]) {
    await db.exec('INSERT INTO object2d_devices (company_id, office_id, object_id, device_id, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [ACME, 'off_sede_1', objectId, dev, 'usr_admin', now]);
  }

  // ---- atendimentos simulados do operador ----
  await db.exec('INSERT INTO service_tickets (id, company_id, protocol, customer_name, subject, queue_name, assignee_employee_id, status, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)', ['tkt_demo_1', ACME, 'AT-2026-000184', 'Cliente Fictício Ltda.', 'Oscilação de sinal na filial', 'Suporte N1', 'emp_otavio', 'active', now]);
  await db.exec('INSERT INTO service_tickets (id, company_id, protocol, customer_name, subject, queue_name, assignee_employee_id, status, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)', ['tkt_demo_2', ACME, 'AT-2026-000185', 'Padaria Exemplo ME', 'Segunda via de fatura', 'Financeiro', 'emp_otavio', 'active', now]);
  return { created: true };
}
