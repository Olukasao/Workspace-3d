/**
 * Móveis do escritório 2D, pintados por código em vista 3/4 (topo claro, frente escura).
 * Cada móvel vira uma textura `f_<id>_<giro>`; a pegada fica na parte de baixo e o que passa dela (monitor, encosto, copa) fica acima.
 */
import { ASSETS, TILE, footprintSize, rotateDir, type AssetDef, type Dir } from '../../../../../shared/office2d';
import { packFurniture } from './pack';
import { Pix, mulberry32, shade } from './pixel';

const WOOD = '#b98a56';
const WOOD_D = '#8a6540';
const DARK = '#2b2f36';

type Draw = (p: Pix, ctx: { W: number; H: number; y0: number; fw: number; fh: number; facing: Dir; rot: number }) => void;

function monitor(p: Pix, x: number, y: number, facing: Dir) {
  if (facing === 'down') {
    p.rect(x, y, 14, 10, DARK);
    p.rect(x + 1, y + 1, 12, 7, '#4ea0f2');
    p.rect(x + 2, y + 2, 5, 1, '#9ad0ff');
    p.rect(x + 2, y + 4, 8, 1, '#7fbaf7');
    p.rect(x + 5, y + 10, 4, 2, '#555b66');
    p.rect(x + 3, y + 12, 8, 1, '#555b66');
  } else if (facing === 'up') {
    p.rect(x, y, 14, 10, '#434852');
    p.rect(x + 6, y + 4, 2, 2, '#5b616d');
    p.rect(x + 5, y + 10, 4, 3, '#555b66');
  } else {
    p.rect(x + 4, y, 5, 10, '#363b44');
    p.rect(x + 5, y + 1, 1, 8, facing === 'left' ? '#4ea0f2' : '#2b2f36');
    p.rect(x + 5, y + 10, 3, 3, '#555b66');
  }
}

function keyboard(p: Pix, x: number, y: number, facing: Dir) {
  const horiz = facing === 'down' || facing === 'up';
  const [w, h] = horiz ? [9, 4] : [4, 9];
  p.rect(x, y, w, h, '#dfe3e8');
  p.rect(x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2), '#c3c9d1');
}

const DRAW: Record<string, Draw> = {
  desk: (p, { W, H, y0 }) => {
    p.box(0, y0 + 2, W, H - y0 - 2, 7, WOOD, WOOD_D);
    p.rect(2, y0 + 3, 5, 1, shade(WOOD, 0.3));
  },
  desk_pc: (p, { W, H, y0, facing, rot }) => {
    DRAW.desk(p, { W, H, y0, fw: 0, fh: 0, facing, rot });
    const cx = Math.round(W / 2);
    const my = facing === 'down' ? y0 - 8 : facing === 'up' ? y0 - 6 : y0 - 2;
    const mx = facing === 'left' ? W - 12 : facing === 'right' ? 4 : cx - 7;
    monitor(p, facing === 'down' || facing === 'up' ? cx - 7 : mx, facing === 'down' || facing === 'up' ? my : (H + y0) / 2 - 12, facing);
    keyboard(p, facing === 'down' || facing === 'up' ? cx - 4 : facing === 'left' ? 6 : W - 10, facing === 'down' ? H - 14 : facing === 'up' ? y0 + 5 : (H + y0) / 2 - 3, facing);
  },
  desk_l: (p, { W, H, y0 }) => {
    p.box(0, y0 + 2, W, 22, 6, WOOD, WOOD_D);
    p.box(0, y0 + 2, 26, H - y0 - 2, 6, WOOD, WOOD_D);
    monitor(p, 6, y0 - 6, 'down');
  },
  meeting_table: (p, { W, H, y0 }) => {
    p.box(2, y0 + 3, W - 4, H - y0 - 4, 8, '#a67c52', '#7d5b3a');
    p.rect(8, y0 + 7, W - 16, 1, shade('#a67c52', 0.25));
  },
  round_table: (p, { W, H, y0 }) => {
    p.ellipse(W / 2, H - 10, W / 2 - 3, 8, '#7d5b3a');
    p.ellipse(W / 2, H - 14, W / 2 - 3, 9, '#cfb48a');
    p.ellipse(W / 2 - 4, H - 18, 8, 3, '#e3cba3');
    void y0;
  },
  reception_desk: (p, { W, H, y0 }) => {
    p.box(0, y0 + 4, W, H - y0 - 4, 14, '#e9edf3', '#2f5d8a');
    p.rect(0, y0 + 2, W, 3, '#cfd6e0');
    p.rect(6, H - 11, W - 12, 1, '#7fb0e6');
    p.rect(W - 14, y0 + 1, 6, 4, '#2b2f36'); // telefone
  },
  chair: (p, { W, H, y0, facing }) => {
    const x = 6;
    const w = W - 12;
    const seatY = H - 14;
    if (facing === 'up') {
      // de costas para a câmera: o encosto cobre o assento
      p.rect(x, y0 + 4, w, 17, '#475569');
      p.rect(x + 1, y0 + 5, w - 2, 15, '#566377');
      p.rect(x + 2, H - 10, w - 4, 4, '#3a4352');
    } else if (facing === 'down') {
      p.rect(x + 1, y0 + 2, w - 2, 8, '#566377'); // encosto atrás do assento
      p.rect(x, seatY - 2, w, 8, '#475569');
      p.rect(x + 1, seatY - 1, w - 2, 5, '#5f6d82');
    } else {
      const bx = facing === 'left' ? x + w - 4 : x;
      p.rect(bx, y0 + 6, 4, 14, '#566377');
      p.rect(x, seatY - 2, w, 8, '#475569');
      p.rect(x + 1, seatY - 1, w - 2, 5, '#5f6d82');
    }
    p.rect(W / 2 - 1, H - 6, 2, 4, '#2b2f36');
    p.rect(W / 2 - 5, H - 3, 10, 2, '#2b2f36');
  },
  armchair: (p, { W, H, y0, facing }) => {
    const body = '#8b5e3c';
    p.box(3, y0 + 8, W - 6, H - y0 - 8, 8, body, shade(body, -0.25));
    if (facing === 'down') p.rect(3, y0 + 4, W - 6, 8, shade(body, -0.1));
    else if (facing === 'up') p.rect(3, H - 22, W - 6, 14, shade(body, -0.15));
    else p.rect(facing === 'left' ? W - 9 : 3, y0 + 4, 6, H - y0 - 4, shade(body, -0.1));
  },
  sofa: (p, { W, H, y0, facing }) => {
    const body = '#4f7a8c';
    p.box(1, y0 + 8, W - 2, H - y0 - 8, 8, body, shade(body, -0.25));
    if (facing === 'down') p.rect(1, y0 + 3, W - 2, 8, shade(body, -0.12));
    else if (facing === 'up') p.rect(1, H - 22, W - 2, 14, shade(body, -0.18));
    else p.rect(facing === 'left' ? W - 9 : 1, y0 + 3, 8, H - y0 - 3, shade(body, -0.12));
    p.rect(5, y0 + 12, 1, H - y0 - 22, shade(body, 0.2), 0.6);
  },
  pc: (p, { W, H, facing }) => {
    monitor(p, W / 2 - 7, H - 24, facing);
    keyboard(p, W / 2 - 4, H - 8, facing);
  },
  printer: (p, { W, H }) => {
    p.box(3, H - 22, W - 6, 20, 8, '#d7dce3', '#9aa3af');
    p.rect(6, H - 24, W - 12, 3, '#f5f7fa');
    p.rect(8, H - 14, 10, 2, '#4ea0f2');
  },
  server_rack: (p, { W, H }) => {
    p.rect(5, 6, W - 10, H - 8, '#262a31');
    p.rect(7, 8, W - 14, H - 12, '#323741');
    for (let y = 11; y < H - 8; y += 6) {
      p.rect(9, y, W - 18, 3, '#1c1f25');
      p.px(W - 11, y + 1, y % 12 ? '#3ddc84' : '#ffb020');
    }
  },
  tv: (p, { W, H, y0 }) => {
    p.rect(3, y0 - 4, W - 6, 22, '#16181d');
    p.rect(5, y0 - 2, W - 10, 18, '#2a3a52');
    p.rect(8, y0, 14, 2, '#4f6c93');
    p.rect(W / 2 - 4, y0 + 18, 8, 3, '#2b2f36');
    void H;
  },
  whiteboard: (p, { W, y0 }) => {
    p.rect(2, y0 - 6, W - 4, 26, '#9aa3b0');
    p.rect(4, y0 - 4, W - 8, 22, '#f7f8fa');
    p.rect(8, y0, 18, 1, '#4ea0f2');
    p.rect(8, y0 + 4, 26, 1, '#e5574b');
    p.rect(8, y0 + 8, 14, 1, '#3ddc84');
    p.rect(8, y0 + 17, W - 16, 2, '#cfd5dd');
  },
  coffee: (p, { W, H }) => {
    p.box(6, H - 26, W - 12, 24, 6, '#3a3f48', '#262a31');
    p.rect(9, H - 22, W - 18, 6, '#1c1f25');
    p.rect(W / 2 - 2, H - 15, 4, 5, '#c0a070');
    p.rect(W / 2 - 4, H - 8, 8, 3, '#f1ece4');
  },
  cooler: (p, { W, H }) => {
    p.rect(8, H - 28, W - 16, 12, '#9ad0ff');
    p.rect(10, H - 27, 3, 8, '#cfe9ff');
    p.box(7, H - 18, W - 14, 16, 5, '#e1e6ee', '#aab3c0');
    p.rect(W / 2 - 1, H - 12, 2, 2, '#4ea0f2');
  },
  rug: (p, { W, H }) => {
    p.rect(2, 2, W - 4, H - 4, '#b0562f');
    p.rect(5, 5, W - 10, H - 10, '#d98a55');
    p.rect(8, 8, W - 16, H - 16, '#b0562f');
    p.rect(11, 11, W - 22, H - 22, '#e8b27a');
  },
  plant: (p, { W, H }) => plantArt(p, W, H, 14),
  plant_big: (p, { W, H }) => plantArt(p, W, H, 34),
  painting: (p, { W, H }) => {
    p.rect(4, 6, W - 8, H - 14, '#6b4a2e');
    p.rect(6, 8, W - 12, H - 18, '#cfe3f5');
    p.rect(6, H - 20, W - 12, 6, '#5a9e4b');
    p.ellipse(W - 14, 13, 3, 3, '#f5d76e');
  },
  bookshelf: (p, { W, H, y0 }) => {
    p.box(1, y0 - 2, W - 2, H - y0 + 1, 6, '#8a6540', '#5e4429');
    const r = mulberry32(5);
    const cols = ['#c0392b', '#2e86c1', '#27ae60', '#f1c40f', '#8e44ad', '#ecf0f1'];
    for (let row = 0; row < 2; row++) {
      p.rect(3, y0 + 6 + row * 14, W - 6, 1, '#5e4429');
      for (let x = 4; x < W - 6; x += 3) p.rect(x, y0 - 2 + row * 14 + (r() > 0.5 ? 0 : 1), 2, 10 - (r() > 0.6 ? 2 : 0), cols[Math.floor(r() * cols.length)]);
    }
  },
  cabinet: (p, { W, H, y0 }) => {
    p.box(3, y0 + 2, W - 6, H - y0 - 3, 8, '#d7dce3', '#a9b1bd');
    p.rect(W / 2 - 1, y0 + 8, 2, 6, '#7a8393');
  },
  filing: (p, { W, H }) => {
    p.box(4, H - 24, W - 8, 22, 8, '#9aa3b0', '#6f7886');
    for (let y = H - 20; y < H - 8; y += 6) p.rect(W / 2 - 3, y, 6, 1, '#4d5562');
  },
};

function plantArt(p: Pix, W: number, H: number, leafH: number) {
  p.rect(W / 2 - 6, H - 10, 12, 9, '#a85a32');
  p.rect(W / 2 - 7, H - 11, 14, 2, '#c4703f');
  const g = ['#3f8f46', '#4fa955', '#2f7a3a'];
  const r = mulberry32(leafH);
  for (let i = 0; i < 9; i++) p.ellipse(W / 2 + (r() - 0.5) * 16, H - 12 - r() * leafH, 5 + r() * 3, 6 + r() * 3, g[i % 3]);
}

/** Cria o desenho de um móvel já girado. */
export function makeFurniture(a: AssetDef, rot: number): HTMLCanvasElement {
  const { w: fw, h: fh } = footprintSize(a, rot);
  const packed = packFurniture(a, rot, fw, fh);
  if (packed) return packed;
  const W = fw * TILE;
  const H = (fh + a.tall) * TILE;
  const p = new Pix(W, H);
  const facing = rotateDir('down', rot);
  (DRAW[a.id] ?? DRAW.cabinet)(p, { W, H, y0: a.tall * TILE, fw, fh, facing, rot });
  if (!a.flat) p.outline();
  return p.canvas;
}

export const FURNITURE_ASSETS = ASSETS;
