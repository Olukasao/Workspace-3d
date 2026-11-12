import { describe, expect, it } from 'vitest';
import { collisionWarnings, descendants, indexObjects, roomAt, toLocal, validateScene, worldTransform, wouldCreateCycle, type AssetIndex } from '../shared/scene';
import { buildSeedScene } from '../shared/seedScene';
import type { SceneDoc, SceneObject } from '../shared/types';

const assets: AssetIndex = {
  desk: { id: 'desk', width: 1.4, depth: 0.7, height: 0.75, surfaceHeight: 0.75, mount: 'floor', defaultKind: 'furniture', pivot: 'base-center' },
  monitor: { id: 'monitor', width: 0.6, depth: 0.12, height: 0.37, surfaceHeight: null, mount: 'surface', defaultKind: 'workstation', pivot: 'base-center' },
};
const obj = (id: string, assetId: string, x: number, z: number, extra: Partial<SceneObject> = {}): SceneObject => ({ id, kind: 'furniture', name: id, assetId, floorId: 'f', t: { x, y: 0, z, rotY: 0 }, ...extra });
const doc = (...objects: SceneObject[]): SceneDoc => ({ schema: 1, units: 'm', floorId: 'f', objects });

describe('hierarquia e transformações', () => {
  it('o computador acompanha a mesa: mover ou girar o pai muda a posição do filho no mundo', () => {
    const d = doc(obj('mesa', 'desk', 2, 3), obj('pc', 'monitor', 0.5, 0, { parentId: 'mesa', t: { x: 0.5, y: 0.75, z: 0, rotY: 0 } }));
    let w = worldTransform(indexObjects(d), 'pc');
    expect([w.x, w.y, w.z]).toEqual([2.5, 0.75, 3]);
    d.objects[0].t = { x: 5, y: 0, z: 1, rotY: Math.PI / 2 };
    w = worldTransform(indexObjects(d), 'pc');
    expect(w.x).toBeCloseTo(5);
    expect(w.z).toBeCloseTo(0.5); // +X local vira -Z no mundo com 90° em Y
    expect(w.rotY).toBeCloseTo(Math.PI / 2);
  });

  it('toLocal é a inversa de worldTransform', () => {
    const parent = { x: 3, y: 0, z: -2, rotY: 0.7 };
    const d = doc(obj('mesa', 'desk', 0, 0, { t: parent }), obj('pc', 'monitor', 0, 0, { parentId: 'mesa', t: { x: 0.3, y: 0.75, z: -0.2, rotY: 0.2 } }));
    const world = worldTransform(indexObjects(d), 'pc');
    const local = toLocal(world, parent);
    expect(local.x).toBeCloseTo(0.3);
    expect(local.z).toBeCloseTo(-0.2);
    expect(local.rotY).toBeCloseTo(0.2);
  });

  it('detecta ciclos de parentesco antes de aplicar', () => {
    const d = doc(obj('a', 'desk', 0, 0), obj('b', 'desk', 0, 0, { parentId: 'a' }), obj('c', 'desk', 0, 0, { parentId: 'b' }));
    expect(wouldCreateCycle(d, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(d, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(d, 'c', 'a')).toBe(false);
    expect(descendants(d, 'a').map((o) => o.id).sort()).toEqual(['b', 'c']);
  });
});

describe('validação da cena', () => {
  it('a cena inicial é válida e cobre o briefing (≥ 6 postos, 1 impressora, 2 TVs, 4 salas)', () => {
    const d = buildSeedScene('f');
    expect(validateScene(d, null, 'f')).toEqual([]);
    const count = (k: string) => d.objects.filter((o) => o.kind === k).length;
    expect(count('workstation')).toBeGreaterThanOrEqual(6);
    expect(count('printer')).toBeGreaterThanOrEqual(1);
    expect(count('tv')).toBeGreaterThanOrEqual(2);
    expect(d.objects.filter((o) => o.kind === 'room').map((o) => o.name)).toEqual(['Recepção', 'Atendimento', 'Sala de reunião', 'NOC']);
  });

  it('recusa ciclo, pai inexistente, asset desconhecido, id repetido e coordenada inválida', () => {
    const cyc = doc(obj('a', 'desk', 0, 0, { parentId: 'b' }), obj('b', 'desk', 0, 0, { parentId: 'a' }));
    expect(validateScene(cyc, assets).join(' ')).toMatch(/ciclo/);
    expect(validateScene(doc(obj('a', 'desk', 0, 0, { parentId: 'zzz' })), assets).join(' ')).toMatch(/não existe/);
    expect(validateScene(doc(obj('a', 'nope', 0, 0)), assets).join(' ')).toMatch(/não existe no catálogo/);
    expect(validateScene(doc(obj('a', 'desk', 0, 0), obj('a', 'desk', 1, 1)), assets).join(' ')).toMatch(/repetido/);
    expect(validateScene(doc(obj('a', 'desk', Number.NaN, 0)), assets).join(' ')).toMatch(/posição inválida/);
    expect(validateScene({ schema: 1, units: 'm', floorId: 'outro', objects: [] }, assets, 'f').join(' ')).toMatch(/outro andar/);
  });

  it('porta/janela só existe dentro de uma parede', () => {
    const d = doc({ id: 'p', kind: 'opening', name: 'porta', floorId: 'f', t: { x: 0, y: 0, z: 0, rotY: 0 }, opening: { width: 0.9, height: 2.1, style: 'door' } });
    expect(validateScene(d, assets).join(' ')).toMatch(/precisa estar em uma parede/);
  });
});

describe('colisões e salas', () => {
  it('sobreposição vira aviso, mas pai e filho (monitor sobre a mesa) não contam', () => {
    const d = doc(obj('m1', 'desk', 0, 0), obj('m2', 'desk', 0.5, 0.2), obj('pc', 'monitor', 0, 0, { parentId: 'm1', t: { x: 0, y: 0.75, z: 0, rotY: 0 } }), obj('longe', 'desk', 6, 6));
    const w = collisionWarnings(d, assets);
    expect(w).toEqual([{ a: 'm1', b: 'm2' }]);
  });

  it('roomAt encontra a sala que contém o ponto', () => {
    const d = buildSeedScene('f');
    expect(roomAt(d, 3, 3.5)?.name).toBe('Atendimento');
    expect(roomAt(d, -6.5, -3.5)?.name).toBe('Sala de reunião');
    expect(roomAt(d, 50, 50)).toBeNull();
  });
});
