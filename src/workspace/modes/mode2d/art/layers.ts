/**
 * Personagem 2D em camadas com o pacote "Customizable Character Pack" (Ordinary Bumblebee, CC0), em public/assets/char-layers.
 * Cada folha tem 4 quadros de 32×32 por linha e uma linha por variação (peles, cabelos, roupas...). As camadas são sobrepostas na
 * ordem corpo → parte de baixo → calçado → parte de cima → olhos → cabelo. Óculos e headset são desenhados por código.
 */
import { SKIN2D, PALETTE2D, type Avatar2DConfig } from '../../../../../shared/avatar2d';
import type { Dir } from '../../../../../shared/office2d';

const BASE = '/assets/char-layers';
export const LW = 32; // quadro do pacote
type Anim = 'Idle' | 'Walk';
type Layer = 'character' | 'hair' | 'eyes' | 'tops' | 'bottoms' | 'shoes';
const DIRN: Record<Dir, string> = { down: 'Front', up: 'Back', left: 'Left', right: 'Right' };

const sheets = new Map<string, HTMLImageElement>();
let loading: Promise<void> | null = null;
let ok = false;

function file(a: Anim, layer: Layer, d: string): string {
  switch (layer) {
    case 'character': return `${a}/Character/Character_${a}_${d}-Sheet.png`;
    case 'hair': return `${a}/Hair/Hair_${a}_${d}-Sheet.png`;
    case 'eyes': return `${a}/Eyes/Eyes_${a}_${d}-Sheet.png`;
    case 'tops': return `${a}/Clothing/${a === 'Idle' && d === 'Back' ? 'Clothing_Top_Idle_Back' : `Clothing_Tops_${a}_${d}`}-Sheet.png`;
    case 'bottoms': return `${a}/Clothing/Clothing_Bottoms_${a}_${d}-Sheet.png`;
    case 'shoes': return `${a}/Clothing/Clothing_Shoes_${a}_${d}-Sheet.png`;
  }
}
const key = (a: Anim, l: Layer, d: string) => `${a}/${l}/${d}`;

const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error(src));
    i.src = src;
  });

/** Carrega todas as folhas (≈300 KB) uma vez. Nunca rejeita: sem o pacote, valem os personagens pintados por código. */
export function loadLayers(): Promise<void> {
  loading ??= (async () => {
    try {
      const jobs: Array<Promise<void>> = [];
      for (const a of ['Idle', 'Walk'] as const)
        for (const l of ['character', 'hair', 'eyes', 'tops', 'bottoms', 'shoes'] as const)
          for (const d of Object.values(DIRN)) {
            if (l === 'eyes' && d === 'Back') continue; // de costas não há olhos
            jobs.push(loadImg(`${BASE}/${file(a, l, d)}`).then((img) => void sheets.set(key(a, l, d), img)));
          }
      await Promise.all(jobs);
      ok = true;
    } catch {
      sheets.clear();
      ok = false;
    }
  })();
  return loading;
}
export const layersReady = () => ok;

const dist = (a: string, b: string) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2;
};
const num = (id: string, prefix: string, max: number) => {
  const n = id.startsWith(prefix) ? Number(id.slice(prefix.length)) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= max ? n - 1 : 0; // id antigo ou inválido: primeira peça
};

/** Linhas de cada folha para uma aparência. */
export function rowsOf(cfg: Avatar2DConfig) {
  const skin = Math.max(0, SKIN2D.findIndex((s) => s.id === cfg.skin));
  const color = PALETTE2D.hair.reduce((best, c, i) => (dist(c, cfg.hairColor) < dist(PALETTE2D.hair[best], cfg.hairColor) ? i : best), 0);
  const style = cfg.hair === 'bald' ? -1 : num(cfg.hair, 'h', 5);
  return {
    skin,
    hair: style < 0 ? -1 : style * 5 + color,
    eyes: color % 4,
    tops: num(cfg.shirt, 't', 29),
    bottoms: num(cfg.pants, 'b', 14),
    shoes: num(cfg.shoes, 's', 10),
  };
}

const DARK = '#1c2028';
function overlay(g: CanvasRenderingContext2D, dir: Dir, glasses: boolean, headset: boolean) {
  const px = (x: number, y: number, w = 1, h = 1, c = DARK) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  if (glasses && dir !== 'up') {
    if (dir === 'down') {
      px(12, 12, 8, 1);
      px(12, 15, 8, 1);
      px(12, 13, 1, 2);
      px(19, 13, 1, 2);
      px(15, 13, 2, 1);
    } else if (dir === 'left') {
      px(10, 12, 4, 1);
      px(10, 15, 4, 1);
      px(13, 13, 1, 2);
    } else {
      px(18, 12, 4, 1);
      px(18, 15, 4, 1);
      px(18, 13, 1, 2);
    }
  }
  if (headset) {
    const c2 = '#4b5563';
    if (dir === 'down' || dir === 'up') {
      px(10, 5, 12, 1);
      px(9, 6, 1, 6);
      px(22, 6, 1, 6);
      px(8, 12, 2, 4, '#2b2d33');
      px(22, 12, 2, 4, '#2b2d33');
      px(8, 12, 1, 1, c2);
      px(23, 12, 1, 1, c2);
      if (dir === 'down') px(9, 16, 4, 1);
    } else {
      px(11, 5, 9, 1);
      px(14, 12, 3, 4, '#2b2d33');
      px(14, 12, 1, 1, c2);
    }
  }
}

export interface FrameOpts { anim: Anim; col: number; dir: Dir; glasses: boolean; headset: boolean }

/** Desenha um quadro 32×32 da aparência no contexto g (em 0,0). */
export function drawFrame(g: CanvasRenderingContext2D, cfg: Avatar2DConfig, o: FrameOpts): boolean {
  if (!ok) return false;
  const r = rowsOf(cfg);
  const d = DIRN[o.dir];
  const put = (layer: Layer, row: number) => {
    const img = sheets.get(key(o.anim, layer, d));
    if (img && row >= 0) g.drawImage(img, o.col * LW, row * LW, LW, LW, 0, 0, LW, LW);
  };
  put('character', r.skin);
  put('bottoms', r.bottoms);
  put('shoes', r.shoes);
  put('tops', r.tops);
  put('eyes', r.eyes);
  put('hair', r.hair);
  overlay(g, o.dir, o.glasses, o.headset);
  return true;
}
