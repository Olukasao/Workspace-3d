/** Texturas do 2D no Phaser: tileset, móveis (todos os giros) e folhas de sprites dos personagens (com contagem de uso). */
import Phaser from 'phaser';
import { ASSETS, TILE, TILESET_TILES } from '../../../../shared/office2d';
import type { Avatar2DConfig } from '../../../../shared/avatar2d';
import { FH, FW, SHEET_COLS, composeSheet, sheetKey } from './art/characters';
import { makeFurniture } from './art/furniture';
import { makeTileset } from './art/tiles';

export const furnitureKey = (asset: string, rot: number) => `f_${asset}_${rot}`;

/** Registra tileset e móveis (uma vez por jogo). */
export function registerArt(scene: Phaser.Scene) {
  const tx = scene.textures;
  if (!tx.exists('tiles')) {
    tx.addCanvas('tiles', makeTileset());
    // `add` precisa do nome da textura de origem: cada ladrilho vira um quadro (útil para a paleta do editor)
    const t = tx.get('tiles');
    for (let i = 0; i < TILESET_TILES; i++) t.add(i, 0, i * TILE, 0, TILE, TILE);
  }
  for (const a of ASSETS) for (const rot of a.rotatable ? [0, 1, 2, 3] : [0]) if (!tx.exists(furnitureKey(a.id, rot))) tx.addCanvas(furnitureKey(a.id, rot), makeFurniture(a, rot));
}

export const frameName = (row: number, col: number) => `${row}_${col}`;
const refs = new Map<string, number>();

/** Garante a folha de sprites desta aparência e conta mais um uso. Devolve a chave da textura. */
export function acquireAvatar(scene: Phaser.Scene, cfg: Avatar2DConfig, headset: boolean): string {
  const key = sheetKey(cfg, headset);
  if (!scene.textures.exists(key)) {
    const t = scene.textures.addCanvas(key, composeSheet(cfg, headset));
    if (t) for (let row = 0; row < 4; row++) for (let col = 0; col < SHEET_COLS; col++) t.add(frameName(row, col), 0, col * FW, row * FH, FW, FH);
  }
  refs.set(key, (refs.get(key) ?? 0) + 1);
  return key;
}

/** Libera um uso; quando ninguém mais usa a folha, a textura sai da memória. */
export function releaseAvatar(scene: Phaser.Scene, key: string) {
  const n = (refs.get(key) ?? 1) - 1;
  if (n > 0) return void refs.set(key, n);
  refs.delete(key);
  if (scene.textures.exists(key)) scene.textures.remove(key);
}
export const resetAvatarRefs = () => refs.clear();
