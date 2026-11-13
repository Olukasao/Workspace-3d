import { describe, expect, it } from 'vitest';
import { ASSET_BY_ID, ASSETS, FLOORS, TILE, blockedGrid, findPath, footprintCells, gridOf, layoutToTiled, nearestFree, seatOfObject, validateLayout, walkable, type Layout2D, type Obj2D } from '../shared/office2d';
import { defaultLayout2D } from '../shared/office2dDefault';
import { PALETTE2D, defaultAvatar2D, validateAvatar2D } from '../shared/avatar2d';

const clone = (l: Layout2D): Layout2D => JSON.parse(JSON.stringify(l));
const errs = (raw: unknown) => validateLayout(raw).errors.join(' | ');

describe('escritório 2D padrão', () => {
  const layout = defaultLayout2D();
  it('é um layout válido, com 12 estações, entradas livres e todas as salas', () => {
    const r = validateLayout(layout);
    expect(r.errors).toEqual([]);
    expect(layout.stations).toHaveLength(12);
    expect(layout.rooms.map((x) => x.name)).toEqual(['Sala de reunião', 'Recepção', 'Atendimento', 'Copa e descanso']);
  });
  it('toda estação tem o lugar de sentar livre, de frente para a mesa', () => {
    const g = gridOf(layout);
    for (const st of layout.stations) {
      const o = layout.objects.find((x) => x.id === st.objectId)!;
      const seat = seatOfObject(o)!;
      expect(g.blocked[seat.cy * layout.cols + seat.cx], st.id).toBe(0);
      expect(seat.dir).toBe('up'); // mesa ao norte, a pessoa vira para ela
    }
  });
  it('as paredes e os móveis bloqueiam; o resto do prédio é andável; as entradas chegam às 12 estações', () => {
    const g = gridOf(layout);
    expect(walkable(g, 9 * TILE + 16, 24 * TILE + 16)).toBe(true); // entrada
    expect(walkable(g, 2 * TILE + 16, 5 * TILE)).toBe(false); // parede externa
    const desk = layout.objects.find((o) => o.asset === 'desk_pc')!;
    expect(walkable(g, desk.x * TILE + 16, desk.y * TILE + 16)).toBe(false); // sobre a mesa
    for (const st of layout.stations) {
      const seat = seatOfObject(layout.objects.find((o) => o.id === st.objectId)!)!;
      expect(findPath(g, layout.spawns[0], { x: seat.cx, y: seat.cy }).length, st.id).toBeGreaterThan(0);
    }
  });
});

describe('móveis: pegada, giro e lugar de sentar', () => {
  it('a pegada gira com o móvel e o lugar da mesa acompanha o giro', () => {
    const desk: Obj2D = { id: 'd', asset: 'desk_pc', x: 10, y: 10, rot: 0 };
    const a = ASSET_BY_ID.get('desk_pc')!;
    expect(footprintCells(a, desk).map((c) => `${c.x},${c.y}`)).toEqual(['10,10', '11,10']);
    expect(footprintCells(a, { ...desk, rot: 1 }).map((c) => `${c.x},${c.y}`)).toEqual(['10,10', '10,11']);
    expect(seatOfObject(desk)).toMatchObject({ cx: 10, cy: 11, dir: 'up' }); // à frente (sul), virado para a mesa
    expect(seatOfObject({ ...desk, rot: 1 })).toMatchObject({ cx: 9, cy: 10, dir: 'right' }); // girada: lugar a oeste, virado a leste
    expect(seatOfObject({ ...desk, rot: 2 })).toMatchObject({ cx: 11, cy: 9, dir: 'down' });
    expect(seatOfObject({ ...desk, rot: 3 })).toMatchObject({ cx: 11, cy: 11, dir: 'left' });
    expect(seatOfObject({ id: 'x', asset: 'plant', x: 1, y: 1, rot: 0 })).toBeNull();
  });
  it('o catálogo tem ids únicos e só os móveis certos bloqueiam', () => {
    expect(new Set(ASSETS.map((a) => a.id)).size).toBe(ASSETS.length);
    expect(ASSET_BY_ID.get('chair')!.blocks).toBe(false);
    expect(ASSET_BY_ID.get('rug')!.flat).toBe(true);
    expect(FLOORS.length).toBeGreaterThanOrEqual(8);
  });
});

describe('validação estrita do layout (o servidor não confia no cliente)', () => {
  const base = defaultLayout2D();
  it('recusa campos desconhecidos, tamanhos absurdos e listas do tamanho errado', () => {
    expect(errs({ ...base, script: 'x' })).toMatch(/desconhecidos/);
    expect(errs({ ...base, cols: 5 })).toMatch(/8 a 120/);
    expect(errs({ ...base, cols: 500 })).toMatch(/8 a 120/);
    expect(errs({ ...base, floor: [1, 2, 3] })).toMatch(/Piso/);
    expect(errs({ ...base, walls: base.walls.map(() => 2) })).toMatch(/Paredes/);
    expect(errs(null)).toMatch(/ausente/);
    expect(errs({ ...base, v: 2 })).toMatch(/Versão/);
  });
  it('recusa móvel fora do catálogo, giro de móvel que não gira, objeto repetido e fora do mapa', () => {
    const add = (o: Partial<Obj2D>) => ({ ...clone(base), objects: [...clone(base).objects, { id: 'novo', asset: 'plant', x: 20, y: 20, rot: 0, ...o }] });
    expect(errs(add({ asset: 'bomba' }))).toMatch(/fora do catálogo/);
    expect(errs(add({ rot: 1 }))).toMatch(/não gira/);
    expect(errs(add({ id: 'o1' }))).toMatch(/repetido/);
    expect(errs(add({ x: 99 }))).toMatch(/Posição/);
    expect(errs(add({ id: '../x' }))).toMatch(/Identificador/);
  });
  it('recusa móvel sobre parede, fora do prédio ou sobre outro móvel que bloqueia', () => {
    const l = clone(base);
    l.objects.push({ id: 'p1', asset: 'plant', x: 2, y: 5, rot: 0 }); // parede externa
    expect(errs(l)).toMatch(/sobre uma parede/);
    const l2 = clone(base);
    l2.objects.push({ id: 'p2', asset: 'plant', x: 0, y: 0, rot: 0 }); // fora do prédio
    expect(errs(l2)).toMatch(/fora do prédio/);
    const l3 = clone(base);
    const desk = l3.objects.find((o) => o.asset === 'desk_pc')!;
    l3.objects.push({ id: 'p3', asset: 'cabinet', x: desk.x, y: desk.y, rot: 0 });
    expect(errs(l3)).toMatch(/se sobrepõe/);
  });
  it('estação: precisa de mesa com lugar, e o lugar não pode estar bloqueado', () => {
    const l = clone(base);
    l.stations.push({ id: 'ruim', objectId: l.objects.find((o) => o.asset === 'plant')!.id });
    expect(errs(l)).toMatch(/mesa com lugar/);
    const l2 = clone(base);
    const desk = l2.objects.find((o) => o.asset === 'desk_pc')!;
    const seat = seatOfObject(desk)!;
    l2.objects.push({ id: 'bloq', asset: 'cabinet', x: seat.cx, y: seat.cy, rot: 0 });
    expect(errs(l2)).toMatch(/bloqueado/);
    const l3 = clone(base);
    l3.stations.push({ id: 'dup', objectId: l3.stations[0].objectId });
    expect(errs(l3)).toMatch(/repetida/);
  });
  it('entrada num lugar bloqueado e mapa sem entrada são recusados', () => {
    const l = clone(base);
    l.spawns = [{ id: 'e', x: 2, y: 5 }];
    expect(errs(l)).toMatch(/bloqueado/);
    expect(errs({ ...clone(base), spawns: [] })).toMatch(/entrada/);
  });
});

describe('caminho e reposicionamento', () => {
  const l = defaultLayout2D();
  const g = gridOf(l);
  it('o caminho contorna paredes e móveis, e é vazio para destino bloqueado', () => {
    const path = findPath(g, { x: 9, y: 24 }, { x: 20, y: 6 });
    expect(path.length).toBeGreaterThan(10);
    for (const c of path) expect(g.blocked[c.y * l.cols + c.x]).toBe(0);
    expect(path.at(-1)).toEqual({ x: 20, y: 6 });
    expect(findPath(g, { x: 9, y: 24 }, { x: 2, y: 5 })).toEqual([]); // parede
    expect(findPath(g, { x: 9, y: 24 }, { x: 9, y: 24 })).toEqual([]);
  });
  it('nearestFree acha a célula livre mais próxima de um lugar bloqueado', () => {
    const wall = { x: 2, y: 5 };
    const free = nearestFree(g, wall.x, wall.y)!;
    expect(g.blocked[free.y * l.cols + free.x]).toBe(0);
    expect(Math.max(Math.abs(free.x - wall.x), Math.abs(free.y - wall.y))).toBeLessThanOrEqual(2);
    expect(blockedGrid(l).length).toBe(l.cols * l.rows);
  });
});

describe('exportação para o Tiled', () => {
  it('gera camadas de piso, paredes, colisão, objetos e entradas no formato do Tiled', () => {
    const l = defaultLayout2D();
    const t = layoutToTiled(l);
    expect(t.orientation).toBe('orthogonal');
    expect(t.width).toBe(l.cols);
    expect(t.layers.map((x) => x.name)).toEqual(['piso', 'paredes', 'colisao', 'objetos', 'entradas']);
    const walls = t.layers[1] as { data: number[] };
    expect(walls.data).toHaveLength(l.cols * l.rows);
    expect(Math.max(...walls.data)).toBeLessThanOrEqual(t.tilesets[0].tilecount);
    expect((t.layers[3] as { objects: unknown[] }).objects).toHaveLength(l.objects.length);
  });
});

describe('avatar 2D', () => {
  it('o padrão é válido, estável por pessoa e variado entre pessoas', () => {
    const a = defaultAvatar2D('emp_otavio');
    expect(validateAvatar2D(a)).toEqual([]);
    expect(defaultAvatar2D('emp_otavio')).toEqual(a);
    const looks = new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(defaultAvatar2D(`emp_${i}`))));
    expect(looks.size).toBeGreaterThan(20);
  });
  it('recusa itens fora da lista, cores inválidas e campos desconhecidos', () => {
    const a = defaultAvatar2D('x');
    expect(validateAvatar2D({ ...a, hair: 'mohawk-do-mal' }).join(' ')).toMatch(/Cabelo/);
    expect(validateAvatar2D({ ...a, shirtColor: 'azul' }).join(' ')).toMatch(/shirtColor/);
    expect(validateAvatar2D({ ...a, glasses: 'sim' }).join(' ')).toMatch(/glasses/);
    expect(validateAvatar2D({ ...a, extra: 1 }).join(' ')).toMatch(/desconhecidos/);
    expect(validateAvatar2D({ ...a, skin: 'x' }).join(' ')).toMatch(/Pele/);
    expect(validateAvatar2D({ ...a, hairColor: PALETTE2D.hair[0] })).toEqual([]);
  });
});
