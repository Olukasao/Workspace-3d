import { describe, expect, it } from 'vitest';
import { indexObjects, worldTransform } from '../shared/scene';
import type { AssetDefinition, SceneDoc, SceneObject } from '../shared/types';
import { addAsset, addOpening, createRoom, duplicateObjects, expandGroups, groupObjects, moveBy, removeObjects, reparent, resizeRoom, rotateBy, snapObjects, swapAsset } from '../src/editor/ops';

const asset = (id: string, p: Partial<AssetDefinition>): AssetDefinition => ({
  id, companyId: null, slug: id, name: id, category: 'x', defaultKind: 'furniture', mount: 'floor', url: '', thumbUrl: null, fileHash: '', fileBytes: 0,
  width: 1, depth: 1, height: 1, surfaceHeight: null, pivot: 'base-center', triangles: 0, license: 'CC0 1.0', author: 'a', sourceUrl: '', attribution: '', origin: 'download', version: 1, status: 'approved', ...p,
});
const A: Record<string, AssetDefinition> = {
  desk: asset('desk', { width: 1.4, depth: 0.7, height: 0.75, surfaceHeight: 0.75 }),
  monitor: asset('monitor', { width: 0.6, depth: 0.12, height: 0.37, mount: 'surface', defaultKind: 'workstation' }),
  tvA: asset('tvA', { width: 1.2, depth: 0.07, height: 0.7, mount: 'wall', pivot: 'wall-back', defaultKind: 'tv' }),
  tvB: asset('tvB', { width: 1.4, depth: 0.1, height: 0.8, mount: 'wall', pivot: 'wall-back', defaultKind: 'tv' }),
  plant: asset('plant', { defaultKind: 'decor' }),
};
const F = 'f';
const doc = (objects: SceneObject[]): SceneDoc => ({ schema: 1, units: 'm', floorId: F, objects });
const world = (objs: SceneObject[], id: string) => worldTransform(indexObjects(doc(objs)), id);

describe('inserção com encaixe', () => {
  it('monitor inserido com a mesa selecionada vira filho da mesa, sobre o tampo', () => {
    const [o1, desk] = addAsset([], F, A.desk, A, { at: { x: 2, z: 3 } });
    const [o2, mon] = addAsset(o1, F, A.monitor, A, { at: { x: 0, z: 0 }, selectedId: desk });
    const m = o2.find((o) => o.id === mon)!;
    expect(m.parentId).toBe(desk);
    expect(m.t.y).toBe(0.75);
    expect(m.kind).toBe('workstation');
  });

  it('monitor inserido sobre o ponto de uma mesa (sem seleção) também pousa nela', () => {
    const [o1, desk] = addAsset([], F, A.desk, A, { at: { x: 2, z: 3 } });
    const [o2, mon] = addAsset(o1, F, A.monitor, A, { at: { x: 2.2, z: 3.1 } });
    expect(o2.find((o) => o.id === mon)!.parentId).toBe(desk);
  });

  it('item de parede vai para a parede mais próxima', () => {
    const [o1] = createRoom([], F, { x: 0, z: 0 }, 6, 4);
    const [o2, tv] = addAsset(o1, F, A.tvA, A, { at: { x: 0, z: -1.8 } });
    const t = o2.find((o) => o.id === tv)!;
    expect(o2.find((o) => o.id === t.parentId)!.wall!.side).toBe('n');
  });
});

describe('edição', () => {
  it('mover a mesa leva o monitor; o monitor mantém a posição local', () => {
    const [o1, desk] = addAsset([], F, A.desk, A, { at: { x: 0, z: 0 } });
    const [o2, mon] = addAsset(o1, F, A.monitor, A, { at: { x: 0, z: 0 }, selectedId: desk });
    const before = world(o2, mon);
    const o3 = moveBy(o2, [desk, mon], 1.5, -0.5);
    const after = world(o3, mon);
    expect(after.x - before.x).toBeCloseTo(1.5);
    expect(after.z - before.z).toBeCloseTo(-0.5);
    expect(o3.find((o) => o.id === mon)!.t).toEqual(o2.find((o) => o.id === mon)!.t);
  });

  it('duplicar copia descendentes com IDs novos e sem herdar bloqueio', () => {
    const [o1, desk] = addAsset([], F, A.desk, A, { at: { x: 0, z: 0 } });
    const [o2] = addAsset(o1, F, A.monitor, A, { at: { x: 0, z: 0 }, selectedId: desk });
    const locked = o2.map((o) => (o.id === desk ? { ...o, locked: true } : o));
    const [o3, [copy]] = duplicateObjects(locked, [desk]);
    expect(o3.length).toBe(4);
    expect(copy).not.toBe(desk);
    expect(o3.filter((o) => o.parentId === copy).length).toBe(1);
    expect(o3.find((o) => o.id === copy)!.locked).toBe(false);
  });

  it('bloqueado não é removido, nem movido, nem girado; filhos de bloqueado também ficam', () => {
    const [o1, desk] = addAsset([], F, A.desk, A, { at: { x: 0, z: 0 } });
    const [o2, mon] = addAsset(o1, F, A.monitor, A, { at: { x: 0, z: 0 }, selectedId: desk });
    const locked = o2.map((o) => (o.id === desk ? { ...o, locked: true } : o));
    expect(removeObjects(locked, [desk, mon])[1]).toEqual([]);
    expect(moveBy(locked, [desk], 1, 1)).toEqual(locked);
    expect(rotateBy(locked, [mon], 1)).toEqual(locked);
  });

  it('remover a mesa remove o que está sobre ela', () => {
    const [o1, desk] = addAsset([], F, A.desk, A, { at: { x: 0, z: 0 } });
    const [o2] = addAsset(o1, F, A.monitor, A, { at: { x: 0, z: 0 }, selectedId: desk });
    expect(removeObjects(o2, [desk])[0]).toEqual([]);
  });

  it('trocar o modelo preserva ID e tipo funcional', () => {
    const [o1] = createRoom([], F, { x: 0, z: 0 });
    const [o2, tv] = addAsset(o1, F, A.tvA, A, { at: { x: 0, z: -2 } });
    const o3 = swapAsset(o2, tv, A.tvB);
    const t = o3.find((o) => o.id === tv)!;
    expect(t.assetId).toBe('tvB');
    expect(t.kind).toBe('tv');
    expect(swapAsset(o3, tv, A.plant).find((o) => o.id === tv)!.kind).toBe('tv');
  });

  it('reparent recusa ciclo e preserva a posição no mundo', () => {
    const [o1, a] = addAsset([], F, A.desk, A, { at: { x: 1, z: 1 } });
    const [o2, b] = addAsset(o1, F, A.monitor, A, { at: { x: 0, z: 0 }, selectedId: a });
    expect(reparent(o2, a, b)).toBeNull();
    const w = world(o2, b);
    const o3 = reparent(o2, b, null)!;
    expect(world(o3, b).x).toBeCloseTo(w.x);
    expect(world(o3, b).z).toBeCloseTo(w.z);
  });

  it('agrupar expande a seleção para o grupo; alinhar à grade arredonda a posição', () => {
    const [o1, a] = addAsset([], F, A.plant, A, { at: { x: 1.03, z: 1.07 } });
    const [o2, b] = addAsset(o1, F, A.plant, A, { at: { x: 3, z: 3 } });
    const [o3] = groupObjects(o2, [a, b]);
    expect(expandGroups(o3, [a]).sort()).toEqual([a, b].sort());
    const moved = moveBy(o3, [a], 0.013, 0.021);
    const snapped = snapObjects(moved, [a], 0.1);
    const p = snapped.find((o) => o.id === a)!.t;
    expect([p.x, p.z]).toEqual([1.1, 1.1]);
  });
});

describe('estrutura', () => {
  it('sala nova tem 4 paredes filhas que acompanham o redimensionamento', () => {
    const [o1, room] = createRoom([], F, { x: 0, z: 0 }, 5, 4);
    expect(o1.filter((o) => o.parentId === room && o.kind === 'wall').length).toBe(4);
    const o2 = resizeRoom(o1, room, 8, 6);
    const n = o2.find((o) => o.parentId === room && o.wall?.side === 'n')!;
    expect(n.wall!.length).toBe(8);
    expect(n.t.z).toBe(-3);
  });

  it('portas e janelas ocupam trechos livres e falham quando a parede está cheia', () => {
    const [o1, room] = createRoom([], F, { x: 0, z: 0 }, 5, 5);
    const wall = o1.find((o) => o.parentId === room && o.wall?.side === 's')!.id;
    let objs = o1;
    const placed: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = addOpening(objs, F, wall, 'door');
      if (!r) break;
      objs = r[0];
      placed.push(objs.find((o) => o.id === r[1])!.t.x);
    }
    expect(placed.length).toBeGreaterThanOrEqual(2);
    expect(placed.length).toBeLessThan(5);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(Math.abs(placed[i] - placed[j])).toBeGreaterThanOrEqual(0.9);
  });
});
