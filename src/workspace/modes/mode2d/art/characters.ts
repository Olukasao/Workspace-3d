/**
 * Personagens 2D em camadas, pintados por código: para uma aparência (shared/avatar2d.ts) gera uma folha de sprites
 * (32×48 por quadro) com 4 direções e as animações andar, parado, sentado, digitando e falando (em pé e sentado).
 * Acrescentar uma roupa ou um acessório = incluir o id em shared/avatar2d.ts e uma função em `LAYERS` abaixo; o motor não muda.
 *
 * Folha (colunas): 0-3 andar · 4 parado · 5 sentado · 6-7 digitando (sentado) · 8-9 falando (em pé) · 10-11 falando (sentado)
 * Folha (linhas): 0 frente (baixo) · 1 esquerda · 2 direita (espelho da esquerda) · 3 costas (cima)
 */
import { SKIN2D, type Avatar2DConfig } from '../../../../../shared/avatar2d';
import type { Dir } from '../../../../../shared/office2d';
import { drawFrame, layersReady } from './layers';
import { LPC_FRAME, composeAnim, headBox, lpcLoaded, lpcRow } from './lpc';
import { Pix, shade } from './pixel';

const OFW = 32;
const OFH = 48;
const OSHEET_COLS = 12;
const OANIMS = {
  walk: { start: 0, frames: 4 },
  idle: { start: 4, frames: 1 },
  sit: { start: 5, frames: 1 },
  type: { start: 6, frames: 2 },
  talk: { start: 8, frames: 2 },
  sittalk: { start: 10, frames: 2 },
} as const;
type OldAnim = keyof typeof OANIMS;
export const ROW: Record<Dir, number> = { down: 0, left: 1, right: 2, up: 3 };
const OFOOT_Y = 45; // chão do personagem dentro do quadro

interface Pose {
  dir: Dir; // down | left | up (right é o espelho de left)
  anim: OldAnim;
  i: number;
  sitting: boolean;
  bob: number;
  swing: number; // -1, 0, 1: passada
}
interface Look {
  skin: string;
  skinD: string;
  hair: string;
  shirt: string;
  pants: string;
  shoes: string;
  cfg: Avatar2DConfig;
  headset: boolean;
}

const HEAD = { x: 10, y: 6, w: 12, h: 12 };

function drawLegs(p: Pix, L: Look, o: Pose, ty: number) {
  const cx = 16;
  const side = o.dir === 'left';
  const front = o.dir === 'down';
  const cfg = L.cfg;
  const legTop = ty + 12; // logo abaixo do tronco
  if (o.sitting) {
    const ly = legTop - 1;
    if (front) {
      p.rect(cx - 6, ly, 12, 6, L.pants);
      if (cfg.pants === 'shorts' || cfg.pants === 'skirt') p.rect(cx - 6, ly + 3, 12, 3, L.skin);
      p.rect(cx - 6, ly + 6, 5, 4, L.pants);
      p.rect(cx + 1, ly + 6, 5, 4, L.pants);
      shoes(p, L, cx - 6, ly + 10, 5);
      shoes(p, L, cx + 1, ly + 10, 5);
    } else if (side) {
      p.rect(cx - 8, ly, 14, 5, L.pants);
      p.rect(cx - 9, ly + 4, 4, 6, L.pants);
      shoes(p, L, cx - 10, ly + 10, 5);
    } else {
      p.rect(cx - 6, ly, 12, 5, L.pants);
    }
    return;
  }
  const s = o.swing;
  const draw = (x: number, dy: number, w: number) => {
    const h = 12 - dy;
    const y = legTop + dy;
    const short = cfg.pants === 'shorts' || cfg.pants === 'skirt';
    p.rect(x, y, w, h - 3, short ? L.skin : L.pants);
    if (short) p.rect(x, y, w, cfg.pants === 'skirt' ? 1 : 4, L.pants);
    else p.rect(x, y + h - 4, w, 1, shade(L.pants, -0.15));
    shoes(p, L, x - (side ? 1 : 0), y + h - 3, w + (side ? 2 : 0));
  };
  if (side) {
    draw(cx - 3 + s * 2, 0, 5);
    draw(cx - 3 - s * 2, 1, 5);
  } else {
    draw(cx - 5, s > 0 ? 1 : 0, 5);
    draw(cx, s < 0 ? 1 : 0, 5);
  }
  if (cfg.pants === 'skirt') p.rect(cx - 6, ty + 10, 12, 5, L.pants);
}

function shoes(p: Pix, L: Look, x: number, y: number, w: number) {
  const { shoes: id } = L.cfg;
  p.rect(x, y, w, 3, L.shoes);
  if (id === 'sneakers') p.rect(x, y + 2, w, 1, '#f1f3f5');
  else if (id === 'formal') p.px(x + 1, y, shade(L.shoes, 0.4));
  else if (id === 'boots') p.rect(x, y - 2, w, 2, L.shoes);
}

function drawTorso(p: Pix, L: Look, o: Pose, ty: number) {
  const cx = 16;
  const side = o.dir === 'left';
  const back = o.dir === 'up';
  const tw = side ? 8 : 12;
  const x = cx - tw / 2;
  const shirt = L.shirt;
  const dark = shade(shirt, -0.18);
  const id = L.cfg.shirt;
  // tronco
  p.rect(x, ty, tw, 12, shirt);
  p.rect(x, ty + 11, tw, 1, dark);
  if (id === 'blazer') {
    p.rect(x, ty, tw, 12, shade(shirt, -0.1));
    if (!back && !side) {
      p.rect(cx - 2, ty, 4, 9, '#f4f6f8'); // camisa por baixo
      p.rect(cx - 3, ty, 1, 7, dark);
      p.rect(cx + 2, ty, 1, 7, dark);
      p.rect(cx, ty + 2, 1, 6, '#c0392b'); // gravata
    }
  } else if (id === 'shirt' && !back) {
    p.rect(cx - 2, ty, 4, 2, '#f4f6f8');
    p.rect(cx, ty + 2, 1, 10, dark);
  } else if (id === 'polo' && !back && !side) {
    p.rect(cx - 2, ty, 4, 3, shade(shirt, 0.25));
    p.px(cx, ty + 4, dark);
    p.px(cx, ty + 6, dark);
  } else if (id === 'hoodie') {
    p.rect(x - 1, ty - 1, tw + 2, 3, dark);
    if (!back && !side) p.rect(cx - 1, ty + 2, 2, 5, shade(shirt, 0.3));
  }
  // braços
  const armsY = ty + 1;
  const swing = o.anim === 'walk' ? o.swing : 0;
  const long = id !== 'tee' && id !== 'polo';
  const arm = (ax: number, dy: number, len: number) => {
    p.rect(ax, armsY + dy, 3, long ? len : 5, shirt);
    if (!long) p.rect(ax, armsY + dy + 5, 3, len - 5, L.skin);
    p.rect(ax, armsY + dy + len, 3, 2, L.skin);
  };
  const typing = o.anim === 'type';
  const talking = o.anim === 'talk' || o.anim === 'sittalk';
  if (side) {
    const dy = o.sitting ? 2 : swing;
    arm(cx - 1, dy, o.sitting ? 7 : 9);
  } else if (o.sitting && (typing || o.anim === 'sit')) {
    const f = typing ? o.i % 2 : 0;
    const len = back ? 6 : 7;
    arm(cx - 8, 2, len);
    arm(cx + 5, 2, len);
    if (!back) {
      p.rect(cx - 5, ty + 8 + f, 3, 2, L.skin); // mãos no teclado
      p.rect(cx + 2, ty + 9 - f, 3, 2, L.skin);
    }
  } else {
    arm(cx - 8, swing > 0 ? 1 : 0, 9);
    if (talking) {
      p.rect(cx + 5, armsY - 1 - (o.i % 2), 3, 7, shirt); // gesto com a mão direita
      p.rect(cx + 5, armsY - 3 - (o.i % 2), 3, 2, L.skin);
    } else arm(cx + 5, swing < 0 ? 1 : 0, 9);
  }
}

function drawHead(p: Pix, L: Look, o: Pose, hy: number) {
  const side = o.dir === 'left';
  const back = o.dir === 'up';
  const w = side ? 10 : HEAD.w;
  const x = side ? 11 : HEAD.x;
  p.rect(x, hy, w, HEAD.h, L.skin);
  p.rect(x + 1, hy + HEAD.h - 1, w - 2, 1, L.skinD); // sombra do queixo
  p.rect(14, hy + HEAD.h, 4, 2, L.skinD); // pescoço
  if (!back) {
    const eyeY = hy + 6;
    if (side) p.rect(x + 2, eyeY, 2, 2, '#1c2028');
    else {
      p.rect(x + 2, eyeY, 2, 2, '#1c2028');
      p.rect(x + w - 4, eyeY, 2, 2, '#1c2028');
    }
    const talk = (o.anim === 'talk' || o.anim === 'sittalk') && o.i % 2 === 1;
    p.rect(side ? x + 2 : 14, hy + 9, side ? 2 : 4, talk ? 2 : 1, shade(L.skin, -0.45));
    if (L.cfg.glasses) {
      const gc = '#1c2028';
      if (side) p.rect(x, eyeY - 1, 5, 1, gc);
      p.rect(side ? x + 1 : x + 1, eyeY - 1, side ? 4 : 4, 4, gc, 0.0);
      if (side) {
        p.rect(x + 1, eyeY - 1, 4, 1, gc);
        p.rect(x + 1, eyeY + 2, 4, 1, gc);
      } else {
        p.rect(x + 1, eyeY - 1, 4, 1, gc);
        p.rect(x + 1, eyeY + 2, 4, 1, gc);
        p.rect(x + w - 5, eyeY - 1, 4, 1, gc);
        p.rect(x + w - 5, eyeY + 2, 4, 1, gc);
        p.rect(x + 5, eyeY, 2, 1, gc);
      }
    }
    if (L.cfg.facial === 'mustache') p.rect(side ? x + 1 : 13, hy + 8, side ? 3 : 6, 1, L.hair);
    if (L.cfg.facial === 'beard') {
      p.rect(x + 1, hy + 9, w - 2, 3, L.hair);
      p.rect(side ? x + 2 : 14, hy + 9, side ? 2 : 4, talk ? 2 : 1, shade(L.skin, -0.45));
    }
  }
}

function drawHair(p: Pix, L: Look, o: Pose, hy: number, behind: boolean) {
  const style = L.cfg.hair;
  if (style === 'bald') return;
  const side = o.dir === 'left';
  const back = o.dir === 'up';
  const w = side ? 10 : HEAD.w;
  const x = side ? 11 : HEAD.x;
  const c = L.hair;
  const dk = shade(c, -0.2);
  if (behind) {
    // cabelo que fica atrás do corpo (longo / chanel / rabo de cavalo)
    if (style === 'long') p.rect(x - 1, hy + 4, w + 2, back ? 20 : 16, dk);
    if (style === 'bob') p.rect(x - 1, hy + 3, w + 2, back ? 13 : 11, dk);
    return;
  }
  const cap = (h: number) => p.rect(x - (style === 'afro' ? 2 : 0), hy - 1 - (style === 'afro' ? 2 : 0), w + (style === 'afro' ? 4 : 0), h + (style === 'afro' ? 2 : 0), c);
  switch (style) {
    case 'short':
    case 'side':
      cap(back ? 11 : 5);
      if (!back) {
        p.rect(x, hy + 3, 2, 4, c);
        if (!side) p.rect(x + w - 2, hy + 3, 2, 4, c);
        if (style === 'side') p.rect(x + 1, hy + 3, side ? 5 : 7, 2, dk);
      }
      break;
    case 'long':
      cap(back ? 12 : 5);
      if (!back) {
        p.rect(x - 1, hy + 3, 3, 14, c);
        if (!side) p.rect(x + w - 2, hy + 3, 3, 14, c);
      }
      break;
    case 'bob':
      cap(back ? 12 : 5);
      if (!back) {
        p.rect(x - 1, hy + 3, 3, 9, c);
        if (!side) p.rect(x + w - 2, hy + 3, 3, 9, c);
      }
      break;
    case 'ponytail':
      cap(back ? 11 : 5);
      if (!back) p.rect(x, hy + 3, 2, 3, c);
      if (back) p.rect(14, hy + 9, 4, 11, dk);
      else if (side) p.rect(x + w - 1, hy + 4, 3, 9, dk);
      break;
    case 'bun':
      cap(back ? 11 : 5);
      p.rect(14, hy - 4, 5, 4, c);
      break;
    case 'afro':
      cap(back ? 14 : 8);
      break;
    case 'buzz':
      p.rect(x, hy - 1, w, back ? 8 : 3, c, 0.85);
      break;
  }
}

function drawHeadset(p: Pix, L: Look, o: Pose, hy: number) {
  if (!L.headset) return;
  const side = o.dir === 'left';
  const back = o.dir === 'up';
  const w = side ? 10 : HEAD.w;
  const x = side ? 11 : HEAD.x;
  const c = '#262a31';
  p.rect(x, hy - 2, w, 2, c); // arco
  if (side) {
    p.rect(x + 3, hy + 5, 4, 5, c);
    p.rect(x + 4, hy + 6, 2, 3, '#3b82f6');
  } else {
    p.rect(x - 2, hy + 4, 3, 6, c);
    p.rect(x + w - 1, hy + 4, 3, 6, c);
    p.rect(x - 1, hy + 6, 1, 3, '#3b82f6');
    if (!back) {
      p.rect(x - 1, hy + 9, 2, 3, c);
      p.rect(x, hy + 11, 5, 1, c); // microfone
      p.rect(x + 4, hy + 10, 2, 2, '#3b82f6');
    }
  }
}

function frame(p: Pix, ox: number, oy: number, L: Look, o: Pose) {
  const sub = new Pix(OFW, OFH);
  const sit = o.sitting ? 5 : 0;
  const ty = 18 + o.bob + sit; // topo do tronco
  const hy = HEAD.y + o.bob + sit;
  sub.ellipse(16, OFOOT_Y - 1, 9, 3, '#000000', 0.22); // sombra
  drawHair(sub, L, o, hy, true);
  drawLegs(sub, L, o, ty);
  drawTorso(sub, L, o, ty);
  drawHead(sub, L, o, hy);
  drawHair(sub, L, o, hy, false);
  drawHeadset(sub, L, o, hy);
  sub.outline('#1c2028', 0.9);
  p.g.drawImage(sub.canvas, ox, oy);
}

/** Folha com as camadas do pacote Bumblebee (CC0). Os pés ficam na linha OFOOT_Y do quadro de 32×48. */
function composeLayered(cfg: Avatar2DConfig, headset: boolean): HTMLCanvasElement {
  const sheet = document.createElement('canvas');
  sheet.width = OFW * OSHEET_COLS;
  sheet.height = OFH * 4;
  const sg = sheet.getContext('2d')!;
  sg.imageSmoothingEnabled = false;
  const tmp = document.createElement('canvas');
  tmp.width = 32;
  tmp.height = 32;
  const tg = tmp.getContext('2d')!;
  tg.imageSmoothingEnabled = false;
  const oy = OFOOT_Y - 31; // o pé do pacote está na linha 31
  const put = (dir: Dir, col: number, anim: 'Idle' | 'Walk', pc: number, sitting: boolean, dy: number) => {
    tg.clearRect(0, 0, 32, 32);
    drawFrame(tg, cfg, { anim, col: pc, dir, glasses: cfg.glasses, headset });
    if (sitting) tg.clearRect(0, 27, 32, 5); // as pernas ficam atrás da mesa
    sg.drawImage(tmp, col * OFW, ROW[dir] * OFH + oy + dy);
  };
  for (const dir of ['down', 'left', 'right', 'up'] as const) {
    for (let i = 0; i < 4; i++) put(dir, OANIMS.walk.start + i, 'Walk', i, false, 0);
    put(dir, OANIMS.idle.start, 'Idle', 0, false, 0);
    put(dir, OANIMS.sit.start, 'Idle', 0, true, 0);
    for (let i = 0; i < 2; i++) {
      put(dir, OANIMS.type.start + i, 'Idle', i ? 2 : 0, true, i ? -1 : 0);
      put(dir, OANIMS.talk.start + i, 'Idle', i ? 1 : 0, false, i ? -1 : 0);
      put(dir, OANIMS.sittalk.start + i, 'Idle', i ? 1 : 0, true, i ? -1 : 0);
    }
  }
  return sheet;
}

/** Folha de sprites completa de uma aparência (com ou sem o headset visível). */
function composeOld(cfg: Avatar2DConfig, headset: boolean): HTMLCanvasElement {
  if (layersReady()) return composeLayered(cfg, headset);
  // sem o pacote: personagem pintado por código, com peças padrão (os ids novos não existem nesta arte)
  cfg = { ...cfg, hair: 'short', shirt: 'tee', shirtColor: '#3a5a8a', pants: 'long', pantsColor: '#26324a', shoes: 'sneakers', shoesColor: '#1a1410', facial: 'none' };
  const skin = SKIN2D.find((s) => s.id === cfg.skin)?.hex ?? SKIN2D[1].hex;
  const L: Look = { skin, skinD: shade(skin, -0.14), hair: cfg.hairColor, shirt: cfg.shirtColor, pants: cfg.pantsColor, shoes: cfg.shoesColor, cfg, headset };
  const sheet = new Pix(OFW * OSHEET_COLS, OFH * 4);
  for (const dir of ['down', 'left', 'up'] as const) {
    for (const [name, def] of Object.entries(OANIMS) as Array<[OldAnim, (typeof OANIMS)[OldAnim]]>) {
      for (let i = 0; i < def.frames; i++) {
        const sitting = name === 'sit' || name === 'type' || name === 'sittalk';
        const bob = name === 'walk' ? (i % 2 ? -1 : 0) : name === 'talk' || name === 'sittalk' ? (i % 2 ? -1 : 0) : 0;
        const swing = name === 'walk' ? [0, 1, 0, -1][i] : 0;
        frame(sheet, (def.start + i) * OFW, ROW[dir] * OFH, L, { dir, anim: name, i, sitting, bob, swing });
      }
    }
  }
  // direita = esquerda espelhada
  sheet.g.save();
  sheet.g.translate(0, 0);
  for (let c = 0; c < OSHEET_COLS; c++) {
    sheet.g.save();
    sheet.g.translate((c + 1) * OFW, ROW.right * OFH);
    sheet.g.scale(-1, 1);
    sheet.g.drawImage(sheet.canvas, c * OFW, ROW.left * OFH, OFW, OFH, 0, 0, OFW, OFH);
    sheet.g.restore();
  }
  sheet.g.restore();
  return sheet.canvas;
}

export const sheetKey = (cfg: Avatar2DConfig, headset: boolean) => `av2d:${headset ? 'h' : 'n'}:${cfg.skin}:${cfg.hair}:${cfg.hairColor}:${cfg.shirt}:${cfg.shirtColor}:${cfg.pants}:${cfg.pantsColor}:${cfg.shoes}:${cfg.shoesColor}:${cfg.facial}:${cfg.glasses ? 1 : 0}`;

// ---------- folha final: quadros de 64×64 para todos os estilos ----------
export const FW = 64;
export const FH = 64;
export const SHEET_COLS = 16;
export const FOOT_Y = 61; // chão do personagem dentro do quadro (pés do LPC)
/** Colunas da folha: andar 0-7 · parado 8 · sentado 9 · digitando 10-11 (sentado) · falando 12-13 (em pé) · falando sentado 14-15 */
export const ANIMS = {
  walk: { start: 0, frames: 8 },
  idle: { start: 8, frames: 1 },
  sit: { start: 9, frames: 1 },
  type: { start: 10, frames: 2 },
  talk: { start: 12, frames: 2 },
  sittalk: { start: 14, frames: 2 },
} as const;
export type AnimName = keyof typeof ANIMS;

/** Personagem pequeno (32×48): recoloca cada quadro no quadro de 64×64 e repete o andar para completar os 8 passos. */
function reframeOld(old: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = FW * SHEET_COLS;
  out.height = FH * 4;
  const g = out.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const from = (c: number) => (c < 8 ? c % 4 : c === 8 ? 4 : c === 9 ? 5 : c - 4); // coluna nova → coluna antiga
  for (let r = 0; r < 4; r++) for (let c = 0; c < SHEET_COLS; c++) g.drawImage(old, from(c) * OFW, r * OFH, OFW, OFH, c * FW + (FW - OFW) / 2, r * FH + (FOOT_Y - OOFOOT), OFW, OFH);
  old.width = 0;
  return out;
}
const OOFOOT = OFOOT_Y;

/** Quadros do LPC nas colunas e linhas da nossa folha, com o headset desenhado por cima. */
function composeLpc(cfg: Avatar2DConfig, headset: boolean): HTMLCanvasElement | null {
  if (!lpcLoaded(cfg)) return null;
  const sheets = { walk: composeAnim(cfg, 'walk'), idle: composeAnim(cfg, 'idle'), sit: composeAnim(cfg, 'sit') };
  if (!sheets.walk || !sheets.idle || !sheets.sit) return null;
  const out = document.createElement('canvas');
  out.width = FW * SHEET_COLS;
  out.height = FH * 4;
  const g = out.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  // `shift`: a parte de cima (acima da linha `split`) desce 1 px, o resto fica parado; assim o corpo respira ou balança a cabeça sem pular
  const put = (dir: Dir, col: number, anim: 'walk' | 'idle' | 'sit', src: number, shift = 0, split = 0) => {
    const lr = lpcRow(dir);
    const ox = col * FW;
    const oy = ROW[dir] * FH;
    const sheet = sheets[anim]!;
    if (shift && split) {
      g.drawImage(sheet, src * LPC_FRAME, lr * LPC_FRAME + split, LPC_FRAME, LPC_FRAME - split, ox, oy + split, FW, FH - split);
      g.drawImage(sheet, src * LPC_FRAME, lr * LPC_FRAME, LPC_FRAME, split, ox, oy + shift, FW, split);
    } else g.drawImage(sheet, src * LPC_FRAME, lr * LPC_FRAME, LPC_FRAME, LPC_FRAME, ox, oy, FW, FH);
    if (headset) drawLpcHeadset(g, ox, oy + (shift && split ? shift : 0), dir, headBox(cfg, anim, src, lr));
  };
  const SIT = 2; // quadro do LPC com as pernas para baixo (pose de cadeira); os quadros 0 e 1 são sentados no chão
  for (const dir of ['down', 'left', 'right', 'up'] as const) {
    for (let i = 0; i < 8; i++) put(dir, ANIMS.walk.start + i, 'walk', i + 1);
    put(dir, ANIMS.idle.start, 'idle', 0);
    put(dir, ANIMS.sit.start, 'sit', SIT);
    for (let i = 0; i < 2; i++) {
      put(dir, ANIMS.type.start + i, 'sit', SIT, i, 46); // digitando: o tronco sobe e desce 1 px
      put(dir, ANIMS.talk.start + i, 'idle', i); // falando em pé: as duas poses do parado (respiração)
      put(dir, ANIMS.sittalk.start + i, 'sit', SIT, i, 34); // falando sentado: a cabeça acena 1 px
    }
  }
  for (const k of Object.keys(sheets)) (sheets[k as keyof typeof sheets] as HTMLCanvasElement).width = 0;
  return out;
}

function drawLpcHeadset(g: CanvasRenderingContext2D, ox: number, oy: number, dir: Dir, b: { x0: number; y0: number; x1: number; y1: number } | null) {
  if (!b) return;
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(ox + x, oy + y, w, h);
  };
  const midY = b.y0 + Math.round((b.y1 - b.y0) * 0.45);
  if (dir === 'down' || dir === 'up') {
    px(b.x0 + 2, b.y0 + 1, b.x1 - b.x0 - 3, 1, '#2b2d33'); // arco
    px(b.x0, b.y0 + 3, 1, midY - b.y0 - 2, '#2b2d33');
    px(b.x1, b.y0 + 3, 1, midY - b.y0 - 2, '#2b2d33');
    px(b.x0 - 2, midY, 3, 6, '#2b2d33'); // fones
    px(b.x1, midY, 3, 6, '#2b2d33');
    px(b.x0 - 2, midY, 1, 1, '#6b7280');
    px(b.x1 + 2, midY, 1, 1, '#6b7280');
    if (dir === 'down') px(b.x0 - 1, midY + 6, 5, 1, '#2b2d33'); // microfone
  } else {
    const cx = Math.round((b.x0 + b.x1) / 2);
    px(b.x0 + 3, b.y0 + 1, b.x1 - b.x0 - 5, 1, '#2b2d33');
    px(cx - 2, midY - 1, 5, 7, '#2b2d33');
    px(cx - 2, midY - 1, 1, 1, '#6b7280');
  }
}

/** Folha de sprites completa de uma aparência (com ou sem o headset visível). */
export function composeSheet(cfg: Avatar2DConfig, headset: boolean): HTMLCanvasElement {
  if (cfg.look === 'lpc') {
    const lpc = composeLpc(cfg, headset);
    if (lpc) return lpc;
  }
  return reframeOld(composeOld(cfg, headset));
}
