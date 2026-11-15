/** Vida autônoma no 2D: usa a grade do próprio layout (paredes e móveis) e os móveis do escritório como pontos de interesse. */
import { Life, type LifeAgent, type Poi, type PoiKind } from '../../shared/life';
import { ASSET_BY_ID, TILE, blockedGrid, footprintSize, looseSeats, seatPointOf, type Dir, type Layout2D } from '../../shared/office2d';
import { NavGrid } from './grid';

export const SPEED_2D = 78;

const DIR_ANGLE: Record<Dir, number> = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
export const angleOfDir = (d: Dir) => DIR_ANGLE[d];
export function dirOfAngle(a: number): Dir {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return Math.abs(c) > Math.abs(s) ? (c > 0 ? 'right' : 'left') : s > 0 ? 'down' : 'up';
}

export interface Person2D {
  id: string;
  name: string;
  dept: string;
  stationId: string | null;
}

export function buildLife2D(layout: Layout2D, people: Person2D[], opts: { seed?: number } = {}): { life: Life; grid: NavGrid } {
  const grid = new NavGrid(layout.cols, layout.rows, TILE, 0, 0);
  grid.blocked.set(blockedGrid(layout));
  const agents: LifeAgent[] = people.map((p) => {
    const sp = p.stationId ? seatPointOf(layout, p.stationId) : null;
    return { id: p.id, name: p.name, dept: p.dept, desk: sp && p.stationId ? { at: { x: sp.x, y: sp.y }, face: angleOfDir(sp.dir), seatId: p.stationId } : null };
  });

  const pois: Poi[] = [];
  const objOf = (id: string) => layout.objects.find((o) => o.id === id);
  /** ponto em pé à frente (abaixo) do móvel, `gap` células depois da borda inferior */
  const below = (id: string, gap: number, face: Dir = 'up') => {
    const o = objOf(id);
    const a = o && ASSET_BY_ID.get(o.asset);
    if (!o || !a) return null;
    const size = footprintSize(a, o.rot);
    const c = { x: (o.x + (size.w - 1) / 2 + 0.5) * TILE, y: (o.y + size.h - 1 + gap + 0.5) * TILE };
    return { at: grid.snap(c) ?? c, face: angleOfDir(face) };
  };
  for (const o of layout.objects) {
    const kind = ({ printer: 'printer', coffee: 'coffee', cooler: 'water', bookshelf: 'shelf', cabinet: 'shelf', whiteboard: 'board', tv: 'screen' } as Record<string, PoiKind>)[o.asset];
    if (!kind) continue;
    const b = below(o.id, kind === 'screen' ? 3 : 1);
    if (b) pois.push({ id: o.id, kind, at: b.at, face: b.face });
  }
  // cadeiras soltas: as da sala de reunião e as da copa viram assentos
  const meetRoom = layout.rooms.find((r) => /reuni/i.test(r.name));
  const inRoom = (c: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) => c.x >= r.x * TILE && c.x < (r.x + r.w) * TILE && c.y >= r.y * TILE && c.y < (r.y + r.h) * TILE;
  for (const s of looseSeats(layout)) {
    const kind = meetRoom && inRoom(s, meetRoom) ? 'meeting' : 'sofa';
    pois.push({ id: s.id, kind, at: { x: s.x, y: s.y }, face: angleOfDir(s.dir), sit: true });
  }
  const spawns = layout.spawns.map((s) => ({ x: (s.x + 0.5) * TILE, y: (s.y + 0.5) * TILE }));
  const life = new Life({ agents, pois, nav: { path: (a, b) => grid.path(a, b), snap: (p) => grid.snap(p), isFree: (p) => grid.isFree(p), speed: SPEED_2D }, spawns, chatGap: TILE * 1.3, seed: opts.seed, callDepts: ['Atendimento'] });
  return { life, grid };
}
