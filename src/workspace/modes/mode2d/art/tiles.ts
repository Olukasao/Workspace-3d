/** Tileset do escritório 2D (pisos e paredes), pintado por código. Ordem = ids de shared/office2d (piso 1..8, topo da parede, frente da parede). */
import { TILE, TILESET_TILES } from '../../../../../shared/office2d';
import { Pix, mulberry32, shade } from './pixel';
import { packFloors } from './pack';

type Painter = (p: Pix, ox: number) => void;
const noise = (p: Pix, ox: number, seed: number, colors: string[], count: number) => {
  const r = mulberry32(seed);
  for (let i = 0; i < count; i++) p.px(ox + Math.floor(r() * TILE), Math.floor(r() * TILE), colors[Math.floor(r() * colors.length)]);
};

const FLOOR_PAINTERS: Painter[] = [
  // 1 madeira
  (p, ox) => {
    p.rect(ox, 0, TILE, TILE, '#c79b63');
    for (let y = 0; y < TILE; y += 8) {
      p.rect(ox, y, TILE, 1, '#a87c47');
      p.rect(ox + ((y / 8) % 2 ? 10 : 22), y + 1, 1, 7, '#b88b55');
    }
    noise(p, ox, 11, ['#b98c56', '#d4aa73'], 18);
  },
  // 2 carpete azul
  (p, ox) => {
    p.rect(ox, 0, TILE, TILE, '#3f5f8f');
    noise(p, ox, 22, ['#4a6c9e', '#365581'], 90);
  },
  // 3 carpete cinza
  (p, ox) => {
    p.rect(ox, 0, TILE, TILE, '#8c9199');
    noise(p, ox, 33, ['#9aa0a8', '#7d838b'], 90);
  },
  // 4 cerâmica clara
  (p, ox) => {
    p.rect(ox, 0, TILE, TILE, '#e7eaef');
    p.rect(ox, 0, TILE, 1, '#cfd5dd');
    p.rect(ox, 0, 1, TILE, '#cfd5dd');
    p.rect(ox + 2, 2, 6, 1, '#f6f8fb');
  },
  // 5 xadrez
  (p, ox) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) p.rect(ox + x * 16, y * 16, 16, 16, (x + y) % 2 ? '#a3acb7' : '#e1e5ea');
  },
  // 6 concreto
  (p, ox) => {
    p.rect(ox, 0, TILE, TILE, '#9b9fa6');
    noise(p, ox, 66, ['#a9adb4', '#8c9097', '#b4b8be'], 70);
  },
  // 7 carpete vinho
  (p, ox) => {
    p.rect(ox, 0, TILE, TILE, '#7a2f3d');
    noise(p, ox, 77, ['#873848', '#6a2833'], 90);
  },
  // 8 grama
  (p, ox) => {
    p.rect(ox, 0, TILE, TILE, '#5a9e4b');
    const r = mulberry32(88);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(r() * TILE);
      const y = Math.floor(r() * (TILE - 3));
      p.rect(ox + x, y, 1, 3, r() > 0.5 ? '#6fb55d' : '#4a8a3e');
    }
  },
];

/** Cria o tileset (uma linha de TILE×TILE) como canvas. */
export function makeTileset(): HTMLCanvasElement {
  const p = new Pix(TILE * TILESET_TILES, TILE);
  FLOOR_PAINTERS.forEach((paint, i) => paint(p, i * TILE));
  // pisos do pacote Office Pixel Art no lugar de madeira (1), carpete cinza (3) e concreto (6)
  const pk = packFloors();
  if (pk) [[0, 0], [2, TILE], [5, TILE * 2]].forEach(([tile, sx]) => p.g.drawImage(pk, sx, 0, TILE, TILE, tile * TILE, 0, TILE, TILE));
  // topo da parede (a parede continua para o sul)
  let ox = FLOOR_PAINTERS.length * TILE;
  p.rect(ox, 0, TILE, TILE, '#4b505b');
  p.rect(ox, 0, TILE, 2, '#6b7280');
  p.rect(ox + 4, 8, TILE - 8, 1, '#434853', 0.8);
  // frente da parede (a parede termina aqui, vista de frente)
  ox += TILE;
  p.rect(ox, 0, TILE, TILE, '#9aa2b1');
  p.rect(ox, 0, TILE, 4, '#6b7280'); // topo
  p.rect(ox, 4, TILE, 1, shade('#9aa2b1', 0.3));
  for (let y = 10; y < TILE - 4; y += 9) for (let x = 0; x < TILE; x += 16) p.rect(ox + x + (((y - 10) / 9) % 2 ? 8 : 0), y, 15, 1, '#838b9a');
  p.rect(ox, TILE - 5, TILE, 5, '#5f6573'); // rodapé
  p.rect(ox, TILE - 6, TILE, 1, '#7c8493');
  return p.canvas;
}
