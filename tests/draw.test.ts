import { describe, expect, it } from 'vitest';
import { validateScene } from '../shared/scene';
import type { SceneObject } from '../shared/types';
import { addFloor, addOpeningAt, addWallSegment, createRoom, fitOpening, setWallEndpoints, snapDrawPoint, snapTargets, wallEndpoints } from '../src/editor/ops';

const F = 'f';
const valid = (objects: SceneObject[]) => validateScene({ schema: 1, units: 'm', floorId: F, objects }, null, F);

describe('desenho livre', () => {
  it('parede desenhada de A até B tem as pontas exatamente em A e B, em qualquer direção', () => {
    for (const [a, b] of [[{ x: 0, z: 0 }, { x: 4, z: 0 }], [{ x: 1, z: 1 }, { x: 1, z: -3 }], [{ x: -2, z: 2 }, { x: 1, z: 5 }]]) {
      const [objs, id] = addWallSegment([], F, a, b)!;
      const e = wallEndpoints(objs, id)!;
      expect(e.a.x).toBeCloseTo(a.x, 3);
      expect(e.a.z).toBeCloseTo(a.z, 3);
      expect(e.b.x).toBeCloseTo(b.x, 3);
      expect(e.b.z).toBeCloseTo(b.z, 3);
      expect(valid(objs)).toEqual([]);
    }
    expect(addWallSegment([], F, { x: 0, z: 0 }, { x: 0.05, z: 0 })).toBeNull();
  });

  it('piso desenhado ocupa exatamente o retângulo; com paredes, as 4 paredes contornam o retângulo', () => {
    const [o1, floor] = addFloor([], F, { x: 1, z: 2 }, { x: 5.5, z: -1 }, 'wood', false)!;
    const f = o1.find((o) => o.id === floor)!;
    expect([f.t.x, f.t.z, f.room!.w, f.room!.d, f.room!.floor]).toEqual([3.25, 0.5, 4.5, 3, 'wood']);
    expect(o1.length).toBe(1);
    const [o2, room] = addFloor([], F, { x: 0, z: 0 }, { x: 4, z: 3 }, 'carpet', true, { height: 3, thickness: 0.1, style: 'glass' })!;
    const walls = o2.filter((o) => o.parentId === room);
    expect(walls.length).toBe(4);
    expect(walls.every((w) => w.wall!.style === 'glass' && w.wall!.height === 3)).toBe(true);
    const corners = snapTargets(o2).map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`);
    for (const c of ['0.00,0.00', '4.00,0.00', '0.00,3.00', '4.00,3.00']) expect(corners).toContain(c);
    expect(addFloor([], F, { x: 0, z: 0 }, { x: 0.3, z: 2 }, 'wood', false)).toBeNull();
  });

  it('encaixe: ponta próxima vence a grade; sem ponta, ângulo de 45° a partir do ponto anterior', () => {
    const targets = [{ x: 2, z: 2 }];
    expect(snapDrawPoint({ x: 2.12, z: 1.9 }, { grid: 0.5, targets }).p).toEqual({ x: 2, z: 2 });
    expect(snapDrawPoint({ x: 1.13, z: 0.37 }, { grid: 0.25, targets: [] }).p).toEqual({ x: 1.25, z: 0.25 });
    const s = snapDrawPoint({ x: 3.1, z: 0.4 }, { grid: 0.5, targets: [], from: { x: 0, z: 0 }, angleSnap: true });
    expect(s.p).toEqual({ x: 3, z: 0 });
    const diag = snapDrawPoint({ x: 2.1, z: 1.9 }, { grid: 0.1, targets: [], from: { x: 0, z: 0 }, angleSnap: true }).p;
    expect(diag.x).toBeCloseTo(diag.z, 3);
  });

  it('porta e janela entram no ponto clicado, sem sair da parede nem sobrepor outro vão', () => {
    const [o1, wall] = addWallSegment([], F, { x: 0, z: 0 }, { x: 5, z: 0 })!;
    const [o2, door] = addOpeningAt(o1, F, wall, 'door', 1.0)!;
    expect(o2.find((o) => o.id === door)!.t.x).toBe(1);
    const [o3, win] = addOpeningAt(o2, F, wall, 'window', 1.2)!; // colidiria com a porta: é deslocada
    const w = o3.find((o) => o.id === win)!;
    expect(Math.abs(w.t.x - 1)).toBeGreaterThanOrEqual(0.9 / 2 + 1.6 / 2);
    expect(w.t.y).toBe(0.95);
    expect(addOpeningAt(o3, F, wall, 'door', 99)!.length).toBe(2); // ponto fora da parede: vai para a borda
    expect(fitOpening(o3, wall, 6, 0)).toBeNull(); // largura maior que a parede
    expect(valid(o3)).toEqual([]);
  });

  it('arrastar a ponta da parede mantém a outra ponta e a distância das portas à ponta parada', () => {
    const [o1, wall] = addWallSegment([], F, { x: 0, z: 0 }, { x: 4, z: 0 })!;
    const [o2, door] = addOpeningAt(o1, F, wall, 'door', -1)!; // a 1 m do início
    const o3 = setWallEndpoints(o2, wall, { x: 0, z: 0 }, { x: 6, z: 3 }, 'a');
    const e = wallEndpoints(o3, wall)!;
    expect(e.a.x).toBeCloseTo(0, 3);
    expect(e.a.z).toBeCloseTo(0, 3);
    expect(e.b.x).toBeCloseTo(6, 3);
    expect(e.b.z).toBeCloseTo(3, 3);
    const d = o3.find((o) => o.id === door)!;
    expect(d.t.x + o3.find((o) => o.id === wall)!.wall!.length / 2).toBeCloseTo(1, 3);
  });

  it('parede de sala vira parede livre ao ter a ponta arrastada (deixa de acompanhar a sala)', () => {
    const [o1, room] = createRoom([], F, { x: 2, z: 2 }, 4, 4);
    const north = o1.find((o) => o.parentId === room && o.wall?.side === 'n')!;
    const e = wallEndpoints(o1, north.id)!;
    const o2 = setWallEndpoints(o1, north.id, e.a, { x: e.b.x + 1, z: e.b.z }, 'a');
    const w = o2.find((o) => o.id === north.id)!;
    expect(w.wall!.side).toBeUndefined();
    expect(w.wall!.length).toBeCloseTo(5, 3);
    expect(wallEndpoints(o2, north.id)!.b.x).toBeCloseTo(e.b.x + 1, 3);
  });
});
