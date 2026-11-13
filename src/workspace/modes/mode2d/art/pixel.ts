/** Utilitários de pixel art desenhada por código (sem arquivos de imagem de terceiros). */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  const m = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  return `#${[m(r), m(g), m(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export class Pix {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.g.imageSmoothingEnabled = false;
  }
  rect(x: number, y: number, w: number, h: number, color: string, alpha = 1) {
    this.g.globalAlpha = alpha;
    this.g.fillStyle = color;
    this.g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    this.g.globalAlpha = 1;
  }
  px(x: number, y: number, color: string) {
    this.rect(x, y, 1, 1, color);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, color: string, alpha = 1) {
    this.g.globalAlpha = alpha;
    this.g.fillStyle = color;
    this.g.beginPath();
    this.g.ellipse(Math.round(cx), Math.round(cy), rx, ry, 0, 0, Math.PI * 2);
    this.g.fill();
    this.g.globalAlpha = 1;
  }
  /** Caixa em vista 3/4: topo claro e frente escura (a frente fica na parte de baixo). */
  box(x: number, y: number, w: number, h: number, depth: number, top: string, front: string) {
    this.rect(x, y, w, h - depth, top);
    this.rect(x, y + h - depth, w, depth, front);
    this.rect(x, y, w, 1, shade(top, 0.25));
  }
  /** Contorno escuro de 1 px em volta de tudo o que foi desenhado (legibilidade do pixel art). */
  outline(color = '#1c2028', alpha = 0.85) {
    const { w, h } = this;
    const img = this.g.getImageData(0, 0, w, h);
    const d = img.data;
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 40;
    const [r, g, b] = hexToRgb(color);
    const marks: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) marks.push((y * w + x) * 4);
    for (const i of marks) [d[i], d[i + 1], d[i + 2], d[i + 3]] = [r, g, b, Math.round(255 * alpha)];
    this.g.putImageData(img, 0, 0);
  }
}
