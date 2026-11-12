/**
 * Operações puras de edição sobre a lista de objetos (sem React). Cada função devolve uma NOVA lista,
 * o que permite desfazer/refazer por instantâneo e testar sem navegador.
 */
import { descendants, indexObjects, newObjectId, roomWallLayout, snapTo, toLocal, worldTransform, wouldCreateCycle } from '../../shared/scene';
import type { AssetDefinition, FloorFinish, ObjectKind, OpeningStyle, SceneDoc, SceneObject, Transform } from '../../shared/types';

type Objs = SceneObject[];
const docOf = (floorId: string, objects: Objs): SceneDoc => ({ schema: 1, units: 'm', floorId, objects });

export const WALL_HEIGHT = 2.7;
export const WALL_THICKNESS = 0.12;

/** Objeto acima do qual um item de superfície pousaria em (x, z) do mundo: o de tampo mais alto. */
export function findSupport(objects: Objs, assets: Record<string, AssetDefinition>, x: number, z: number, exclude: ReadonlySet<string>): { id: string; top: number; local: Transform } | null {
  const byId = indexObjects(docOf('', objects));
  let best: { id: string; top: number; local: Transform } | null = null;
  for (const o of objects) {
    if (exclude.has(o.id) || !o.assetId) continue;
    const a = assets[o.assetId];
    if (!a || a.surfaceHeight === null || a.pivot !== 'base-center') continue;
    const wt = worldTransform(byId, o.id);
    const local = toLocal({ x, y: 0, z, rotY: 0 }, wt);
    if (Math.abs(local.x) > a.width / 2 || Math.abs(local.z) > a.depth / 2) continue;
    const top = wt.y + a.surfaceHeight;
    if (!best || top > best.top) best = { id: o.id, top, local };
  }
  return best;
}

/** Parede mais próxima de um ponto (para objetos de parede inseridos sem parede selecionada). */
export function nearestWall(objects: Objs, x: number, z: number): { id: string; offset: number } | null {
  const byId = indexObjects(docOf('', objects));
  let best: { id: string; offset: number; dist: number } | null = null;
  for (const o of objects) {
    if (o.kind !== 'wall' || !o.wall || o.wall.style === 'glass') continue;
    const wt = worldTransform(byId, o.id);
    const local = toLocal({ x, y: 0, z, rotY: 0 }, wt);
    const half = o.wall.length / 2;
    const off = Math.max(-half + 0.3, Math.min(half - 0.3, local.x));
    const dist = Math.hypot(local.x - off, local.z);
    if (!best || dist < best.dist) best = { id: o.id, offset: off, dist };
  }
  return best ? { id: best.id, offset: best.offset } : null;
}

export interface AddOptions {
  /** Ponto do mundo onde inserir (normalmente o centro da vista). */
  at: { x: number; z: number };
  /** Objeto selecionado: mesa recebe itens de superfície; parede recebe itens de parede. */
  selectedId?: string | null;
  name?: string;
}

/** Insere uma instância do asset e devolve [lista nova, id criado]. Encaixa em superfície/parede conforme o tipo de montagem. */
export function addAsset(objects: Objs, floorId: string, asset: AssetDefinition, assets: Record<string, AssetDefinition>, opts: AddOptions): [Objs, string] {
  const id = newObjectId(asset.defaultKind === 'desk' ? 'desk' : asset.defaultKind === 'workstation' ? 'ws' : asset.defaultKind === 'printer' ? 'prn' : asset.defaultKind === 'tv' ? 'tv' : 'o');
  const byId = indexObjects(docOf(floorId, objects));
  const sel = opts.selectedId ? byId.get(opts.selectedId) : undefined;
  const count = objects.filter((o) => o.assetId === asset.id).length;
  const base: SceneObject = { id, kind: asset.defaultKind, name: opts.name ?? `${asset.name}${count ? ` ${count + 1}` : ''}`, assetId: asset.id, floorId, parentId: null, t: { x: snapTo(opts.at.x, 0.05), y: 0, z: snapTo(opts.at.z, 0.05), rotY: 0 } };
  if (asset.mount === 'wall') {
    const wallId = sel?.kind === 'wall' ? sel.id : sel?.parentId && byId.get(sel.parentId)?.kind === 'wall' ? sel.parentId : null;
    const wall = wallId ? { id: wallId, offset: 0 } : nearestWall(objects, opts.at.x, opts.at.z);
    if (wall) {
      const w = byId.get(wall.id)!;
      base.parentId = wall.id;
      base.t = { x: snapTo(wall.offset, 0.05), y: Math.min(1.6, w.wall!.height - asset.height / 2 - 0.1), z: w.wall!.thickness / 2, rotY: 0 };
    }
  } else if (asset.mount === 'surface') {
    // mesa selecionada (ou o pai do item selecionado) recebe o item; senão, procura uma superfície no ponto
    const target = sel && sel.assetId && assets[sel.assetId]?.surfaceHeight !== null && assets[sel.assetId]?.surfaceHeight !== undefined ? sel : sel?.parentId ? byId.get(sel.parentId) : undefined;
    const ta = target?.assetId ? assets[target.assetId] : undefined;
    if (target && ta && ta.surfaceHeight !== null) {
      const siblings = objects.filter((o) => o.parentId === target.id && o.assetId && assets[o.assetId]?.mount === 'surface').length;
      base.parentId = target.id;
      base.t = { x: snapTo(Math.max(-ta.width / 2 + asset.width / 2, Math.min(ta.width / 2 - asset.width / 2, -0.25 + siblings * 0.3)), 0.05), y: ta.surfaceHeight, z: snapTo(-ta.depth / 4, 0.05), rotY: 0 };
    } else {
      const s = findSupport(objects, assets, opts.at.x, opts.at.z, new Set());
      if (s) {
        base.parentId = s.id;
        base.t = { x: snapTo(s.local.x, 0.05), y: s.top - worldTransform(byId, s.id).y, z: snapTo(s.local.z, 0.05), rotY: 0 };
      }
    }
  }
  return [[...objects, base], id];
}

/** Itens de `ids` que não têm ancestral também em `ids` (movem levando os filhos). */
export function topLevel(objects: Objs, ids: Iterable<string>): string[] {
  const set = new Set(ids);
  const byId = indexObjects(docOf('', objects));
  return [...set].filter((id) => {
    let cur = byId.get(id)?.parentId;
    let guard = 0;
    while (cur && guard++ < 64) {
      if (set.has(cur)) return false;
      cur = byId.get(cur)?.parentId;
    }
    return byId.has(id);
  });
}

/** Expande a seleção para os membros do mesmo grupo. */
export function expandGroups(objects: Objs, ids: string[]): string[] {
  const groups = new Set(objects.filter((o) => ids.includes(o.id) && o.groupId).map((o) => o.groupId));
  return [...new Set([...ids, ...objects.filter((o) => o.groupId && groups.has(o.groupId)).map((o) => o.id)])];
}

/** Bloqueado se o próprio objeto ou algum ancestral estiver bloqueado. */
export function isLocked(objects: Objs, id: string): boolean {
  const byId = indexObjects(docOf('', objects));
  let cur = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 64) {
    if (cur.locked) return true;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return false;
}

/** Remove os objetos e seus descendentes (os bloqueados ficam). Devolve [lista, ids removidos]. */
export function removeObjects(objects: Objs, ids: string[]): [Objs, string[]] {
  const doc = docOf('', objects);
  const kill = new Set<string>();
  for (const id of ids) {
    if (isLocked(objects, id)) continue;
    kill.add(id);
    for (const d of descendants(doc, id)) kill.add(d.id);
  }
  return [objects.filter((o) => !kill.has(o.id)), [...kill]];
}

/** Duplica objetos com descendentes: IDs novos (sem vínculos de integração) e deslocamento de 0,5 m. */
export function duplicateObjects(objects: Objs, ids: string[]): [Objs, string[]] {
  const doc = docOf('', objects);
  const roots = topLevel(objects, ids);
  const map = new Map<string, string>();
  const groupMap = new Map<string, string>();
  const copies: SceneObject[] = [];
  for (const rootId of roots) {
    const root = objects.find((o) => o.id === rootId)!;
    for (const o of [root, ...descendants(doc, rootId)]) map.set(o.id, newObjectId(o.id.split('_')[0] || 'o'));
    for (const o of [root, ...descendants(doc, rootId)]) {
      const isRoot = o.id === rootId;
      const groupId = o.groupId ? (groupMap.get(o.groupId) ?? groupMap.set(o.groupId, newObjectId('g')).get(o.groupId)!) : null;
      copies.push({
        ...structuredClone(o),
        id: map.get(o.id)!,
        name: isRoot ? `${o.name} (cópia)` : o.name,
        parentId: isRoot ? (o.parentId ?? null) : map.get(o.parentId!)!,
        t: isRoot ? { ...o.t, x: o.t.x + (o.kind === 'opening' ? o.opening!.width + 0.2 : 0.5), z: o.t.z + (o.kind === 'opening' ? 0 : 0.5) } : { ...o.t },
        locked: false,
        groupId,
      });
    }
  }
  return [[...objects, ...copies], roots.map((id) => map.get(id)!)];
}

/** Move (dx, dz) no MUNDO os objetos de nível superior da seleção; os bloqueados ficam. */
export function moveBy(objects: Objs, ids: string[], dx: number, dz: number, snap = 0): Objs {
  const doc = docOf('', objects);
  const byId = indexObjects(doc);
  const movers = new Set(topLevel(objects, ids).filter((id) => !isLocked(objects, id)));
  return objects.map((o) => {
    if (!movers.has(o.id)) return o;
    const parent = o.parentId ? worldTransform(byId, o.parentId) : null;
    const w = worldTransform(byId, o.id);
    const nw = { ...w, x: snap ? snapTo(w.x + dx, snap) : w.x + dx, z: snap ? snapTo(w.z + dz, snap) : w.z + dz };
    const local = toLocal(nw, parent);
    return { ...o, t: { ...o.t, x: round(local.x), z: round(local.z) } };
  });
}

const round = (v: number) => Math.round(v * 1000) / 1000 || 0;

export function patchObject(objects: Objs, id: string, patch: Partial<SceneObject>): Objs {
  return objects.map((o) => (o.id === id ? { ...o, ...patch } : o));
}

export function setTransform(objects: Objs, id: string, t: Partial<Transform>): Objs {
  return objects.map((o) => (o.id === id ? { ...o, t: { ...o.t, ...t } } : o));
}

/** Gira os objetos de nível superior (passo em radianos) em torno de si mesmos. */
export function rotateBy(objects: Objs, ids: string[], step: number): Objs {
  const movers = new Set(topLevel(objects, ids).filter((id) => !isLocked(objects, id)));
  return objects.map((o) => (movers.has(o.id) ? { ...o, t: { ...o.t, rotY: normAngle(o.t.rotY + step) } } : o));
}

const normAngle = (a: number) => {
  const two = Math.PI * 2;
  const v = ((a % two) + two) % two;
  return Math.round((v > Math.PI ? v - two : v) * 1e6) / 1e6;
};

/** Troca o pai mantendo a posição no mundo. Recusa ciclos (devolve null). */
export function reparent(objects: Objs, id: string, parentId: string | null, overrideLocal?: Partial<Transform>): Objs | null {
  const doc = docOf('', objects);
  if (wouldCreateCycle(doc, id, parentId)) return null;
  const byId = indexObjects(doc);
  const w = worldTransform(byId, id);
  const local = toLocal(w, parentId ? worldTransform(byId, parentId) : null);
  return objects.map((o) => (o.id === id ? { ...o, parentId, t: { x: round(local.x), y: round(local.y), z: round(local.z), rotY: normAngle(local.rotY), ...overrideLocal } } : o));
}

/** Alinha à grade a posição (no mundo) dos objetos de nível superior. */
export function snapObjects(objects: Objs, ids: string[], step: number): Objs {
  const byId = indexObjects(docOf('', objects));
  const movers = new Set(topLevel(objects, ids).filter((id) => !isLocked(objects, id)));
  return objects.map((o) => {
    if (!movers.has(o.id)) return o;
    if (o.parentId && byId.get(o.parentId)?.kind === 'wall') return { ...o, t: { ...o.t, x: snapTo(o.t.x, step), y: snapTo(o.t.y, step) } };
    const parent = o.parentId ? worldTransform(byId, o.parentId) : null;
    const w = worldTransform(byId, o.id);
    const local = toLocal({ ...w, x: snapTo(w.x, step), z: snapTo(w.z, step), rotY: Math.round(w.rotY / (Math.PI / 12)) * (Math.PI / 12) }, parent);
    return { ...o, t: { x: round(local.x), y: o.t.y, z: round(local.z), rotY: normAngle(local.rotY) } };
  });
}

export function groupObjects(objects: Objs, ids: string[]): [Objs, string | null] {
  const roots = topLevel(objects, ids);
  if (roots.length < 2) return [objects, null];
  const gid = newObjectId('g');
  const set = new Set(roots);
  return [objects.map((o) => (set.has(o.id) ? { ...o, groupId: gid } : o)), gid];
}

export function ungroupObjects(objects: Objs, ids: string[]): Objs {
  const groups = new Set(objects.filter((o) => ids.includes(o.id) && o.groupId).map((o) => o.groupId));
  return objects.map((o) => (o.groupId && groups.has(o.groupId) ? { ...o, groupId: null } : o));
}

/** Troca o modelo visual preservando o ID da instância (e, portanto, todos os vínculos). Corrige a altura de itens de parede. */
export function swapAsset(objects: Objs, id: string, asset: AssetDefinition): Objs {
  return objects.map((o) => (o.id === id ? { ...o, assetId: asset.id, kind: keepKind(o.kind, asset.defaultKind) } : o));
}

/** O tipo funcional é do objeto: trocar a TV por outro modelo de TV não muda nada; trocar por decoração genérica mantém o tipo atual. */
const keepKind = (current: ObjectKind, incoming: ObjectKind): ObjectKind => (['desk', 'workstation', 'printer', 'tv'].includes(current) ? current : incoming);

/** Cria uma sala com piso e as 4 paredes como filhas (acompanham a sala). */
export function createRoom(objects: Objs, floorId: string, at: { x: number; z: number }, w = 5, d = 4, floor: FloorFinish = 'carpet', name?: string): [Objs, string] {
  const roomId = newObjectId('room');
  const n = objects.filter((o) => o.kind === 'room').length + 1;
  const room: SceneObject = { id: roomId, kind: 'room', name: name ?? `Sala ${n}`, floorId, parentId: null, t: { x: snapTo(at.x, 0.5), y: 0, z: snapTo(at.z, 0.5), rotY: 0 }, room: { w, d, floor, sector: '', capacity: 4 } };
  const layout = roomWallLayout(w, d);
  const walls = (Object.keys(layout) as Array<keyof typeof layout>).map<SceneObject>((side) => ({
    id: newObjectId('wall'), kind: 'wall', name: `${room.name} — parede ${({ n: 'norte', s: 'sul', e: 'leste', w: 'oeste' } as const)[side]}`, floorId, parentId: roomId,
    t: layout[side].t, wall: { length: layout[side].length, height: WALL_HEIGHT, thickness: WALL_THICKNESS, style: 'solid', side },
  }));
  return [[...objects, room, ...walls], roomId];
}

/** Redimensiona a sala e reposiciona as paredes automáticas dela. */
export function resizeRoom(objects: Objs, roomId: string, w: number, d: number): Objs {
  const layout = roomWallLayout(w, d);
  return objects.map((o) => {
    if (o.id === roomId && o.room) return { ...o, room: { ...o.room, w, d } };
    if (o.parentId === roomId && o.wall?.side) return { ...o, t: layout[o.wall.side].t, wall: { ...o.wall, length: layout[o.wall.side].length } };
    return o;
  });
}

// ---------- desenho livre da estrutura ----------

export interface Pt {
  x: number;
  z: number;
}

/** Pontas (no mundo) de uma parede: início = -X local, fim = +X local. */
export function wallEndpoints(objects: Objs, id: string): { a: Pt; b: Pt } | null {
  const o = objects.find((x) => x.id === id);
  if (!o?.wall) return null;
  const wt = worldTransform(indexObjects(docOf('', objects)), id);
  const h = o.wall.length / 2;
  const ux = Math.cos(wt.rotY);
  const uz = -Math.sin(wt.rotY);
  return { a: { x: wt.x - ux * h, z: wt.z - uz * h }, b: { x: wt.x + ux * h, z: wt.z + uz * h } };
}

/** Transformação e comprimento de uma parede que vai de `a` até `b` (no mundo). */
export function wallFromPoints(a: Pt, b: Pt): { t: Transform; length: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return { t: { x: round((a.x + b.x) / 2), y: 0, z: round((a.z + b.z) / 2), rotY: normAngle(Math.atan2(-dz, dx)) }, length: round(Math.hypot(dx, dz)) };
}

export interface WallStyleOptions {
  height: number;
  thickness: number;
  style: 'solid' | 'glass' | 'partition';
}

export const DEFAULT_WALL: WallStyleOptions = { height: WALL_HEIGHT, thickness: WALL_THICKNESS, style: 'solid' };

/** Parede de `a` até `b`. Trechos com menos de 10 cm são ignorados (clique duplo, por exemplo). */
export function addWallSegment(objects: Objs, floorId: string, a: Pt, b: Pt, opts: WallStyleOptions = DEFAULT_WALL): [Objs, string] | null {
  const w = wallFromPoints(a, b);
  if (w.length < 0.1) return null;
  const id = newObjectId('wall');
  const label = opts.style === 'glass' ? 'Divisória de vidro' : opts.style === 'partition' ? 'Divisória' : 'Parede';
  const n = objects.filter((o) => o.kind === 'wall').length + 1;
  return [[...objects, { id, kind: 'wall', name: `${label} ${n}`, floorId, parentId: null, t: w.t, wall: { length: w.length, height: opts.height, thickness: opts.thickness, style: opts.style } }], id];
}

/**
 * Move as pontas de uma parede. A ponta que fica parada (`fixed`) mantém portas e janelas à mesma distância dela.
 * Parede de sala (lado automático) vira parede livre: deixa de acompanhar o tamanho da sala.
 */
export function setWallEndpoints(objects: Objs, id: string, a: Pt, b: Pt, fixed: 'a' | 'b'): Objs {
  const o = objects.find((x) => x.id === id);
  if (!o?.wall) return objects;
  const w = wallFromPoints(a, b);
  if (w.length < 0.1) return objects;
  const byId = indexObjects(docOf('', objects));
  const parent = o.parentId ? worldTransform(byId, o.parentId) : null;
  const local = toLocal(w.t, parent);
  const oldHalf = o.wall.length / 2;
  const newHalf = w.length / 2;
  return objects.map((x) => {
    if (x.id === id) return { ...x, t: { x: round(local.x), y: x.t.y, z: round(local.z), rotY: normAngle(local.rotY) }, wall: { ...x.wall!, length: w.length, side: undefined } };
    if (x.parentId === id && x.kind === 'opening' && x.opening) {
      const nx = fixed === 'a' ? x.t.x + oldHalf - newHalf : x.t.x - oldHalf + newHalf;
      const lim = Math.max(0, newHalf - x.opening.width / 2);
      return { ...x, t: { ...x.t, x: round(Math.max(-lim, Math.min(lim, nx))) } };
    }
    return x;
  });
}

/** Piso (zona nomeada) no retângulo entre dois cantos; opcionalmente já com as 4 paredes. */
export function addFloor(objects: Objs, floorId: string, p: Pt, q: Pt, floor: FloorFinish, withWalls: boolean, wallOpts: WallStyleOptions = DEFAULT_WALL): [Objs, string] | null {
  const w = round(Math.abs(q.x - p.x));
  const d = round(Math.abs(q.z - p.z));
  if (w < 0.5 || d < 0.5) return null;
  const at = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
  const n = objects.filter((o) => o.kind === 'room').length + 1;
  const [objs, id] = createRoom(objects, floorId, at, w, d, floor, withWalls ? `Sala ${n}` : `Piso ${n}`);
  // createRoom encaixa o centro em 0,5 m; aqui vale o retângulo desenhado
  const placed = objs.map((o) => (o.id === id ? { ...o, t: { ...o.t, x: round(at.x), z: round(at.z) } } : o));
  if (!withWalls) return [placed.filter((o) => o.parentId !== id), id];
  return [placed.map((o) => (o.parentId === id && o.wall ? { ...o, wall: { ...o.wall, height: wallOpts.height, thickness: wallOpts.thickness, style: wallOpts.style } } : o)), id];
}

export const OPENING_PRESET: Record<OpeningStyle, { width: number; height: number; sill: number; label: string }> = {
  door: { width: 0.9, height: 2.1, sill: 0, label: 'Porta' },
  glassDoor: { width: 1.2, height: 2.1, sill: 0, label: 'Porta de vidro' },
  window: { width: 1.6, height: 1.2, sill: 0.95, label: 'Janela' },
};

/** Posição válida para um vão de largura `width` perto de `x`: dentro da parede e sem encostar em outro vão (null se não couber). */
export function fitOpening(objects: Objs, wallId: string, width: number, x: number, ignoreId?: string): number | null {
  const wall = objects.find((o) => o.id === wallId)?.wall;
  if (!wall) return null;
  const lim = wall.length / 2 - width / 2 - 0.05;
  if (lim < 0) return null;
  const taken = objects.filter((o) => o.parentId === wallId && o.kind === 'opening' && o.id !== ignoreId).map((o) => [o.t.x - o.opening!.width / 2 - 0.05, o.t.x + o.opening!.width / 2 + 0.05]);
  const free = (c: number) => Math.abs(c) <= lim + 1e-9 && !taken.some(([a, b]) => c + width / 2 > a && c - width / 2 < b);
  const start = Math.max(-lim, Math.min(lim, x));
  for (let i = 0; i <= 400; i++) for (const c of i === 0 ? [start] : [start + i * 0.05, start - i * 0.05]) if (free(c)) return round(c);
  return null;
}

/** Porta/janela no ponto da parede (deslocamento `x` a partir do centro dela). */
export function addOpeningAt(objects: Objs, floorId: string, wallId: string, style: OpeningStyle, x: number): [Objs, string] | null {
  const p = OPENING_PRESET[style];
  const pos = fitOpening(objects, wallId, p.width, x);
  if (pos === null) return null;
  const id = newObjectId('op');
  const n = objects.filter((o) => o.kind === 'opening').length + 1;
  return [[...objects, { id, kind: 'opening', name: `${p.label} ${n}`, floorId, parentId: wallId, t: { x: pos, y: p.sill, z: 0, rotY: 0 }, opening: { width: p.width, height: p.height, style } }], id];
}

/** Pontos de encaixe para desenhar: pontas de paredes e cantos de pisos. */
export function snapTargets(objects: Objs): Pt[] {
  const pts: Pt[] = [];
  for (const o of objects) {
    if (o.wall) {
      const e = wallEndpoints(objects, o.id);
      if (e) pts.push(e.a, e.b);
    } else if (o.room && !o.parentId) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push({ x: o.t.x + (sx * o.room.w) / 2, z: o.t.z + (sz * o.room.d) / 2 });
    }
  }
  return pts;
}

/** Encaixe de um ponto do desenho: ponta/canto próximo; senão ângulo de 45° a partir de `from` (se `angleSnap`); senão grade. */
export function snapDrawPoint(p: Pt, opts: { grid: number; targets: Pt[]; radius?: number; from?: Pt | null; angleSnap?: boolean }): { p: Pt; snapped: 'point' | 'grid' | 'angle' } {
  let best: Pt | null = null;
  let bd = opts.radius ?? 0.25;
  for (const t of opts.targets) {
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d <= bd) {
      bd = d;
      best = t;
    }
  }
  if (best) return { p: { x: round(best.x), z: round(best.z) }, snapped: 'point' };
  const g = opts.grid > 0 ? opts.grid : 0.05;
  if (opts.from && opts.angleSnap) {
    const dx = p.x - opts.from.x;
    const dz = p.z - opts.from.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.01) {
      const ang = Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const L = Math.max(g, Math.round(len / g) * g);
      return { p: { x: round(opts.from.x + Math.cos(ang) * L), z: round(opts.from.z + Math.sin(ang) * L) }, snapped: 'angle' };
    }
  }
  return { p: { x: snapTo(p.x, g), z: snapTo(p.z, g) }, snapped: 'grid' };
}

export function addWall(objects: Objs, floorId: string, at: { x: number; z: number }, length = 4): [Objs, string] {
  const id = newObjectId('wall');
  return [[...objects, { id, kind: 'wall', name: `Parede ${objects.filter((o) => o.kind === 'wall').length + 1}`, floorId, parentId: null, t: { x: snapTo(at.x, 0.5), y: 0, z: snapTo(at.z, 0.5), rotY: 0 }, wall: { length, height: WALL_HEIGHT, thickness: WALL_THICKNESS, style: 'solid' } }], id];
}

/** Porta ou janela na parede: procura um trecho livre perto do centro. */
export function addOpening(objects: Objs, floorId: string, wallId: string, style: OpeningStyle): [Objs, string] | null {
  const wall = objects.find((o) => o.id === wallId && o.kind === 'wall');
  if (!wall?.wall) return null;
  const width = style === 'window' ? 1.6 : style === 'glassDoor' ? 1.2 : 0.9;
  const height = style === 'window' ? 1.2 : 2.1;
  const sill = style === 'window' ? 0.95 : 0;
  const taken = objects.filter((o) => o.parentId === wallId && o.kind === 'opening').map((o) => [o.t.x - o.opening!.width / 2 - 0.1, o.t.x + o.opening!.width / 2 + 0.1]);
  const half = wall.wall.length / 2 - width / 2 - 0.1;
  if (half < 0) return null;
  let x: number | null = null;
  for (let step = 0; step <= Math.ceil(half / 0.25) * 2; step++) {
    const cand = (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 0.25;
    if (Math.abs(cand) > half) continue;
    if (!taken.some(([a, b]) => cand + width / 2 > a && cand - width / 2 < b)) {
      x = cand;
      break;
    }
  }
  if (x === null) return null;
  const id = newObjectId('op');
  const label = style === 'window' ? 'Janela' : style === 'glassDoor' ? 'Porta de vidro' : 'Porta';
  return [[...objects, { id, kind: 'opening', name: `${label} ${objects.filter((o) => o.kind === 'opening').length + 1}`, floorId, parentId: wallId, t: { x, y: sill, z: 0, rotY: 0 }, opening: { width, height, style } }], id];
}
