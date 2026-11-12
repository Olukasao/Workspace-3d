/**
 * Cena inicial de demonstração: recepção, atendimento, sala de reunião e NOC em um andar de 20 × 14 m.
 * 9 postos (6 no atendimento, 2 no NOC, 1 na recepção), 1 impressora e 3 TVs. Todos os dados são fictícios.
 * IDs fixos: os vínculos do seed (colaboradores, dispositivos, painéis) apontam para eles.
 */
import type { SceneDoc, SceneObject, Transform, WallStyle, OpeningStyle, ObjectKind, FloorFinish } from './types';

const A = (slug: string) => `asset_${slug}`;
const T = (x: number, y: number, z: number, rotY = 0): Transform => ({ x, y, z, rotY });
const WALL_H = 2.7;
const WALL_T = 0.12;

export function buildSeedScene(floorId: string): SceneDoc {
  const objects: SceneObject[] = [];
  const add = (o: Omit<SceneObject, 'floorId'>) => {
    objects.push({ ...o, floorId });
    return o.id;
  };
  const room = (id: string, name: string, x: number, z: number, w: number, d: number, floor: FloorFinish, sector: string, capacity: number) =>
    add({ id, kind: 'room', name, t: T(x, 0, z), room: { w, d, floor, sector, capacity } });
  const wall = (id: string, name: string, x: number, z: number, length: number, rotY: number, style: WallStyle = 'solid', height = WALL_H) =>
    add({ id, kind: 'wall', name, t: T(x, 0, z, rotY), wall: { length, height, thickness: style === 'solid' ? WALL_T : 0.06, style } });
  const opening = (id: string, name: string, parentId: string, offset: number, width: number, height: number, sill: number, style: OpeningStyle) =>
    add({ id, kind: 'opening', name, parentId, t: T(offset, sill, 0), opening: { width, height, style } });
  const item = (id: string, kind: ObjectKind, name: string, asset: string, t: Transform, parentId?: string, extra: Partial<SceneObject> = {}) =>
    add({ id, kind, name, assetId: A(asset), t, parentId: parentId ?? null, ...extra });

  // ---- salas (zonas nomeadas) ----
  room('room_recepcao', 'Recepção', -7, 3.5, 6, 7, 'tile', 'Administrativo', 6);
  room('room_atendimento', 'Atendimento', 3, 3.5, 14, 7, 'carpet', 'Atendimento', 12);
  room('room_reuniao', 'Sala de reunião', -6.5, -3.5, 7, 7, 'wood', 'Compartilhado', 8);
  room('room_noc', 'NOC', 3.5, -3.5, 13, 7, 'concrete', 'Operações de rede', 6);

  // ---- paredes externas (a frente +Z local olha para dentro) ----
  wall('wall_n', 'Parede norte', 0, -7, 20, 0);
  wall('wall_s', 'Parede sul', 0, 7, 20, Math.PI);
  wall('wall_w', 'Parede oeste', -10, 0, 14, Math.PI / 2);
  wall('wall_e', 'Parede leste', 10, 0, 14, -Math.PI / 2);
  // ---- divisões internas ----
  wall('wall_mid_reuniao', 'Divisória de vidro da reunião', -6.5, 0, 7, 0, 'glass');
  wall('wall_mid_noc', 'Parede NOC / atendimento', 3.5, 0, 13, 0);
  wall('wall_rec_at', 'Divisória recepção / atendimento', -4, 3.5, 7, Math.PI / 2, 'glass');
  wall('wall_reu_noc', 'Parede reunião / NOC', -3, -3.5, 7, Math.PI / 2);

  // ---- portas e janelas ----
  opening('door_entrada', 'Porta de entrada', 'wall_s', 7, 1.8, 2.2, 0, 'glassDoor');
  opening('door_reuniao', 'Porta da sala de reunião', 'wall_mid_reuniao', 1.8, 0.95, 2.15, 0, 'glassDoor');
  opening('door_noc', 'Porta do NOC', 'wall_mid_noc', -4.6, 0.95, 2.15, 0, 'door');
  opening('door_atendimento', 'Passagem para o atendimento', 'wall_rec_at', -2, 1.2, 2.15, 0, 'glassDoor');
  opening('win_e1', 'Janela leste 1', 'wall_e', -4.2, 2.4, 1.3, 0.95, 'window');
  opening('win_e2', 'Janela leste 2', 'wall_e', -1.6, 2.4, 1.3, 0.95, 'window');
  opening('win_e3', 'Janela leste 3', 'wall_e', 3.5, 2.4, 1.3, 0.95, 'window');
  opening('win_s1', 'Janela sul 1', 'wall_s', -2, 2.6, 1.3, 0.95, 'window');
  opening('win_s2', 'Janela sul 2', 'wall_s', -6, 2.6, 1.3, 0.95, 'window');

  // ---- recepção ----
  item('rec_bancada', 'desk', 'Bancada da recepção', 'bancada-recepcao', T(-7, 0, 3.0));
  item('ws_rec_01', 'workstation', 'Posto Recepção', 'monitor', T(-0.45, 0.75, -0.05, Math.PI), 'rec_bancada');
  item('rec_telefone', 'decor', 'Telefone da recepção', 'telefone', T(0.35, 0.75, -0.08, Math.PI), 'rec_bancada', { material: 'Plástico' });
  item('rec_cadeira', 'furniture', 'Cadeira da recepção', 'cadeira-escritorio', T(-0.45, 0, -0.85), 'rec_bancada');
  item('rec_sofa', 'furniture', 'Sofá de espera', 'sofa-recepcao', T(-9.35, 0, 5.2, Math.PI / 2));
  item('rec_mesa_centro', 'furniture', 'Mesa de centro', 'mesa-centro', T(-8.2, 0, 5.2, Math.PI / 2));
  item('rec_planta', 'decor', 'Planta da recepção', 'planta-vaso-vermelho', T(-9.3, 0, 6.62), undefined, { material: 'Natural' });
  item('rec_planta_2', 'decor', 'Planta pequena', 'ph-planta', T(0.8, 1.08, 0.25), 'rec_bancada', { material: 'Natural' });
  item('rec_placa', 'decor', 'Placa Recepção', 'placa-sala', T(-2.4, 1.6, WALL_T / 2), 'wall_w', { material: 'Acrílico' });
  item('rec_quadro', 'decor', 'Quadro decorativo', 'quadro-arte', T(-5.2, 1.55, WALL_T / 2), 'wall_w', { material: 'Tela' });
  item('rec_luminaria', 'decor', 'Luminária de piso', 'luminaria-piso', T(-9.4, 0, 3.6), undefined, { material: 'Metal' });

  // ---- atendimento: 6 postos em duas fileiras ----
  const seats: Array<[string, number, number]> = [
    ['01', -1.4, 1.9], ['02', 1.6, 1.9], ['03', 4.6, 1.9],
    ['04', -1.4, 4.9], ['05', 1.6, 4.9], ['06', 4.6, 4.9],
  ];
  for (const [n, x, z] of seats) {
    const desk = item(`at_mesa_${n}`, 'desk', `Mesa ${n}`, 'mesa-reta', T(x, 0, z), undefined, { material: 'Madeira clara' });
    item(`ws_at_${n}`, 'workstation', `Posto ${n}`, 'monitor', T(0, 0.75, -0.14), desk);
    item(`at_teclado_${n}`, 'decor', `Teclado ${n}`, 'teclado', T(0, 0.75, 0.14), desk, { material: 'Plástico' });
    item(`at_mouse_${n}`, 'decor', `Mouse ${n}`, 'mouse', T(0.34, 0.75, 0.14), desk, { material: 'Plástico' });
    item(`at_cadeira_${n}`, 'furniture', `Cadeira ${n}`, 'cadeira-escritorio', T(0, 0, 0.72, Math.PI), desk);
  }
  item('at_telefone_02', 'decor', 'Telefone do posto 02', 'telefone', T(-0.5, 0.75, -0.1), 'at_mesa_02', { material: 'Plástico' });
  item('at_telefone_05', 'decor', 'Telefone do posto 05', 'telefone', T(-0.5, 0.75, -0.1), 'at_mesa_05', { material: 'Plástico' });
  item('prn_at_01', 'printer', 'Impressora Atendimento', 'copiadora', T(9.1, 0, 1.0, -Math.PI / 2));
  item('at_gaveteiro', 'furniture', 'Gaveteiro de arquivo', 'gaveteiro', T(9.4, 0, 2.3, -Math.PI / 2), undefined, { material: 'Aço' });
  item('at_armario', 'furniture', 'Armário baixo', 'armario-baixo', T(7.8, 0, 6.55, Math.PI), undefined, { material: 'Madeira escura' });
  item('at_livros', 'decor', 'Pilha de livros', 'livros', T(0.2, 0.9, 0), 'at_armario', { material: 'Papel' });
  item('at_bebedouro', 'decor', 'Bebedouro', 'bebedouro', T(-3.3, 0, 6.5, Math.PI), undefined, { material: 'Plástico' });
  item('at_lixeira', 'decor', 'Lixeira', 'lixeira', T(8.4, 0, 1.0), undefined, { material: 'Plástico' });
  item('at_planta', 'decor', 'Folhagem', 'planta-folhagem', T(9.3, 0, 6.3), undefined, { material: 'Natural' });
  item('at_relogio', 'decor', 'Relógio de parede', 'relogio-parede', T(-1.0, 2.1, WALL_T / 2), 'wall_mid_noc', { material: 'Plástico' });
  item('at_placa_saida', 'decor', 'Placa de saída', 'placa-saida', T(-2, 2.38, 0.03), 'wall_rec_at', { material: 'Acrílico' });
  item('at_caixas', 'decor', 'Caixas de papelão', 'caixas', T(6.4, 0, 6.5), undefined, { material: 'Papelão' });

  // ---- sala de reunião ----
  const mesa = item('reu_mesa', 'furniture', 'Mesa de reunião', 'mesa-reuniao', T(-6.5, 0, -3.6), undefined, { material: 'Madeira clara' });
  const chairs: Array<[number, number, number]> = [
    [-0.8, -0.95, 0], [0, -0.95, 0], [0.8, -0.95, 0],
    [-0.8, 0.95, Math.PI], [0, 0.95, Math.PI], [0.8, 0.95, Math.PI],
  ];
  chairs.forEach(([x, z, r], i) => item(`reu_cadeira_${i + 1}`, 'furniture', `Cadeira de reunião ${i + 1}`, 'cadeira-executiva', T(x, 0, z, r), mesa));
  item('tv_reuniao', 'tv', 'TV Sala de reunião', 'tv-parede', T(3.6, 1.5, WALL_T / 2), 'wall_w');
  item('reu_quadro_branco', 'decor', 'Quadro branco', 'quadro-branco', T(-6.5, 1.45, WALL_T / 2), 'wall_n', { material: 'Laminado' });
  item('reu_planta', 'decor', 'Planta da reunião', 'planta-folhagem', T(-9.3, 0, -0.7), undefined, { material: 'Natural' });
  item('reu_notebook', 'decor', 'Notebook da sala', 'notebook', T(-0.3, 0.75, 0.1, 0.3), mesa, { material: 'Alumínio' });

  // ---- NOC ----
  const noc: Array<[string, number]> = [['01', 1.4], ['02', 4.6]];
  for (const [n, x] of noc) {
    const desk = item(`noc_mesa_${n}`, 'desk', `Mesa NOC ${n}`, 'mesa-reta', T(x, 0, -3.4), undefined, { material: 'Madeira clara' });
    item(`ws_noc_${n}`, 'workstation', `Posto NOC ${n}`, 'monitor', T(-0.2, 0.75, -0.14), desk);
    item(`noc_torre_${n}`, 'decor', `Desktop NOC ${n}`, 'desktop-torre', T(0.52, 0.75, -0.08), desk, { material: 'Aço' });
    item(`noc_teclado_${n}`, 'decor', `Teclado NOC ${n}`, 'teclado', T(-0.2, 0.75, 0.14), desk, { material: 'Plástico' });
    item(`noc_cadeira_${n}`, 'furniture', `Cadeira NOC ${n}`, 'cadeira-escritorio', T(0, 0, 0.72, Math.PI), desk);
  }
  item('tv_noc_01', 'tv', 'TV NOC — Rede', 'tv-painel', T(1.6, 1.65, WALL_T / 2), 'wall_n');
  item('tv_noc_02', 'tv', 'TV NOC — Chamados', 'tv-painel', T(4.4, 1.65, WALL_T / 2), 'wall_n');
  item('noc_rack', 'decor', 'Rack de servidores', 'rack-servidor', T(9.2, 0, -5.6, -Math.PI / 2), undefined, { material: 'Aço' });
  item('noc_estante', 'furniture', 'Estante baixa', 'estante-baixa', T(-2.4, 0, -5.2, Math.PI / 2), undefined, { material: 'Laminado' });
  item('noc_cafeteira', 'decor', 'Cafeteira', 'kn-cafeteira', T(0, 0.45, 0), 'noc_estante', { material: 'Plástico' });
  item('noc_placa', 'decor', 'Placa NOC', 'placa-sala', T(-5.6, 1.6, WALL_T / 2), 'wall_mid_noc', { material: 'Acrílico' });

  return { schema: 1, units: 'm', floorId, objects };
}
