/** Vida autônoma no 3D: monta a grade de navegação a partir da cena (paredes, vãos, móveis) e os pontos de interesse. */
import { Life, type LifeAgent, type Poi } from '../../shared/life';
import { indexObjects, seatWorld, worldFootprint, worldTransform, type AssetIndex } from '../../shared/scene';
import type { AssetDefinition, SceneDoc } from '../../shared/types';
import type { LifePose } from '../three/avatar/lifeStore';
import { NavGrid } from './grid';

export const SPEED_3D = 1.1;
const CELL = 0.2;
// plano do motor: x = x do mundo, y = z do mundo; face = atan2(z, x) do vetor "para onde olha"
export const faceOfRotY = (r: number) => Math.atan2(Math.cos(r), Math.sin(r));
export const rotYOfFace = (f: number) => Math.atan2(Math.cos(f), Math.sin(f));

export interface Person3D {
  id: string;
  name: string;
  dept: string;
}

export function buildLife3D(doc: SceneDoc, assetList: AssetDefinition[], people: Person3D[], deskOwner: Record<string, string>, opts: { seed?: number } = {}): Life {
  const assets = Object.fromEntries(assetList.map((a) => [a.id, a])) as unknown as AssetIndex;
  const byId = indexObjects(doc);
  const rooms = doc.objects.filter((o) => o.kind === 'room' && o.room);
  const minX = Math.min(...rooms.map((r) => r.t.x - r.room!.w / 2)) - 1;
  const maxX = Math.max(...rooms.map((r) => r.t.x + r.room!.w / 2)) + 1;
  const minZ = Math.min(...rooms.map((r) => r.t.z - r.room!.d / 2)) - 1;
  const maxZ = Math.max(...rooms.map((r) => r.t.z + r.room!.d / 2)) + 1;
  const grid = new NavGrid(Math.ceil((maxX - minX) / CELL), Math.ceil((maxZ - minZ) / CELL), CELL, minX, minZ);
  // tudo que não é sala é bloqueado; o piso das salas é liberado
  grid.rect(minX, minZ, maxX, maxZ, 1);
  for (const r of rooms) grid.rect(r.t.x - r.room!.w / 2 + 0.05, r.t.z - r.room!.d / 2 + 0.05, r.t.x + r.room!.w / 2 - 0.05, r.t.z + r.room!.d / 2 - 0.05, 0);
  // paredes
  for (const o of doc.objects) {
    if (o.kind !== 'wall' || !o.wall) continue;
    const f = worldFootprint(o, byId, assets);
    grid.rect(f.x - f.w / 2 - 0.02, f.z - f.d / 2 - 0.02, f.x + f.w / 2 + 0.02, f.z + f.d / 2 + 0.02, 1);
  }
  // vãos de porta abrem a parede (janelas, com peitoril, não)
  for (const o of doc.objects) {
    if (o.kind !== 'opening' || !o.opening || o.opening.style === 'window') continue;
    const f = worldFootprint(o, byId, assets);
    if (f.w >= f.d) grid.rect(f.x - f.w / 2, f.z - 0.45, f.x + f.w / 2, f.z + 0.45, 0);
    else grid.rect(f.x - 0.45, f.z - f.d / 2, f.x + 0.45, f.z + f.d / 2, 0);
  }
  // móveis de piso
  for (const o of doc.objects) {
    if (!o.assetId || o.kind === 'wall' || o.kind === 'opening' || o.kind === 'room') continue;
    const a = (assets as unknown as Record<string, AssetDefinition | undefined>)[o.assetId];
    if (!a || a.mount !== 'floor' || a.category === 'Assentos' || a.height < 0.45) continue;
    const f = worldFootprint(o, byId, assets);
    if (f.y0 > 0.2) continue;
    grid.rect(f.x - f.w / 2, f.z - f.d / 2, f.x + f.w / 2, f.z + f.d / 2, 1);
  }
  grid.inflate(1);

  const agents: LifeAgent[] = people.map((p) => {
    const deskId = Object.keys(deskOwner).find((d) => deskOwner[d] === p.id);
    const desk = deskId ? byId.get(deskId) : undefined;
    let d: LifeAgent['desk'] = null;
    if (desk) {
      const w = seatWorld(byId, desk, assets as never);
      d = { at: { x: w.x, y: w.z }, face: faceOfRotY(w.rotY), seatId: desk.id };
    }
    return { id: p.id, name: p.name, dept: p.dept, desk: d };
  });

  const wt = (id: string) => worldTransform(byId, id);
  const front = (id: string, dist: number) => {
    const t = wt(id);
    const fx = Math.sin(t.rotY);
    const fz = Math.cos(t.rotY);
    return { at: { x: t.x + fx * dist, y: t.z + fz * dist }, face: Math.atan2(-fz, -fx) };
  };
  const pois: Poi[] = [];
  const add = (id: string, kind: Poi['kind'], objectId: string, dist: number) => {
    if (!byId.has(objectId)) return;
    const f = front(objectId, dist);
    pois.push({ id, kind, at: grid.snap(f.at) ?? f.at, face: f.face });
  };
  add('printer', 'printer', 'prn_at_01', 0.95);
  add('water', 'water', 'at_bebedouro', 0.8);
  add('coffee', 'coffee', 'noc_estante', 0.95);
  add('arm', 'shelf', 'at_armario', 0.85);
  add('gav', 'shelf', 'at_gaveteiro', 0.85);
  add('board', 'board', 'reu_quadro_branco', 1.0);
  add('tv1', 'screen', 'tv_noc_01', 2.4);
  add('tv2', 'screen', 'tv_noc_02', 2.4);
  for (let k = 1; k <= 6; k++) {
    const id = `reu_cadeira_${k}`;
    if (!byId.has(id)) continue;
    const t = wt(id);
    pois.push({ id: `meet${k}`, kind: 'meeting', at: { x: t.x, y: t.z }, face: faceOfRotY(t.rotY), sit: true });
  }
  if (byId.has('rec_sofa')) {
    const t = wt('rec_sofa');
    pois.push({ id: 'sofa1', kind: 'sofa', at: { x: t.x, y: t.z }, face: faceOfRotY(t.rotY), sit: true });
  }
  const entry = grid.snap({ x: 7, y: 6 }) ?? { x: 7, y: 6 };
  return new Life({ agents, pois, nav: { path: (a, b) => grid.path(a, b), snap: (p) => grid.snap(p), isFree: (p) => grid.isFree(p), speed: SPEED_3D }, spawns: [entry], chatGap: 0.95, seed: opts.seed, callDepts: ['Atendimento'] });
}

const ACT = { work: 'idle', type: 'typing', call: 'call', talk: 'talk', drink: 'drink', tool: 'tool', rest: 'idle', look: 'idle' } as const;
export function poseOf(v: { x: number; y: number; face: number; moving: boolean; sit: boolean; activity: keyof typeof ACT; speaking: boolean | null }): LifePose {
  return { x: v.x, z: v.y, rotY: rotYOfFace(v.face), mode: v.sit ? 'sit' : 'stand', activity: ACT[v.activity] ?? 'idle', speed: v.moving ? SPEED_3D : 0, speaking: v.speaking };
}
