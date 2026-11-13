/**
 * Escritório 2D: modelo do layout, catálogo de móveis, grade de colisão, busca de caminho e validação estrita.
 * Usado pelo servidor (valida o layout publicado e as movimentações) e pelo cliente (Phaser e editor).
 * Unidades: células de TILE px. Coordenadas de células começam no canto superior esquerdo.
 */
export const TILE = 32;
export const MAX_COLS = 120;
export const MAX_ROWS = 120;
export const MAX_OBJECTS = 1500;

export type Dir = 'down' | 'left' | 'right' | 'up';
export const DIRS: readonly Dir[] = ['down', 'left', 'right', 'up'];
/** Girar 90° no sentido horário: de frente (baixo) → esquerda → cima → direita. */
const CW: Record<Dir, Dir> = { down: 'left', left: 'up', up: 'right', right: 'down' };
export const rotateDir = (d: Dir, rot: number): Dir => {
  let out = d;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) out = CW[out];
  return out;
};

// ---------- pisos ----------
export interface FloorDef { id: number; name: string }
/** 0 = vazio (fora do prédio, não anda). */
export const FLOORS: readonly FloorDef[] = [
  { id: 1, name: 'Madeira' }, { id: 2, name: 'Carpete azul' }, { id: 3, name: 'Carpete cinza' }, { id: 4, name: 'Cerâmica clara' },
  { id: 5, name: 'Cerâmica xadrez' }, { id: 6, name: 'Concreto' }, { id: 7, name: 'Carpete vinho' }, { id: 8, name: 'Grama' },
];
export const FLOOR_IDS = FLOORS.map((f) => f.id);

// ---------- móveis ----------
export type AssetCategory = 'Mesas' | 'Cadeiras' | 'Tecnologia' | 'Descanso' | 'Reunião' | 'Recepção' | 'Decoração' | 'Armários';
export interface AssetDef {
  id: string;
  name: string;
  category: AssetCategory;
  /** pegada em células (sem girar) */
  w: number;
  h: number;
  /** altura do desenho acima da pegada, em células (monitor, encosto, copa da planta...) */
  tall: number;
  blocks: boolean;
  rotatable: boolean;
  /** ponto onde a pessoa senta, relativo à pegada sem girar (a célula costuma ficar logo à frente do móvel) */
  seat?: { dx: number; dy: number; dir: Dir };
  /** móvel desenhado no chão (tapete): fica abaixo de tudo */
  flat?: boolean;
}

export const ASSETS: readonly AssetDef[] = [
  { id: 'desk_pc', name: 'Mesa com computador', category: 'Mesas', w: 2, h: 1, tall: 1, blocks: true, rotatable: true, seat: { dx: 0, dy: 1, dir: 'up' } },
  { id: 'desk', name: 'Mesa simples', category: 'Mesas', w: 2, h: 1, tall: 0, blocks: true, rotatable: true },
  { id: 'desk_l', name: 'Mesa de canto', category: 'Mesas', w: 2, h: 2, tall: 1, blocks: true, rotatable: true },
  { id: 'round_table', name: 'Mesa redonda', category: 'Reunião', w: 2, h: 2, tall: 0, blocks: true, rotatable: false },
  { id: 'meeting_table', name: 'Mesa de reunião', category: 'Reunião', w: 4, h: 2, tall: 0, blocks: true, rotatable: true },
  { id: 'reception_desk', name: 'Balcão de recepção', category: 'Recepção', w: 3, h: 1, tall: 1, blocks: true, rotatable: true, seat: { dx: 1, dy: -1, dir: 'down' } },
  { id: 'chair', name: 'Cadeira de escritório', category: 'Cadeiras', w: 1, h: 1, tall: 1, blocks: false, rotatable: true },
  { id: 'armchair', name: 'Poltrona', category: 'Descanso', w: 1, h: 1, tall: 1, blocks: false, rotatable: true, seat: { dx: 0, dy: 0, dir: 'down' } },
  { id: 'sofa', name: 'Sofá', category: 'Descanso', w: 2, h: 1, tall: 1, blocks: false, rotatable: true, seat: { dx: 0, dy: 0, dir: 'down' } },
  { id: 'pc', name: 'Computador', category: 'Tecnologia', w: 1, h: 1, tall: 1, blocks: true, rotatable: true },
  { id: 'printer', name: 'Impressora', category: 'Tecnologia', w: 1, h: 1, tall: 0, blocks: true, rotatable: false },
  { id: 'server_rack', name: 'Rack de servidores', category: 'Tecnologia', w: 1, h: 1, tall: 1, blocks: true, rotatable: false },
  { id: 'tv', name: 'TV de parede', category: 'Tecnologia', w: 2, h: 1, tall: 1, blocks: true, rotatable: false },
  { id: 'whiteboard', name: 'Quadro branco', category: 'Reunião', w: 2, h: 1, tall: 1, blocks: true, rotatable: false },
  { id: 'coffee', name: 'Máquina de café', category: 'Descanso', w: 1, h: 1, tall: 1, blocks: true, rotatable: false },
  { id: 'cooler', name: 'Bebedouro', category: 'Descanso', w: 1, h: 1, tall: 1, blocks: true, rotatable: false },
  { id: 'rug', name: 'Tapete', category: 'Decoração', w: 3, h: 2, tall: 0, blocks: false, rotatable: false, flat: true },
  { id: 'plant', name: 'Planta', category: 'Decoração', w: 1, h: 1, tall: 1, blocks: true, rotatable: false },
  { id: 'plant_big', name: 'Planta grande', category: 'Decoração', w: 1, h: 1, tall: 2, blocks: true, rotatable: false },
  { id: 'painting', name: 'Quadro decorativo', category: 'Decoração', w: 1, h: 1, tall: 0, blocks: false, rotatable: false },
  { id: 'bookshelf', name: 'Estante de livros', category: 'Armários', w: 2, h: 1, tall: 1, blocks: true, rotatable: false },
  { id: 'cabinet', name: 'Armário', category: 'Armários', w: 1, h: 1, tall: 1, blocks: true, rotatable: false },
  { id: 'filing', name: 'Arquivo', category: 'Armários', w: 1, h: 1, tall: 0, blocks: true, rotatable: false },
];
export const ASSET_BY_ID = new Map(ASSETS.map((a) => [a.id, a]));
export const ASSET_CATEGORIES: readonly AssetCategory[] = ['Mesas', 'Cadeiras', 'Tecnologia', 'Reunião', 'Recepção', 'Descanso', 'Armários', 'Decoração'];

// ---------- layout ----------
export interface Obj2D { id: string; asset: string; x: number; y: number; rot: 0 | 1 | 2 | 3 }
export interface Room2D { id: string; name: string; x: number; y: number; w: number; h: number }
export interface Spawn2D { id: string; x: number; y: number }
/** Estação de trabalho: uma mesa que tem lugar para sentar (`seat` do móvel). A pessoa vinculada vem de outra tabela. */
export interface Station2D { id: string; objectId: string }
export interface Layout2D {
  v: 1;
  cols: number;
  rows: number;
  /** id do piso por célula (0 = vazio), em linhas */
  floor: number[];
  /** 1 = parede */
  walls: number[];
  objects: Obj2D[];
  rooms: Room2D[];
  spawns: Spawn2D[];
  stations: Station2D[];
}

export const idx = (l: { cols: number }, x: number, y: number) => y * l.cols + x;
export const inBounds = (l: { cols: number; rows: number }, x: number, y: number) => x >= 0 && y >= 0 && x < l.cols && y < l.rows;

/** Pegada de um móvel em células depois de girar (cada 90° troca largura e altura). */
export function footprintSize(a: AssetDef, rot: number): { w: number; h: number } {
  return rot % 2 === 0 ? { w: a.w, h: a.h } : { w: a.h, h: a.w };
}

/** Gira uma célula (dx, dy) dentro da pegada w×h, no sentido horário, `rot` vezes. */
function rotCell(dx: number, dy: number, w: number, h: number, rot: number) {
  let [x, y, ww, hh] = [dx, dy, w, h];
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) {
    [x, y] = [hh - 1 - y, x];
    [ww, hh] = [hh, ww];
  }
  return { x, y };
}

export function footprintCells(a: AssetDef, o: Pick<Obj2D, 'x' | 'y' | 'rot'>): Array<{ x: number; y: number }> {
  const { w, h } = footprintSize(a, o.rot);
  const out: Array<{ x: number; y: number }> = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: o.x + dx, y: o.y + dy });
  return out;
}

/** Onde a pessoa senta neste móvel (centro da célula, em pixels) e para onde fica virada; null se o móvel não tem lugar. */
export function seatOfObject(o: Obj2D): { cx: number; cy: number; x: number; y: number; dir: Dir } | null {
  const a = ASSET_BY_ID.get(o.asset);
  if (!a?.seat) return null;
  const rot = o.rot;
  // a célula do lugar pode estar fora da pegada (à frente da mesa): gira em torno do canto da pegada
  const r = rotCell(a.seat.dx, a.seat.dy, a.w, a.h, rot);
  const size = footprintSize(a, rot);
  let { x: dx, y: dy } = r;
  if (a.seat.dy >= a.h || a.seat.dy < 0 || a.seat.dx >= a.w || a.seat.dx < 0) {
    // fora da pegada: gira o vetor a partir do centro da borda da frente
    const vec = rotVec(a.seat.dx - (a.w - 1) / 2, a.seat.dy - (a.h - 1) / 2, rot);
    dx = Math.round((size.w - 1) / 2 + vec.x);
    dy = Math.round((size.h - 1) / 2 + vec.y);
  }
  const cx = o.x + dx;
  const cy = o.y + dy;
  return { cx, cy, x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2, dir: rotateDir(a.seat.dir, rot) };
}
function rotVec(x: number, y: number, rot: number) {
  let [vx, vy] = [x, y];
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) [vx, vy] = [-vy, vx];
  return { x: vx, y: vy };
}

/** Grade de colisão: 1 = bloqueado (fora do prédio, parede ou móvel que bloqueia). */
export function blockedGrid(l: Layout2D): Uint8Array {
  const g = new Uint8Array(l.cols * l.rows);
  for (let i = 0; i < g.length; i++) if (l.floor[i] === 0 || l.walls[i] === 1) g[i] = 1;
  for (const o of l.objects) {
    const a = ASSET_BY_ID.get(o.asset);
    if (!a?.blocks) continue;
    for (const c of footprintCells(a, o)) if (inBounds(l, c.x, c.y)) g[idx(l, c.x, c.y)] = 1;
  }
  return g;
}

export interface Grid { cols: number; rows: number; blocked: Uint8Array }
export const gridOf = (l: Layout2D): Grid => ({ cols: l.cols, rows: l.rows, blocked: blockedGrid(l) });

/** Raio do "pé" da pessoa para colidir com a grade, em pixels. */
export const FOOT = 9;
export function walkable(g: Grid, x: number, y: number, r = FOOT): boolean {
  for (const [px, py] of [[x - r, y - r / 2], [x + r, y - r / 2], [x - r, y + r / 2], [x + r, y + r / 2]]) {
    const cx = Math.floor(px / TILE);
    const cy = Math.floor(py / TILE);
    if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows || g.blocked[cy * g.cols + cx]) return false;
  }
  return true;
}

/** Caminho A* entre células (8 direções, sem cortar quina de parede). Devolve as células do destino até a origem excluída; [] se não houver. */
export function findPath(g: Grid, from: { x: number; y: number }, to: { x: number; y: number }, maxNodes = 6000): Array<{ x: number; y: number }> {
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < g.cols && y < g.rows && !g.blocked[y * g.cols + x];
  if (!free(to.x, to.y) || (from.x === to.x && from.y === to.y)) return [];
  const key = (x: number, y: number) => y * g.cols + x;
  const open: Array<{ x: number; y: number; f: number }> = [{ x: from.x, y: from.y, f: 0 }];
  const gScore = new Map<number, number>([[key(from.x, from.y), 0]]);
  const prev = new Map<number, number>();
  const h = (x: number, y: number) => Math.max(Math.abs(x - to.x), Math.abs(y - to.y)) + 0.41 * Math.min(Math.abs(x - to.x), Math.abs(y - to.y));
  let expanded = 0;
  while (open.length && expanded++ < maxNodes) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.x === to.x && cur.y === to.y) {
      const path: Array<{ x: number; y: number }> = [];
      let k = key(cur.x, cur.y);
      while (k !== key(from.x, from.y)) {
        path.push({ x: k % g.cols, y: Math.floor(k / g.cols) });
        k = prev.get(k)!;
      }
      return path.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!free(nx, ny) || (dx !== 0 && dy !== 0 && (!free(cur.x + dx, cur.y) || !free(cur.x, cur.y + dy)))) continue;
      const ng = (gScore.get(key(cur.x, cur.y)) ?? 0) + (dx !== 0 && dy !== 0 ? 1.41 : 1);
      if (ng < (gScore.get(key(nx, ny)) ?? Infinity)) {
        gScore.set(key(nx, ny), ng);
        prev.set(key(nx, ny), key(cur.x, cur.y));
        open.push({ x: nx, y: ny, f: ng + h(nx, ny) });
      }
    }
  }
  return [];
}

// ---------- validação ----------
const ID = /^[a-zA-Z0-9_-]{1,40}$/;
export interface LayoutCheck { layout: Layout2D | null; errors: string[] }

/** Valida e normaliza um layout vindo do cliente (o servidor nunca confia nele). Erros → recusar. */
export function validateLayout(raw: unknown): LayoutCheck {
  const errors: string[] = [];
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  if (!src) return { layout: null, errors: ['Layout ausente.'] };
  const extra = Object.keys(src).filter((k) => !['v', 'cols', 'rows', 'floor', 'walls', 'objects', 'rooms', 'spawns', 'stations'].includes(k));
  if (extra.length) errors.push(`Campos desconhecidos: ${extra.slice(0, 5).join(', ')}.`);
  if (src.v !== 1) errors.push('Versão do layout não suportada.');
  const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  if (!int(src.cols, 8, MAX_COLS) || !int(src.rows, 8, MAX_ROWS)) return { layout: null, errors: [...errors, `O mapa deve ter de 8 a ${MAX_COLS} colunas e linhas.`] };
  const cols = src.cols as number;
  const rows = src.rows as number;
  const cells = cols * rows;
  const arr = (v: unknown, ok: (n: unknown) => boolean, label: string) => {
    if (!Array.isArray(v) || v.length !== cells || !v.every(ok)) {
      errors.push(`${label} inválido.`);
      return null;
    }
    return v as number[];
  };
  const floor = arr(src.floor, (n) => n === 0 || FLOOR_IDS.includes(n as number), 'Piso');
  const walls = arr(src.walls, (n) => n === 0 || n === 1, 'Paredes');
  if (!floor || !walls) return { layout: null, errors };
  if (!Array.isArray(src.objects) || src.objects.length > MAX_OBJECTS) return { layout: null, errors: [...errors, `Até ${MAX_OBJECTS} objetos.`] };
  const ids = new Set<string>();
  const objects: Obj2D[] = [];
  for (const o of src.objects as unknown[]) {
    const r = o as Record<string, unknown>;
    if (!r || typeof r !== 'object' || Object.keys(r).some((k) => !['id', 'asset', 'x', 'y', 'rot'].includes(k))) {
      errors.push('Objeto inválido.');
      continue;
    }
    const a = typeof r.asset === 'string' ? ASSET_BY_ID.get(r.asset) : undefined;
    if (typeof r.id !== 'string' || !ID.test(r.id) || ids.has(r.id)) errors.push(`Identificador de objeto inválido ou repetido: ${String(r.id).slice(0, 20)}.`);
    else if (!a) errors.push(`Móvel "${String(r.asset).slice(0, 20)}" fora do catálogo.`);
    else if (!int(r.x, 0, cols - 1) || !int(r.y, 0, rows - 1) || !int(r.rot, 0, 3)) errors.push(`Posição ou giro inválido em "${r.id}".`);
    else if (r.rot !== 0 && !a.rotatable) errors.push(`${a.name} não gira.`);
    else {
      ids.add(r.id);
      objects.push({ id: r.id, asset: a.id, x: r.x as number, y: r.y as number, rot: r.rot as 0 | 1 | 2 | 3 });
    }
  }
  const rooms: Room2D[] = [];
  if (!Array.isArray(src.rooms) || src.rooms.length > 60) errors.push('Salas inválidas.');
  else
    for (const room of src.rooms as unknown[]) {
      const r = room as Record<string, unknown>;
      if (!r || typeof r.name !== 'string' || r.name.length < 1 || r.name.length > 40 || typeof r.id !== 'string' || !ID.test(r.id) || !int(r.x, 0, cols - 1) || !int(r.y, 0, rows - 1) || !int(r.w, 1, cols) || !int(r.h, 1, rows) || (r.x as number) + (r.w as number) > cols || (r.y as number) + (r.h as number) > rows) errors.push('Sala inválida.');
      else rooms.push({ id: r.id, name: r.name, x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number });
    }
  const spawns: Spawn2D[] = [];
  if (!Array.isArray(src.spawns) || src.spawns.length < 1 || src.spawns.length > 20) errors.push('Defina de 1 a 20 pontos de entrada.');
  else
    for (const s of src.spawns as unknown[]) {
      const r = s as Record<string, unknown>;
      if (!r || typeof r.id !== 'string' || !ID.test(r.id) || !int(r.x, 0, cols - 1) || !int(r.y, 0, rows - 1)) errors.push('Ponto de entrada inválido.');
      else spawns.push({ id: r.id, x: r.x as number, y: r.y as number });
    }
  const stations: Station2D[] = [];
  if (!Array.isArray(src.stations) || src.stations.length > 400) errors.push('Estações inválidas.');
  else
    for (const s of src.stations as unknown[]) {
      const r = s as Record<string, unknown>;
      if (!r || typeof r.id !== 'string' || !ID.test(r.id) || typeof r.objectId !== 'string') errors.push('Estação inválida.');
      else stations.push({ id: r.id, objectId: r.objectId });
    }
  if (errors.length) return { layout: null, errors };

  const layout: Layout2D = { v: 1, cols, rows, floor, walls, objects, rooms, spawns, stations };
  // regras de posição: dentro do prédio, sem parede sob o móvel, sem móveis que bloqueiam se sobrepondo
  const occupied = new Map<number, string>();
  for (const o of objects) {
    const a = ASSET_BY_ID.get(o.asset)!;
    for (const c of footprintCells(a, o)) {
      if (!inBounds(layout, c.x, c.y)) {
        errors.push(`${a.name} (${o.id}) passa do limite do mapa.`);
        break;
      }
      const i = idx(layout, c.x, c.y);
      if (layout.floor[i] === 0 && !a.flat) errors.push(`${a.name} (${o.id}) está fora do prédio.`);
      else if (layout.walls[i] === 1 && !a.flat && a.id !== 'painting') errors.push(`${a.name} (${o.id}) está sobre uma parede.`);
      if (a.blocks) {
        const other = occupied.get(i);
        if (other) errors.push(`${a.name} (${o.id}) se sobrepõe a ${other}.`);
        else occupied.set(i, o.id);
      }
    }
  }
  const grid = gridOf(layout);
  for (const s of spawns) if (grid.blocked[idx(layout, s.x, s.y)]) errors.push(`O ponto de entrada ${s.id} está num lugar bloqueado.`);
  const byId = new Map(objects.map((o) => [o.id, o]));
  const seenStations = new Set<string>();
  const stationObjects = new Set<string>();
  for (const st of stations) {
    const o = byId.get(st.objectId);
    const seat = o ? seatOfObject(o) : null;
    if (seenStations.has(st.id) || stationObjects.has(st.objectId)) errors.push(`Estação repetida: ${st.id}.`);
    else if (!o || !seat) errors.push(`A estação ${st.id} precisa estar numa mesa com lugar para sentar.`);
    else if (!inBounds(layout, seat.cx, seat.cy) || grid.blocked[idx(layout, seat.cx, seat.cy)]) errors.push(`O lugar da estação ${st.id} está bloqueado ou fora do mapa.`);
    seenStations.add(st.id);
    stationObjects.add(st.objectId);
  }
  // pelo menos uma entrada alcançável
  return { layout: errors.length ? null : layout, errors };
}

/** Célula livre mais próxima de (x, y) (busca em anéis), para reposicionar quem ficou num lugar que deixou de ser válido. */
export function nearestFree(g: Grid, x: number, y: number): { x: number; y: number } | null {
  for (let r = 0; r < Math.max(g.cols, g.rows); r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = x + dx;
        const cy = y + dy;
        if (cx >= 0 && cy >= 0 && cx < g.cols && cy < g.rows && !g.blocked[cy * g.cols + cx]) return { x: cx, y: cy };
      }
  return null;
}

// ---------- exportação para o Tiled ----------
/** Camadas de ladrilho e objetos no formato JSON do Tiled (versão 1.10). O Phaser carrega este mesmo JSON. */
export function layoutToTiled(l: Layout2D) {
  const WALL_TOP = FLOORS.length + 1;
  const WALL_FRONT = FLOORS.length + 2;
  const wallTiles = l.walls.map((w, i) => {
    if (!w) return 0;
    const below = i + l.cols < l.walls.length ? l.walls[i + l.cols] : 0;
    return below ? WALL_TOP : WALL_FRONT;
  });
  const tl = (id: number, name: string, data: number[]) => ({ id, name, type: 'tilelayer', width: l.cols, height: l.rows, x: 0, y: 0, opacity: 1, visible: true, data });
  const grid = blockedGrid(l);
  return {
    type: 'map', version: '1.10', tiledversion: '1.10.2', orientation: 'orthogonal', renderorder: 'right-down', infinite: false,
    width: l.cols, height: l.rows, tilewidth: TILE, tileheight: TILE, nextlayerid: 6, nextobjectid: l.objects.length + 1,
    layers: [
      tl(1, 'piso', l.floor),
      tl(2, 'paredes', wallTiles),
      tl(3, 'colisao', Array.from(grid, (b) => (b ? 1 : 0))),
      {
        id: 4, name: 'objetos', type: 'objectgroup', draworder: 'topdown', opacity: 1, visible: true, x: 0, y: 0,
        objects: l.objects.map((o, i) => ({ id: i + 1, name: o.id, type: o.asset, x: o.x * TILE, y: o.y * TILE, width: 0, height: 0, rotation: o.rot * 90, visible: true, properties: [{ name: 'asset', type: 'string', value: o.asset }] })),
      },
      {
        id: 5, name: 'entradas', type: 'objectgroup', draworder: 'topdown', opacity: 1, visible: true, x: 0, y: 0,
        objects: l.spawns.map((s, i) => ({ id: 1000 + i, name: s.id, type: 'spawn', x: s.x * TILE, y: s.y * TILE, width: TILE, height: TILE, visible: true })),
      },
    ],
    tilesets: [{ firstgid: 1, name: 'workspace', tilewidth: TILE, tileheight: TILE, tilecount: FLOORS.length + 2, columns: FLOORS.length + 2, image: 'workspace-tiles.png', imagewidth: TILE * (FLOORS.length + 2), imageheight: TILE }],
  };
}
export const TILE_WALL_TOP = FLOORS.length + 1;
export const TILE_WALL_FRONT = FLOORS.length + 2;
export const TILESET_TILES = FLOORS.length + 2;
