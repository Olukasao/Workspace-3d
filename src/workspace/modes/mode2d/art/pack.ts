/**
 * "Office Pixel Art" (pacote gratuito, Imersa Studios; crédito e licença em public/assets/office-pixel/).
 * Os arquivos entram sem alteração: aqui só são posicionados (âncora do pacote) e combinados (mesa + computador).
 * Se algo não carregar, a arte pintada por código (furniture.ts, tiles.ts) continua valendo.
 */
import { TILE, rotateDir, type AssetDef } from '../../../../../shared/office2d';

type Facing = 'down' | 'left' | 'right' | 'up';
const VIEW: Record<Facing, string> = { down: 'front', up: 'back', left: 'left', right: 'right' };
interface View { img: HTMLImageElement; ax: number; ay: number }

const BASE = '/assets/office-pixel';
const PROPS = ['office_desk', 'computer', 'office_chair', 'filing_cabinet', 'office_plant', 'tall_plant', 'water_cooler'] as const;
const props = new Map<string, Partial<Record<Facing, View>>>();
let floors: HTMLImageElement | null = null;
let loading: Promise<void> | null = null;

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
      await Promise.all([...PROPS.map(loadProp), loadImg(`${BASE}/floors.png`).then((i) => void (floors = i))]);
    } catch {
      props.clear();
      floors = null;
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

/** Desenho do móvel já girado com o pacote, ou null se o pacote não cobre este móvel. */
export function packFurniture(a: AssetDef, rot: number, fw: number, fh: number): HTMLCanvasElement | null {
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
