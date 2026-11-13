/**
 * Personagem 2D no estilo Universal LPC (Liberated Pixel Cup): corpo, cabeça, cabelo, barba, roupa, calça, calçado e óculos em camadas de
 * 64×64, recoloridas por paleta em tempo de execução. Arquivos e créditos em public/assets/lpc (gerados por tools/lpc/build.mjs).
 * Linhas das folhas do LPC: 0 costas · 1 esquerda · 2 frente · 3 direita. Colunas: andar 9 quadros (o 0 é parado), parado 2, sentado 3.
 */
import type { Avatar2DConfig } from '../../../../../shared/avatar2d';
import type { Dir } from '../../../../../shared/office2d';

const BASE = '/assets/lpc';
export const LPC_FRAME = 64;
export type LpcAnim = 'walk' | 'idle' | 'sit';
const LPC_ROW: Record<Dir, number> = { up: 0, left: 1, down: 2, right: 3 };
export const lpcRow = (d: Dir) => LPC_ROW[d];

interface PartLayer { z: number; male: string; female: string }
export interface Part { id: string; name: string; layers: PartLayer[]; recolor: string | null; variants: string[] | null }
interface Manifest {
  bodies: Record<'male' | 'female', { body: string; head: string }>;
  parts: Record<string, Part[]>;
  palettes: Record<string, { base: string; colors: Record<string, string[]> }>;
}
let manifest: Manifest | null = null;
let loadingManifest: Promise<void> | null = null;

/** Carrega o catálogo (≈40 KB). Nunca rejeita: sem ele o 2D usa o personagem pequeno. */
export function loadLpcManifest(): Promise<void> {
  loadingManifest ??= fetch(`${BASE}/manifest.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : Promise.reject(new Error('manifest'))))
    .then((m) => void (manifest = m))
    .catch(() => void (manifest = null));
  return loadingManifest;
}
export const lpcCatalog = () => manifest;

// --- imagens (carregadas sob demanda, uma vez) ---
const imgs = new Map<string, Promise<HTMLImageElement | null>>();
const imgOk = new Map<string, HTMLImageElement>();
function loadImg(src: string): Promise<HTMLImageElement | null> {
  let p = imgs.get(src);
  if (!p) {
    p = new Promise<HTMLImageElement | null>((res) => {
      const i = new Image();
      i.onload = () => {
        imgOk.set(src, i);
        res(i);
      };
      i.onerror = () => res(null);
      i.src = src;
    });
    imgs.set(src, p);
  }
  return p;
}

interface Spec { z: number; dir: string; variant: string | null; recolors: Array<[string, string]> }

/** Camadas de uma peça do catálogo. `color` é a cor escolhida (cor de paleta ou, nas peças que vêm em arquivos por cor, o nome da variante). */
function partSpecs(cfg: Avatar2DConfig, cat: string, id: string, color?: string): Spec[] {
  const m = manifest;
  const p = m?.parts[cat]?.find((x) => x.id === id);
  if (!m || !p) return [];
  const b = (cfg.bodyType === 'female' ? 'female' : 'male') as 'male' | 'female';
  const variant = p.variants ? (color && p.variants.includes(color) ? color : p.variants.includes('black') ? 'black' : p.variants[0]) : null;
  const rc: Array<[string, string]> = [];
  if (p.recolor === 'hair') rc.push(['hair', color && !p.variants ? color : cfg.hairColor]);
  else if (p.recolor === 'body') rc.push(['body', cfg.skin]);
  else if (p.recolor === 'cloth') rc.push(['cloth', color ?? 'white']);
  else if (p.recolor === 'metal') rc.push(['metal', color ?? 'steel']);
  if (cat === 'head') rc.push(['eye', cfg.eyeColor ?? 'blue']);
  return p.layers.map((l) => ({ z: l.z, dir: l[b], variant, recolors: rc }));
}

const defaultHead = (cfg: Avatar2DConfig) => cfg.head ?? (cfg.bodyType === 'female' ? 'heads_human_female' : 'heads_human_male');

/** Camadas da aparência, de trás para frente. */
function specsOf(cfg: Avatar2DConfig, withGlasses = true): Spec[] | null {
  const m = manifest;
  if (!m) return null;
  const b = (cfg.bodyType === 'female' ? 'female' : 'male') as 'male' | 'female';
  const out: Spec[] = [{ z: 10, dir: m.bodies[b].body, variant: null, recolors: [['body', cfg.skin]] }];
  const head = partSpecs(cfg, 'head', defaultHead(cfg));
  out.push(...(head.length ? head : [{ z: 100, dir: m.bodies[b].head, variant: null, recolors: [['body', cfg.skin], ['eye', cfg.eyeColor ?? 'blue']] as Array<[string, string]> }]));
  out.push(...partSpecs(cfg, 'torso', cfg.shirt, cfg.shirtColor));
  out.push(...partSpecs(cfg, 'legs', cfg.pants, cfg.pantsColor));
  out.push(...partSpecs(cfg, 'shoes', cfg.shoes, cfg.shoesColor));
  out.push(...partSpecs(cfg, 'hair', cfg.hair, cfg.hairColor));
  if (cfg.facial !== 'none') out.push(...partSpecs(cfg, 'beard', cfg.facial, cfg.hairColor));
  if (cfg.glasses && withGlasses) out.push(...partSpecs(cfg, 'glasses', 'facial_glasses', 'black'));
  for (const [cat, v] of Object.entries(cfg.extras ?? {})) out.push(...partSpecs(cfg, cat, v.id, v.color));
  return out.sort((x, y) => x.z - y.z);
}
const urlOf = (s: Spec, a: LpcAnim) => `${BASE}/spritesheets/${s.dir}${s.variant ? `${a}/${s.variant}` : a}.png`;

/** Carrega as imagens que a aparência usa (por padrão andar, parado e sentado). */
export async function preloadLpc(cfg: Avatar2DConfig, anims: readonly LpcAnim[] = ['walk', 'idle', 'sit']): Promise<boolean> {
  await loadLpcManifest();
  const specs = specsOf(cfg);
  if (!specs) return false;
  const all = await Promise.all(specs.flatMap((s) => anims.map((a) => loadImg(urlOf(s, a)))));
  return all.every(Boolean);
}
/** Todas as imagens estão carregadas (o desenho é síncrono depois do preload). */
export function lpcLoaded(cfg: Avatar2DConfig, anims: readonly LpcAnim[] = ['walk', 'idle', 'sit']): boolean {
  const specs = specsOf(cfg);
  return !!specs && specs.every((s) => anims.every((a) => imgOk.has(urlOf(s, a))));
}

// --- recolorir por paleta (cor do pacote → cor escolhida, posição a posição da rampa) ---
const pack = (h: string) => (parseInt(h.slice(1, 3), 16) << 16) | (parseInt(h.slice(3, 5), 16) << 8) | parseInt(h.slice(5, 7), 16);
const small = new Map<string, HTMLCanvasElement>(); // só folhas pequenas (parado/sentado): o cache é limitado
function recolored(img: HTMLImageElement, url: string, recolors: Array<[string, string]>): CanvasImageSource {
  if (!recolors.length || !manifest) return img;
  const key = `${url}|${recolors.map((r) => r.join(':')).join(',')}`;
  const hit = small.get(key);
  if (hit) return hit;
  const map = new Map<number, number>();
  for (const [mat, color] of recolors) {
    const pal = manifest.palettes[mat];
    const from = pal?.colors[pal.base];
    const to = pal?.colors[color];
    if (!from || !to) continue;
    for (let i = 0; i < Math.min(from.length, to.length); i++) map.set(pack(from[i]), pack(to[i]));
  }
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const t = map.get((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    if (t !== undefined) {
      px[i] = t >> 16;
      px[i + 1] = (t >> 8) & 255;
      px[i + 2] = t & 255;
    }
  }
  g.putImageData(d, 0, 0);
  if (img.width * img.height <= 192 * 256) {
    if (small.size > 500) small.delete(small.keys().next().value as string);
    small.set(key, c);
  }
  return c;
}

/** Folha inteira de uma animação com todas as camadas sobrepostas. */
export function composeAnim(cfg: Avatar2DConfig, anim: LpcAnim): HTMLCanvasElement | null {
  const specs = specsOf(cfg);
  if (!specs) return null;
  let out: HTMLCanvasElement | null = null;
  let g: CanvasRenderingContext2D | null = null;
  for (const s of specs) {
    const url = urlOf(s, anim);
    const img = imgOk.get(url);
    if (!img) return null;
    if (!out) {
      out = document.createElement('canvas');
      out.width = img.width;
      out.height = img.height;
      g = out.getContext('2d')!;
      g.imageSmoothingEnabled = false;
    }
    g!.drawImage(recolored(img, url, s.recolors), 0, 0);
  }
  return out;
}

/** Retângulo da cabeça no quadro (para o headset). */
export function headBox(cfg: Avatar2DConfig, anim: LpcAnim, col: number, row: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const m = manifest;
  if (!m) return null;
  const b = cfg.bodyType === 'female' ? 'female' : 'male';
  const img = imgOk.get(`${BASE}/spritesheets/${m.bodies[b].head}${anim}.png`);
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = LPC_FRAME;
  c.height = LPC_FRAME;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, col * LPC_FRAME, row * LPC_FRAME, LPC_FRAME, LPC_FRAME, 0, 0, LPC_FRAME, LPC_FRAME);
  const px = g.getImageData(0, 0, LPC_FRAME, LPC_FRAME).data;
  let x0 = LPC_FRAME;
  let y0 = LPC_FRAME;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < LPC_FRAME; y++) for (let x = 0; x < LPC_FRAME; x++) if (px[(y * LPC_FRAME + x) * 4 + 3] > 0) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return x1 >= x0 ? { x0, y0, x1, y1 } : null;
}

/** Carrega as imagens de "parado" de todas as peças de um tipo de corpo (miniaturas do editor). */
export async function preloadCatalog(body: 'male' | 'female'): Promise<void> {
  await loadLpcManifest();
  const m = manifest;
  if (!m) return;
  const jobs: Array<Promise<unknown>> = [
    loadImg(`${BASE}/spritesheets/${m.bodies[body].body}idle.png`),
    loadImg(`${BASE}/spritesheets/${m.bodies[body].head}idle.png`),
  ];
  for (const cat of Object.keys(m.parts))
    for (const p of m.parts[cat]) for (const l of p.layers) jobs.push(loadImg(`${BASE}/spritesheets/${l[body]}${p.variants ? `idle/${p.variants.includes('black') ? 'black' : p.variants[0]}` : 'idle'}.png`));
  await Promise.all(jobs);
}

/** Cor de amostra (tom médio da rampa) de uma cor de paleta, para os botões de cor. */
export function swatch(material: 'body' | 'hair' | 'cloth' | 'eye' | 'metal', name: string): string {
  const colors = manifest?.palettes[material]?.colors[name];
  return colors ? colors[Math.min(colors.length - 1, Math.floor(colors.length / 2))] : '#888888';
}

const HEADY = new Set(['head', 'hair', 'beard', 'hat', 'expression', 'eyebrows', 'nose', 'glasses']);

/** Miniatura de uma peça: só ela (com a cabeça por baixo nas peças do rosto e do cabelo), recortada. */
export function drawPartThumb(c: HTMLCanvasElement, cfg: Avatar2DConfig, cat: string, id: string, color?: string): boolean {
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, c.width, c.height);
  const specs = partSpecs(cfg, cat, id, color);
  if (!specs.length) return false;
  const base = HEADY.has(cat) && cat !== 'head' ? partSpecs(cfg, 'head', defaultHead(cfg)) : [];
  const layers = [...base, ...specs].sort((a, b) => a.z - b.z);
  const tmp = document.createElement('canvas');
  tmp.width = LPC_FRAME;
  tmp.height = LPC_FRAME;
  const tg = tmp.getContext('2d', { willReadFrequently: true })!;
  for (const s of layers) {
    const url = urlOf(s, 'idle');
    const img = imgOk.get(url);
    if (!img) return false;
    tg.drawImage(recolored(img, url, s.recolors), 0, lpcRow('down') * LPC_FRAME, LPC_FRAME, LPC_FRAME, 0, 0, LPC_FRAME, LPC_FRAME);
  }
  let sx: number;
  let sy: number;
  let sz: number;
  if (HEADY.has(cat)) [sx, sy, sz] = [16, 8, 32];
  else {
    // recorte justo em volta da peça (quadrado)
    const px = tg.getImageData(0, 0, LPC_FRAME, LPC_FRAME).data;
    let x0 = LPC_FRAME, y0 = LPC_FRAME, x1 = 0, y1 = 0;
    for (let y = 0; y < LPC_FRAME; y++) for (let x = 0; x < LPC_FRAME; x++) if (px[(y * LPC_FRAME + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 < x0) return false;
    sz = Math.max(x1 - x0 + 1, y1 - y0 + 1, 12) + 2;
    sx = Math.round((x0 + x1) / 2 - sz / 2);
    sy = Math.round((y0 + y1) / 2 - sz / 2);
  }
  g.drawImage(tmp, sx, sy, sz, sz, 0, 0, c.width, c.height);
  return true;
}

/** Carrega as imagens de "parado" de uma peça para a miniatura. */
export async function preloadPart(cfg: Avatar2DConfig, cat: string, id: string, color?: string): Promise<void> {
  await loadLpcManifest();
  const head = HEADY.has(cat) && cat !== 'head' ? partSpecs(cfg, 'head', defaultHead(cfg)) : [];
  await Promise.all([...head, ...partSpecs(cfg, cat, id, color)].map((s) => loadImg(urlOf(s, 'idle'))));
}
export const lpcPartsOf = (cat: string): Part[] => manifest?.parts[cat] ?? [];
