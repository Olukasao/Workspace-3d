/**
 * Vista de um layout 2D no Phaser: tilemap (carregado do JSON no formato do Tiled), móveis com profundidade por linha e nomes das salas.
 * Usada pelo escritório (jogar) e pelo editor. O Phaser desenha tudo; o React não participa do loop visual.
 */
import Phaser from 'phaser';
import { ASSET_BY_ID, TILE, rotateDir, TILE_WALL_FRONT, TILE_WALL_TOP, footprintSize, gridOf, layoutToTiled, type Grid, type Layout2D, type Obj2D } from '../../../../shared/office2d';
import { furnitureKey, registerArt } from './textures2d';
import { packWalls } from './art/pack';
import { TILESET_TILES } from '../../../../shared/office2d';

let seq = 0;
/** Linhas do alto da imagem da cadeira de costas que formam o encosto (o desenho do pacote tem o encosto nas primeiras 20 linhas, a partir da linha 18 do quadro). */
const CHAIR_BACK_ROWS = 38;
/** Primeira linha do encosto que cobre quem senta: as de cima ficam atrás, para a cabeça aparecer acima do encosto. */
const CHAIR_BACK_FROM = 28;

/**
 * Parede do pacote Office Pixel Art conforme os vizinhos (indices do tileset do pacote: 0 piso, 1-5 topos, 6-10 frentes, 11-13 laterais...).
 * Parede com o sul aberto mostra a frente (6, 7, 10 ou 17 na ponta de uma divisória); com parede ao sul mostra o topo
 * (2 horizontal, 1/5 cantos, 12 vertical).
 */
/**
 * Faixa de cima da parede (tira de 32 px acima da frente): paredes externas ficam com 2 ladrilhos de altura, como no pacote,
 * e sobra parede para pendurar TV e quadros. Só onde a célula de cima é vazio (fora do prédio), para ninguém andar por cima dela.
 */
function packCapGid(l: Layout2D, x: number, y: number): number {
  const w = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < l.cols && yy < l.rows && l.walls[yy * l.cols + xx] === 1;
  const face = (xx: number) => xx >= 0 && xx < l.cols && y + 1 < l.rows && !w(xx, y) && l.floor[y * l.cols + xx] === 0 && w(xx, y + 1) && !w(xx, y + 2);
  if (!face(x)) return 0;
  const left = !face(x - 1);
  const right = !face(x + 1);
  return TILESET_TILES + (left && !right ? 1 : right && !left ? 5 : 2) + 1;
}

function packWallGid(l: Layout2D, x: number, y: number): number {
  const w = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < l.cols && yy < l.rows && l.walls[yy * l.cols + xx] === 1;
  const n = w(x, y - 1);
  const s = w(x, y + 1);
  const e = w(x + 1, y);
  const west = w(x - 1, y);
  let k: number;
  if (!s) k = n && !e && !west ? 17 : !west && e ? 6 : west && !e ? 10 : 7;
  else k = !e && !west ? 12 : e && !west ? 1 : west && !e ? 5 : 2;
  return TILESET_TILES + k + 1;
}
export const objectDepth = (o: Obj2D) => {
  const a = ASSET_BY_ID.get(o.asset)!;
  return a.flat ? 1 : (o.y + footprintSize(a, o.rot).h) * TILE;
};

export class LayoutView {
  map!: Phaser.Tilemaps.Tilemap;
  floor!: Phaser.Tilemaps.TilemapLayer;
  walls!: Phaser.Tilemaps.TilemapLayer;
  grid: Grid;
  readonly objects = new Map<string, Phaser.GameObjects.Image>();
  private labels: Phaser.GameObjects.Text[] = [];
  private mapKey = '';

  constructor(
    private scene: Phaser.Scene,
    public layout: Layout2D,
    private showLabels = true,
    /** Escritório (jogar): o encosto das cadeiras vistas de costas ganha uma camada na frente de quem senta. */
    private layered = false,
  ) {
    this.grid = gridOf(layout);
    this.build();
  }

  get width() {
    return this.layout.cols * TILE;
  }
  get height() {
    return this.layout.rows * TILE;
  }

  private build() {
    registerArt(this.scene);
    this.mapKey = `map_${++seq}`;
    const data = layoutToTiled(this.layout) as { tilesets: unknown[] };
    // o Phaser só aceita tilesets declarados no JSON do Tiled: declara o das paredes do pacote (gids depois dos nossos)
    if (packWalls()) data.tilesets.push({ firstgid: TILESET_TILES + 1, name: 'packwalls', tilewidth: TILE, tileheight: TILE, tilecount: 25, columns: 8, image: 'packwalls.png', imagewidth: 8 * TILE, imageheight: 4 * TILE });
    this.scene.cache.tilemap.add(this.mapKey, { format: Phaser.Tilemaps.Formats.TILED_JSON, data });
    this.map = this.scene.make.tilemap({ key: this.mapKey });
    const ts = this.map.addTilesetImage('workspace', 'tiles', TILE, TILE, 0, 0, 1)!;
    const pack = packWalls() ? this.map.addTilesetImage('packwalls', 'packwalls', TILE, TILE, 0, 0, TILESET_TILES + 1) : null;
    this.floor = this.map.createLayer('piso', ts, 0, 0)!.setDepth(0);
    this.walls = this.map.createLayer('paredes', pack ? [ts, pack] : ts, 0, 0)!.setDepth(1);
    if (packWalls()) for (let y = 0; y < this.layout.rows; y++) for (let x = 0; x < this.layout.cols; x++) { const t = this.wallTile(x, y); if (t) this.walls.putTileAt(t, x, y); }
    this.buildObjects();
    if (this.showLabels) this.buildLabels();
  }

  private buildObjects() {
    for (const o of this.layout.objects) this.addObject(o);
  }

  addObject(o: Obj2D) {
    const a = ASSET_BY_ID.get(o.asset)!;
    const { h } = footprintSize(a, o.rot);
    const img = this.scene.add.image(o.x * TILE, (o.y + h) * TILE, furnitureKey(a.id, a.rotatable ? o.rot : 0)).setOrigin(0, 1).setDepth(objectDepth(o));
    this.objects.set(o.id, img);
    // cadeira vista de costas: o encosto (parte de cima da imagem) é desenhado por cima de quem está sentado; o assento e as rodinhas ficam atrás dele
    if (this.layered && a.id === 'chair' && rotateDir('down', o.rot) === 'up') {
      const back = this.scene.add.image(img.x, img.y, img.texture.key).setOrigin(0, 1).setDepth(objectDepth(o) + 2).setCrop(0, CHAIR_BACK_FROM, TILE, CHAIR_BACK_ROWS - CHAIR_BACK_FROM);
      img.once(Phaser.GameObjects.Events.DESTROY, () => back.destroy());
    }
    return img;
  }

  private buildLabels() {
    for (const r of this.layout.rooms) {
      const t = this.scene.add
        .text(r.x * TILE + 6, r.y * TILE + 4, r.name, { fontFamily: 'system-ui, sans-serif', fontSize: '9px', color: '#ffffff', backgroundColor: 'rgba(20,24,31,0.55)', padding: { x: 3, y: 1 } })
        .setDepth(1)
        .setAlpha(0.9);
      this.labels.push(t);
    }
  }

  /** Recria os móveis e as salas (depois de colocar, mover ou remover). */
  rebuildObjects() {
    for (const img of this.objects.values()) img.destroy();
    this.objects.clear();
    for (const t of this.labels) t.destroy();
    this.labels = [];
    this.buildObjects();
    if (this.showLabels) this.buildLabels();
    this.grid = gridOf(this.layout);
  }

  /** Troca o layout inteiro (publicação de outro administrador). */
  setLayout(layout: Layout2D) {
    this.destroy();
    this.layout = layout;
    this.grid = gridOf(layout);
    this.build();
  }

  // --- pintura (editor): altera o layout e só os ladrilhos afetados ---
  wallTile(x: number, y: number) {
    const l = this.layout;
    if (!l.walls[y * l.cols + x]) return packWalls() ? packCapGid(l, x, y) : 0;
    if (packWalls()) return packWallGid(l, x, y);
    return y + 1 < l.rows && l.walls[(y + 1) * l.cols + x] ? TILE_WALL_TOP : TILE_WALL_FRONT;
  }
  putFloor(x: number, y: number, id: number) {
    this.layout.floor[y * this.layout.cols + x] = id;
    if (id === 0) this.floor.removeTileAt(x, y);
    else this.floor.putTileAt(id, x, y);
  }
  putWall(x: number, y: number, on: boolean) {
    this.layout.walls[y * this.layout.cols + x] = on ? 1 : 0;
    // com o pacote a forma de cada parede depende dos vizinhos (3×3 ao redor); sem ele só a de cima muda
    const near = packWalls() ? [-1, 0, 1] : [0];
    for (const dy of packWalls() ? [-1, 0, 1] : [0, -1]) for (const dx of near) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= this.layout.cols || yy >= this.layout.rows) continue;
      const t = this.wallTile(xx, yy);
      if (t === 0) this.walls.removeTileAt(xx, yy);
      else this.walls.putTileAt(t, xx, yy);
    }
  }
  refreshGrid() {
    this.grid = gridOf(this.layout);
  }

  destroy() {
    for (const img of this.objects.values()) img.destroy();
    this.objects.clear();
    for (const t of this.labels) t.destroy();
    this.labels = [];
    // o Phaser solta as referências da cena ao destruir o mapa: guarda o cache antes e tolera cena já encerrada
    const cache = this.scene.cache?.tilemap;
    this.map?.destroy();
    cache?.remove(this.mapKey);
  }
}
