import { OBJECT_KINDS, type AssetDefinition, type ObjectKind, type SceneDoc, type SceneObject, type Transform } from './types';

/** Limites do documento de cena (validados no cliente e no servidor). */
export const SCENE_LIMITS = { maxObjects: 2000, maxDepth: 8, maxCoord: 500, maxNameLength: 80 };

export type AssetIndex = Record<string, Pick<AssetDefinition, 'id' | 'width' | 'depth' | 'height' | 'surfaceHeight' | 'mount' | 'defaultKind' | 'pivot'>>;

export function indexObjects(doc: SceneDoc): Map<string, SceneObject> {
  return new Map(doc.objects.map((o) => [o.id, o]));
}

/** Transformação no mundo: compõe a cadeia de pais (apenas translação + rotação em Y). */
export function worldTransform(byId: Map<string, SceneObject>, id: string): Transform {
  const chain: SceneObject[] = [];
  let cur = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 64) {
    chain.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  let x = 0;
  let y = 0;
  let z = 0;
  let rot = 0;
  for (let i = chain.length - 1; i >= 0; i--) {
    const t = chain[i].t;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    x += t.x * c + t.z * s;
    z += -t.x * s + t.z * c;
    y += t.y;
    rot += t.rotY;
  }
  return { x, y, z, rotY: rot };
}

/** Converte uma transformação do mundo para o espaço local de `parent` (transformação do pai no mundo). */
export function toLocal(world: Transform, parent: Transform | null): Transform {
  if (!parent) return { ...world };
  const dx = world.x - parent.x;
  const dz = world.z - parent.z;
  const c = Math.cos(parent.rotY);
  const s = Math.sin(parent.rotY);
  return { x: dx * c - dz * s, y: world.y - parent.y, z: dx * s + dz * c, rotY: world.rotY - parent.rotY };
}

export function childrenOf(doc: SceneDoc, id: string): SceneObject[] {
  return doc.objects.filter((o) => o.parentId === id);
}

/** Todos os descendentes (filhos, netos…) de um objeto. */
export function descendants(doc: SceneDoc, id: string): SceneObject[] {
  const out: SceneObject[] = [];
  const stack = [id];
  const seen = new Set<string>([id]);
  while (stack.length) {
    const cur = stack.pop()!;
    for (const o of doc.objects) {
      if (o.parentId === cur && !seen.has(o.id)) {
        seen.add(o.id);
        out.push(o);
        stack.push(o.id);
      }
    }
  }
  return out;
}

/** Tornar `parentId` pai de `childId` criaria um ciclo? (o pai não pode ser o próprio objeto nem um descendente dele) */
export function wouldCreateCycle(doc: SceneDoc, childId: string, parentId: string | null | undefined): boolean {
  if (!parentId) return false;
  if (parentId === childId) return true;
  const byId = indexObjects(doc);
  let cur = byId.get(parentId);
  let guard = 0;
  while (cur && guard++ <= doc.objects.length) {
    if (cur.id === childId) return true;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return false;
}

/** Dimensões (m) de um objeto: paramétricas para sala/parede/vão, do asset para os demais. */
export function objectSize(o: SceneObject, assets: AssetIndex): { w: number; d: number; h: number } {
  if (o.room) return { w: o.room.w, d: o.room.d, h: 0.02 };
  if (o.wall) return { w: o.wall.length, d: o.wall.thickness, h: o.wall.height };
  if (o.opening) return { w: o.opening.width, d: 0.2, h: o.opening.height };
  const a = o.assetId ? assets[o.assetId] : undefined;
  return a ? { w: a.width, d: a.depth, h: a.height } : { w: 0.6, d: 0.6, h: 0.6 };
}

/** Retângulo no piso (AABB no mundo) que envolve o objeto girado. */
export function worldFootprint(o: SceneObject, byId: Map<string, SceneObject>, assets: AssetIndex): { x: number; z: number; w: number; d: number; y0: number; y1: number } {
  const wt = worldTransform(byId, o.id);
  const s = objectSize(o, assets);
  const c = Math.abs(Math.cos(wt.rotY));
  const sn = Math.abs(Math.sin(wt.rotY));
  const a = o.assetId ? assets[o.assetId] : undefined;
  // âncora de parede: o volume fica à frente (+Z local) do pivô e centrado na altura
  let cx = wt.x;
  let cz = wt.z;
  let y0 = wt.y;
  if (a?.pivot === 'wall-back') {
    cx += Math.sin(wt.rotY) * (s.d / 2);
    cz += Math.cos(wt.rotY) * (s.d / 2);
    y0 = wt.y - s.h / 2;
  }
  return { x: cx, z: cz, w: s.w * c + s.d * sn, d: s.w * sn + s.d * c, y0, y1: y0 + s.h };
}

/** Sala (retângulo alinhado aos eixos) que contém o ponto, ou null. */
export function roomAt(doc: SceneDoc, x: number, z: number): SceneObject | null {
  let best: SceneObject | null = null;
  for (const o of doc.objects) {
    if (o.kind !== 'room' || !o.room) continue;
    if (Math.abs(x - o.t.x) <= o.room.w / 2 && Math.abs(z - o.t.z) <= o.room.d / 2) {
      if (!best || o.room.w * o.room.d < best.room!.w * best.room!.d) best = o;
    }
  }
  return best;
}

export interface CollisionWarning {
  a: string;
  b: string;
}

const NON_COLLIDING: ReadonlySet<ObjectKind> = new Set<ObjectKind>(['room', 'wall', 'opening']);

/**
 * Sobreposições entre objetos (aviso, não bloqueio: sobrepor pode ser legítimo, como cadeira sob a mesa).
 * Ignora estrutura (sala/parede/vão), pares pai–filho/irmãos apoiados e objetos em alturas que não se cruzam.
 */
export function collisionWarnings(doc: SceneDoc, assets: AssetIndex, onlyIds?: ReadonlySet<string>): CollisionWarning[] {
  const byId = indexObjects(doc);
  const items = doc.objects.filter((o) => !NON_COLLIDING.has(o.kind)).map((o) => ({ o, f: worldFootprint(o, byId, assets) }));
  const related = (a: SceneObject, b: SceneObject) => a.parentId === b.id || b.parentId === a.id;
  const out: CollisionWarning[] = [];
  const EPS = 0.02;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i];
      const B = items[j];
      if (onlyIds && !onlyIds.has(A.o.id) && !onlyIds.has(B.o.id)) continue;
      if (related(A.o, B.o)) continue;
      if (Math.abs(A.f.x - B.f.x) < (A.f.w + B.f.w) / 2 - EPS && Math.abs(A.f.z - B.f.z) < (A.f.d + B.f.d) / 2 - EPS && A.f.y0 < B.f.y1 - EPS && B.f.y0 < A.f.y1 - EPS) {
        out.push({ a: A.o.id, b: B.o.id });
      }
    }
  }
  return out;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const inRange = (n: unknown, min: number, max: number): n is number => finite(n) && n >= min && n <= max;

/**
 * Valida o documento de cena. Devolve a lista de problemas (vazia = válido).
 * Usada no servidor antes de gravar/publicar e no cliente antes de enviar.
 */
export function validateScene(doc: unknown, assets: AssetIndex | null, floorId?: string): string[] {
  const errors: string[] = [];
  const d = doc as SceneDoc;
  if (!d || typeof d !== 'object') return ['Documento ausente.'];
  if (d.schema !== 1) errors.push('Versão de esquema não suportada.');
  if (d.units !== 'm') errors.push('A unidade da cena precisa ser metros.');
  if (!Array.isArray(d.objects)) return [...errors, 'Lista de objetos ausente.'];
  if (d.objects.length > SCENE_LIMITS.maxObjects) errors.push(`A cena passa do limite de ${SCENE_LIMITS.maxObjects} objetos.`);
  if (floorId && d.floorId !== floorId) errors.push('A cena pertence a outro andar.');
  const ids = new Set<string>();
  for (const o of d.objects) {
    const where = `Objeto "${typeof o?.id === 'string' ? o.id : '?'}"`;
    if (!o || typeof o !== 'object') {
      errors.push('Objeto inválido na lista.');
      continue;
    }
    if (typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(o.id)) errors.push(`${where}: identificador inválido.`);
    else if (ids.has(o.id)) errors.push(`${where}: identificador repetido.`);
    else ids.add(o.id);
    if (!OBJECT_KINDS.includes(o.kind)) errors.push(`${where}: tipo desconhecido.`);
    if (typeof o.name !== 'string' || o.name.length > SCENE_LIMITS.maxNameLength) errors.push(`${where}: nome inválido.`);
    if (o.floorId !== d.floorId) errors.push(`${where}: andar diferente do documento.`);
    const t = o.t;
    const M = SCENE_LIMITS.maxCoord;
    if (!t || !inRange(t.x, -M, M) || !inRange(t.y, -M, M) || !inRange(t.z, -M, M) || !finite(t.rotY)) errors.push(`${where}: posição inválida.`);
    if (o.kind === 'room') {
      if (!o.room || !inRange(o.room.w, 0.5, 200) || !inRange(o.room.d, 0.5, 200)) errors.push(`${where}: medidas da sala inválidas.`);
    } else if (o.kind === 'wall') {
      if (!o.wall || !inRange(o.wall.length, 0.1, 200) || !inRange(o.wall.height, 0.1, 10) || !inRange(o.wall.thickness, 0.02, 1)) errors.push(`${where}: medidas da parede inválidas.`);
    } else if (o.kind === 'opening') {
      if (!o.opening || !inRange(o.opening.width, 0.2, 20) || !inRange(o.opening.height, 0.2, 10)) errors.push(`${where}: medidas do vão inválidas.`);
    } else {
      if (typeof o.assetId !== 'string' || !o.assetId) errors.push(`${where}: asset ausente.`);
      else if (assets && !assets[o.assetId]) errors.push(`${where}: asset "${o.assetId}" não existe no catálogo.`);
    }
  }
  // parentesco: pai existente, vão só em parede, sem ciclos e com profundidade limitada
  const byId = new Map(d.objects.filter((o) => o && typeof o.id === 'string').map((o) => [o.id, o]));
  for (const o of d.objects) {
    if (!o || !o.parentId) {
      if (o?.kind === 'opening') errors.push(`Objeto "${o.id}": porta/janela precisa estar em uma parede.`);
      continue;
    }
    const parent = byId.get(o.parentId);
    if (!parent) {
      errors.push(`Objeto "${o.id}": pai "${o.parentId}" não existe.`);
      continue;
    }
    if (o.kind === 'opening' && parent.kind !== 'wall') errors.push(`Objeto "${o.id}": porta/janela precisa estar em uma parede.`);
    let cur: SceneObject | undefined = parent;
    let depth = 1;
    const seen = new Set<string>([o.id]);
    while (cur) {
      if (seen.has(cur.id)) {
        errors.push(`Objeto "${o.id}": ciclo de parentesco.`);
        break;
      }
      seen.add(cur.id);
      if (++depth > SCENE_LIMITS.maxDepth) {
        errors.push(`Objeto "${o.id}": hierarquia profunda demais.`);
        break;
      }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return errors;
}

let counter = 0;
/** Identificador novo de instância (estável depois de criado). */
export function newObjectId(prefix = 'o'): string {
  counter = (counter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

/** Posições das 4 paredes automáticas de uma sala, no espaço local da sala. */
export function roomWallLayout(w: number, d: number): Record<'n' | 's' | 'e' | 'w', { t: Transform; length: number }> {
  return {
    n: { t: { x: 0, y: 0, z: -d / 2, rotY: 0 }, length: w },
    s: { t: { x: 0, y: 0, z: d / 2, rotY: Math.PI }, length: w },
    e: { t: { x: w / 2, y: 0, z: 0, rotY: -Math.PI / 2 }, length: d },
    w: { t: { x: -w / 2, y: 0, z: 0, rotY: Math.PI / 2 }, length: d },
  };
}

export const snapTo = (v: number, step: number): number => (step > 0 ? Math.round(v / step) * step || 0 : v);

// ---------- mesas de trabalho e posição fixa ----------

export type KindIndex = Record<string, { defaultKind: ObjectKind; category?: string } | undefined>;

/** Mesa de trabalho: tipo 'desk' ou mobiliário cujo modelo é de mesa (rascunhos antigos guardavam mesas como 'furniture'). */
export function isDesk(o: SceneObject | undefined, assets: KindIndex): boolean {
  if (!o) return false;
  if (o.kind === 'desk') return true;
  return o.kind === 'furniture' && !!o.assetId && assets[o.assetId]?.defaultKind === 'desk';
}

/** Mesa à qual o objeto pertence: ele mesmo, se for mesa, ou o ancestral mais próximo que seja mesa. */
export function deskOf(byId: Map<string, SceneObject>, id: string, assets: KindIndex): SceneObject | null {
  let cur = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 64) {
    if (isDesk(cur, assets)) return cur;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return null;
}

export const DEFAULT_SEAT = { x: 0, z: 0.72, rotY: Math.PI };

/**
 * Assento fixo da mesa, relativo a ela: o definido explicitamente, senão a cadeira filha (categoria Assentos)
 * mais próxima da frente, senão 0,72 m à frente da mesa, olhando para ela.
 */
export function seatAnchorOf(byId: Map<string, SceneObject>, desk: SceneObject, assets: KindIndex): { local: Transform; source: 'manual' | 'chair' | 'default'; chairId?: string } {
  if (desk.seatAnchor) return { local: { x: desk.seatAnchor.x, y: 0, z: desk.seatAnchor.z, rotY: desk.seatAnchor.rotY }, source: 'manual' };
  let best: SceneObject | null = null;
  for (const o of byId.values()) {
    if (o.parentId !== desk.id || !o.assetId || assets[o.assetId]?.category !== 'Assentos') continue;
    if (!best || o.t.z > best.t.z) best = o;
  }
  if (best) return { local: { x: best.t.x, y: 0, z: best.t.z, rotY: best.t.rotY }, source: 'chair', chairId: best.id };
  return { local: { ...DEFAULT_SEAT, y: 0 }, source: 'default' };
}

/** Assento fixo da mesa no mundo (posição e para onde a pessoa olha). */
export function seatWorld(byId: Map<string, SceneObject>, desk: SceneObject, assets: KindIndex): Transform {
  const anchor = seatAnchorOf(byId, desk, assets).local;
  const d = worldTransform(byId, desk.id);
  const c = Math.cos(d.rotY);
  const s = Math.sin(d.rotY);
  return { x: d.x + anchor.x * c + anchor.z * s, y: d.y, z: d.z - anchor.x * s + anchor.z * c, rotY: d.rotY + anchor.rotY };
}
