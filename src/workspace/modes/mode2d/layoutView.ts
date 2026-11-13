/**
 * Vista de um layout 2D no Phaser: tilemap (carregado do JSON no formato do Tiled), móveis com profundidade por linha e nomes das salas.
 * Usada pelo escritório (jogar) e pelo editor. O Phaser desenha tudo; o React não participa do loop visual.
 */
import Phaser from 'phaser';
import { ASSET_BY_ID, TILE, TILE_WALL_FRONT, TILE_WALL_TOP, footprintSize, gridOf, layoutToTiled, type Grid, type Layout2D, type Obj2D } from '../../../../shared/office2d';
import { furnitureKey, registerArt } from './textures2d';

let seq = 0;
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
    this.scene.cache.tilemap.add(this.mapKey, { format: Phaser.Tilemaps.Formats.TILED_JSON, data: layoutToTiled(this.layout) });
    this.map = this.scene.make.tilemap({ key: this.mapKey });
    const ts = this.map.addTilesetImage('workspace', 'tiles', TILE, TILE, 0, 0, 1)!;
    this.floor = this.map.createLayer('piso', ts, 0, 0)!.setDepth(0);
    this.walls = this.map.createLayer('paredes', ts, 0, 0)!.setDepth(1);
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
    if (!l.walls[y * l.cols + x]) return 0;
    return y + 1 < l.rows && l.walls[(y + 1) * l.cols + x] ? TILE_WALL_TOP : TILE_WALL_FRONT;
  }
  putFloor(x: number, y: number, id: number) {
    this.layout.floor[y * this.layout.cols + x] = id;
    if (id === 0) this.floor.removeTileAt(x, y);
    else this.floor.putTileAt(id, x, y);
  }
  putWall(x: number, y: number, on: boolean) {
    this.layout.walls[y * this.layout.cols + x] = on ? 1 : 0;
    for (const yy of [y, y - 1]) {
      if (yy < 0) continue;
      const t = this.wallTile(x, yy);
      if (t === 0) this.walls.removeTileAt(x, yy);
      else this.walls.putTileAt(t, x, yy);
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
