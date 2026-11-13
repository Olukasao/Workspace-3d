/**
 * "Office Pixel Art" (pacote gratuito, Imersa Studios; crédito e licença em public/assets/office-pixel/).
 * Os arquivos entram sem alteração: aqui só são posicionados (âncora do pacote) e combinados (mesa + computador).
 * Se algo não carregar, a arte pintada por código (furniture.ts, tiles.ts) continua valendo.
 */
import { TILE, rotateDir, type AssetDef } from '../../../../../shared/office2d';
import { loadLayers } from './layers';
import { loadLpcManifest } from './lpc';

type Facing = 'down' | 'left' | 'right' | 'up';
const VIEW: Record<Facing, string> = { down: 'front', up: 'back', left: 'left', right: 'right' };
interface View { img: HTMLImageElement; ax: number; ay: number }

const BASE = '/assets/office-pixel';
const PROPS = ['office_desk', 'computer', 'office_chair', 'filing_cabinet', 'office_plant', 'tall_plant', 'water_cooler'] as const;
const props = new Map<string, Partial<Record<Facing, View>>>();
let floors: HTMLImageElement | null = null;
let walls: HTMLImageElement | null = null;
const tileImgs = new Map<string, HTMLImageElement>();
let loading: Promise<void> | null = null;
const TILE_FILES = ['sofa_down_1', 'sofa_down_2', 'sofa_up_1', 'sofa_up_2', 'sofa_left_1', 'sofa_left_2', 'sofa_right_1', 'sofa_right_2', 'counter_bank', 'counter_teller', 'counter_metal', 'oven1', 'hifi', 'speaker'];

const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((ok, no) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => no(new Error(src));
    i.src = src;
  });

async function loadProp(name: string) {
  const meta = (await (await fetch(`${BASE}/props/${name}.json`)).json()) as { views: Record<string, { file: string; anchor: { x: number; y: number } }> };
  const out: Partial<Record<Facing, View>> = {};
  for (const f of Object.keys(VIEW) as Facing[]) {
    const v = meta.views[VIEW[f]];
    if (v) out[f] = { img: await loadImg(`${BASE}/props/${v.file}`), ax: v.anchor.x, ay: v.anchor.y };
  }
  props.set(name, out);
}

/** Carrega o pacote uma vez. Nunca rejeita: em caso de erro o 2D usa a arte pintada. */
export function loadOfficePack(): Promise<void> {
  loading ??= (async () => {
    try {
      await Promise.all([...PROPS.map(loadProp), loadImg(`${BASE}/floors.png`).then((i) => void (floors = i)), loadImg(`${BASE}/walls.png`).then((i) => void (walls = i)), loadLayers(), loadLpcManifest(), ...TILE_FILES.map((n) => loadImg(`/assets/furniture-crimelike/${n}.png`).then((i) => void tileImgs.set(n, i)))]);
    } catch {
      props.clear();
      tileImgs.clear();
      floors = null;
      walls = null;
    }
  })();
  return loading;
}

/** Peças do pacote que formam cada móvel (só onde o tamanho do pacote bate com o do móvel). */
const RECIPE: Record<string, string[]> = {
  desk: ['office_desk'],
  desk_pc: ['office_desk', 'computer'],
  chair: ['office_chair'],
  pc: ['computer'],
  filing: ['filing_cabinet'],
  plant: ['office_plant'],
  plant_big: ['tall_plant'],
  cooler: ['water_cooler'],
};

/** Móveis montados com ladrilhos de 32×32 do Crimelike Furniture (CC0): uma lista de ladrilhos por direção (frente, costas, esquerda e direita). */
const TILE_RECIPE: Record<string, Partial<Record<Facing, string[]>>> = {
  sofa: { down: ['sofa_down_1', 'sofa_down_2'], up: ['sofa_up_1', 'sofa_up_2'], left: ['sofa_left_1', 'sofa_left_2'], right: ['sofa_right_1', 'sofa_right_2'] },
  oven: { down: ['oven1'] },
  kitchen_counter: { down: ['counter_metal'] },
  hifi: { down: ['hifi'] },
  speaker: { down: ['speaker'] },
  // balcão de recepção: faixa horizontal de 3; na vertical é a mesma faixa girada
  reception_desk: { down: ['counter_bank', 'counter_metal', 'counter_teller'], up: ['counter_bank', 'counter_metal', 'counter_teller'] },
};

function tileFurniture(a: AssetDef, rot: number, fw: number, fh: number): HTMLCanvasElement | null {
  const rec = TILE_RECIPE[a.id];
  if (!rec) return null;
  const facing = rotateDir('down', rot) as Facing;
  const vertical = facing === 'left' || facing === 'right';
  const names = rec[facing] ?? (vertical ? rec.down : undefined);
  if (!names || !names.every((n) => tileImgs.has(n))) return null;
  const W = fw * TILE;
  const H = (fh + a.tall) * TILE;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const top = a.tall * TILE;
  if (rec[facing]) {
    names.forEach((n, i) => g.drawImage(tileImgs.get(n)!, vertical ? 0 : i * TILE, top + (vertical ? i * TILE : 0)));
  } else {
    // sem desenho próprio para esta direção: gira a faixa horizontal em 90°
    g.save();
    if (facing === 'left') {
      g.translate(0, top + names.length * TILE);
      g.rotate(-Math.PI / 2);
    } else {
      g.translate(TILE, top);
      g.rotate(Math.PI / 2);
    }
    names.forEach((n, i) => g.drawImage(tileImgs.get(n)!, i * TILE, 0));
    g.restore();
  }
  return c;
}

/** Desenho do móvel já girado com o pacote, ou null se o pacote não cobre este móvel. */
export function packFurniture(a: AssetDef, rot: number, fw: number, fh: number): HTMLCanvasElement | null {
  const tiled = tileFurniture(a, rot, fw, fh);
  if (tiled) return tiled;
  const recipe = RECIPE[a.id];
  if (!recipe || !recipe.every((n) => props.has(n))) return null;
  const facing = rotateDir('down', rot) as Facing;
  const views = recipe.map((n) => props.get(n)![facing]);
  if (views.some((v) => !v)) return null;
  const W = fw * TILE;
  const H = fh * TILE + Math.max(a.tall * TILE, ...views.map((v) => v!.ay));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const top = H - fh * TILE; // canto superior esquerdo do chão do móvel
  views.forEach((v, i) => {
    let fx = 0;
    let fy = top;
    if (i > 0) {
      // objeto sobre a mesa: centro do chão da mesa, um pouco acima do tampo
      fx = W / 2 - TILE / 2;
      fy = top + (fh * TILE) / 2 - TILE / 2 - 12;
    }
    g.drawImage(v!.img, Math.round(fx - v!.ax), Math.round(fy - v!.ay));
  });
  return c;
}

/** Pisos do pacote (madeira, carpete cinza, vinil cinza) lado a lado, ou null. */
export const packFloors = () => floors;

/** Número de ladrilhos de parede do pacote (8 colunas × 4 linhas, 25 usados), anexados ao fim do tileset. */
export const PACK_WALL_TILES = 25;
export const packWalls = () => walls;
