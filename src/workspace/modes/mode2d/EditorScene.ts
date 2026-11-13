/**
 * Cena do editor 2D (administrador): pinta piso e paredes, coloca/move/gira/remove móveis, marca entradas.
 * Toda alteração é feita direto no layout em memória (o mesmo formato que o servidor valida); o React só mostra a barra
 * de ferramentas e salva. Arrastar com o botão direito (ou com a ferramenta "Mover vista") move a câmera.
 */
import Phaser from 'phaser';
import { ASSET_BY_ID, FLOORS, TILE, footprintCells, footprintSize, inBounds, seatOfObject, WALL_MOUNT, type Layout2D, type Obj2D } from '../../../../shared/office2d';
import { LayoutView, objectDepth } from './layoutView';
import { furnitureKey } from './textures2d';

export type Tool =
  | { kind: 'select' }
  | { kind: 'pan' }
  | { kind: 'wall' }
  | { kind: 'floor'; floor: number }
  | { kind: 'erase' }
  | { kind: 'spawn' }
  | { kind: 'place'; asset: string };

export interface EditorBridge {
  layout: Layout2D;
  tool: () => Tool;
  /** algo mudou no layout (marca como não salvo) */
  onChange: () => void;
  onSelect: (id: string | null) => void;
}

export class EditorScene extends Phaser.Scene {
  view!: LayoutView;
  selected: string | null = null;
  private rot: 0 | 1 | 2 | 3 = 0;
  private ghost!: Phaser.GameObjects.Image;
  private marker!: Phaser.GameObjects.Graphics;
  private grid!: Phaser.GameObjects.Graphics;
  private spawnMarks!: Phaser.GameObjects.Graphics;
  private dragObj: { id: string; dx: number; dy: number; moved: boolean } | null = null;
  private panning: { x: number; y: number } | null = null;
  private painting = false;
  private keys!: { R: Phaser.Input.Keyboard.Key; DEL: Phaser.Input.Keyboard.Key; BACK: Phaser.Input.Keyboard.Key; ESC: Phaser.Input.Keyboard.Key };

  constructor(private bridge: EditorBridge) {
    super('editor2d');
  }

  private get layout() {
    return this.bridge.layout;
  }

  create() {
    const g = this.sys.game;
    if ((g as unknown as { pendingDestroy?: boolean }).pendingDestroy === true || !g.renderer) return; // o React desmontou antes de o Phaser iniciar
    this.cameras.main.setBackgroundColor('#20242b').setRoundPixels(true);
    this.view = new LayoutView(this, this.layout);
    const cam = this.cameras.main;
    cam.setZoom(1.5).centerOn(this.view.width / 2, this.view.height / 2);
    this.grid = this.add.graphics().setDepth(900).setAlpha(0.18);
    this.drawGrid();
    this.spawnMarks = this.add.graphics().setDepth(950);
    this.marker = this.add.graphics().setDepth(960);
    this.ghost = this.add.image(0, 0, 'tiles', 0).setOrigin(0, 1).setAlpha(0.65).setDepth(970).setVisible(false);
    this.drawSpawns();

    const kb = this.input.keyboard!;
    kb.disableGlobalCapture();
    this.keys = kb.addKeys({ R: 'R', DEL: 'DELETE', BACK: 'BACKSPACE', ESC: 'ESC' }) as EditorScene['keys'];
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.down(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.move(p));
    this.input.on('pointerup', () => this.up());
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoomBy(dy > 0 ? 0.9 : 1.1));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.view.destroy());
  }

  zoomBy(f: number) {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * f, 0.5, 4));
  }

  private typing() {
    const el = document.activeElement as HTMLElement | null;
    return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
  }

  update() {
    if (!this.view) return;
    if (!this.typing()) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.rotate();
      if ((Phaser.Input.Keyboard.JustDown(this.keys.DEL) || Phaser.Input.Keyboard.JustDown(this.keys.BACK)) && this.selected) this.removeObject(this.selected);
      if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) this.select(null);
    }
    this.drawGhost(this.input.activePointer);
  }

  rotate() {
    const t = this.bridge.tool();
    if (t.kind === 'place' && ASSET_BY_ID.get(t.asset)?.rotatable) this.rot = ((this.rot + 1) % 4) as 0 | 1 | 2 | 3;
    else if (this.selected) {
      const o = this.layout.objects.find((x) => x.id === this.selected);
      const a = o && ASSET_BY_ID.get(o.asset);
      if (o && a?.rotatable) this.reposition(o, o.x, o.y, ((o.rot + 1) % 4) as 0 | 1 | 2 | 3);
    }
  }

  private tileAt(p: Phaser.Input.Pointer) {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    return { x: Math.floor(w.x / TILE), y: Math.floor(w.y / TILE) };
  }

  private drawGrid() {
    const g = this.grid.clear().lineStyle(1, 0xffffff, 1);
    for (let x = 0; x <= this.layout.cols; x++) g.lineBetween(x * TILE, 0, x * TILE, this.view.height);
    for (let y = 0; y <= this.layout.rows; y++) g.lineBetween(0, y * TILE, this.view.width, y * TILE);
  }

  private drawSpawns() {
    const g = this.spawnMarks.clear();
    for (const s of this.layout.spawns) {
      g.lineStyle(2, 0x2ecc71, 1).strokeCircle(s.x * TILE + TILE / 2, s.y * TILE + TILE / 2, 10);
      g.fillStyle(0x2ecc71, 0.35).fillCircle(s.x * TILE + TILE / 2, s.y * TILE + TILE / 2, 10);
    }
    // estações: contorno amarelo na mesa
    for (const st of this.layout.stations) {
      const o = this.layout.objects.find((x) => x.id === st.objectId);
      const a = o && ASSET_BY_ID.get(o.asset);
      if (!o || !a) continue;
      const f = footprintSize(a, o.rot);
      g.lineStyle(1, 0xf1c40f, 0.9).strokeRect(o.x * TILE + 1, o.y * TILE + 1, f.w * TILE - 2, f.h * TILE - 2);
    }
  }

  private objectAt(tx: number, ty: number): Obj2D | null {
    // do mais "à frente" para o mais ao fundo; tapetes por último
    const list = [...this.layout.objects].sort((a, b) => objectDepth(b) - objectDepth(a));
    return list.find((o) => footprintCells(ASSET_BY_ID.get(o.asset)!, o).some((c) => c.x === tx && c.y === ty)) ?? null;
  }

  private canPlace(o: Pick<Obj2D, 'asset' | 'x' | 'y' | 'rot'>, ignore?: string) {
    const a = ASSET_BY_ID.get(o.asset)!;
    const cells = footprintCells(a, o);
    const hang = WALL_MOUNT.has(a.id); // TV, quadro branco e quadro podem ficar na parede
    if (!cells.every((c) => inBounds(this.layout, c.x, c.y) && (hang ? this.layout.walls[c.y * this.layout.cols + c.x] === 1 || this.layout.floor[c.y * this.layout.cols + c.x] !== 0 : !this.layout.walls[c.y * this.layout.cols + c.x] && this.layout.floor[c.y * this.layout.cols + c.x] !== 0))) return false;
    if (a.flat || !a.blocks) return true;
    const mine = new Set(cells.map((c) => `${c.x},${c.y}`));
    return !this.layout.objects.some((q) => {
      if (q.id === ignore) return false;
      const qa = ASSET_BY_ID.get(q.asset)!;
      return qa.blocks && footprintCells(qa, q).some((c) => mine.has(`${c.x},${c.y}`));
    });
  }

  private drawGhost(p: Phaser.Input.Pointer) {
    const t = this.bridge.tool();
    const { x, y } = this.tileAt(p);
    const g = this.marker.clear();
    this.ghost.setVisible(false);
    if (!inBounds(this.layout, x, y) || !this.input.isOver) return this.drawSelection(g);
    if (t.kind === 'place') {
      const a = ASSET_BY_ID.get(t.asset)!;
      const rot = a.rotatable ? this.rot : 0;
      const { h } = footprintSize(a, rot);
      const ok = this.canPlace({ asset: t.asset, x, y, rot });
      this.ghost.setTexture(furnitureKey(a.id, rot)).setPosition(x * TILE, (y + h) * TILE).setVisible(true).setTint(ok ? 0xffffff : 0xff6666);
    } else if (t.kind !== 'pan') {
      g.lineStyle(2, t.kind === 'erase' ? 0xff5555 : 0x4da3ff, 1).strokeRect(x * TILE, y * TILE, TILE, TILE);
    }
    this.drawSelection(g);
  }

  private drawSelection(g: Phaser.GameObjects.Graphics) {
    const o = this.selected && this.layout.objects.find((x) => x.id === this.selected);
    if (!o) return;
    const f = footprintSize(ASSET_BY_ID.get(o.asset)!, o.rot);
    g.lineStyle(2, 0xffffff, 1).strokeRect(o.x * TILE, o.y * TILE, f.w * TILE, f.h * TILE);
  }

  select(id: string | null) {
    this.selected = id;
    this.bridge.onSelect(id);
  }

  private changed() {
    this.drawSpawns();
    this.bridge.onChange();
  }

  private down(p: Phaser.Input.Pointer) {
    if (p.rightButtonDown() || p.middleButtonDown() || this.bridge.tool().kind === 'pan') {
      this.panning = { x: p.x, y: p.y };
      return;
    }
    const t = this.bridge.tool();
    const { x, y } = this.tileAt(p);
    if (!inBounds(this.layout, x, y)) return;
    if (t.kind === 'select') {
      const o = this.objectAt(x, y);
      this.select(o?.id ?? null);
      if (o) this.dragObj = { id: o.id, dx: x - o.x, dy: y - o.y, moved: false };
      else this.panning = { x: p.x, y: p.y };
    } else if (t.kind === 'place') {
      this.place(t.asset, x, y);
    } else if (t.kind === 'spawn') {
      this.toggleSpawn(x, y);
    } else {
      this.painting = true;
      this.paint(x, y, t);
    }
  }

  private move(p: Phaser.Input.Pointer) {
    if (this.panning && p.isDown) {
      const cam = this.cameras.main;
      cam.scrollX -= (p.x - this.panning.x) / cam.zoom;
      cam.scrollY -= (p.y - this.panning.y) / cam.zoom;
      this.panning = { x: p.x, y: p.y };
      return;
    }
    const { x, y } = this.tileAt(p);
    if (this.dragObj && p.isDown) {
      const o = this.layout.objects.find((q) => q.id === this.dragObj!.id);
      if (!o) return;
      const nx = x - this.dragObj.dx, ny = y - this.dragObj.dy;
      if ((nx !== o.x || ny !== o.y) && this.canPlace({ ...o, x: nx, y: ny }, o.id)) {
        this.reposition(o, nx, ny, o.rot);
        this.dragObj.moved = true;
      }
    } else if (this.painting && p.isDown && inBounds(this.layout, x, y)) this.paint(x, y, this.bridge.tool());
  }

  private up() {
    this.panning = null;
    this.dragObj = null;
    this.painting = false;
  }

  private reposition(o: Obj2D, x: number, y: number, rot: 0 | 1 | 2 | 3) {
    if (!this.canPlace({ ...o, x, y, rot }, o.id)) return;
    o.x = x;
    o.y = y;
    o.rot = rot;
    this.view.objects.get(o.id)?.destroy();
    this.view.objects.delete(o.id);
    this.view.addObject(o);
    this.view.refreshGrid();
    this.changed();
  }

  private place(asset: string, x: number, y: number) {
    const a = ASSET_BY_ID.get(asset)!;
    const o: Obj2D = { id: `o${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, asset, x, y, rot: a.rotatable ? this.rot : 0 };
    if (!this.canPlace(o)) return;
    this.layout.objects.push(o);
    if (a.seat && seatOfObject(o)) {
      // toda mesa com lugar para sentar vira uma estação (o administrador vincula a pessoa no painel)
      let n = this.layout.stations.length + 1;
      while (this.layout.stations.some((s) => s.id === `st${n}`)) n++;
      this.layout.stations.push({ id: `st${n}`, objectId: o.id });
    }
    this.view.addObject(o);
    this.view.refreshGrid();
    this.changed();
  }

  removeObject(id: string) {
    const l = this.layout;
    l.objects = l.objects.filter((o) => o.id !== id);
    l.stations = l.stations.filter((s) => s.objectId !== id);
    this.view.objects.get(id)?.destroy();
    this.view.objects.delete(id);
    if (this.selected === id) this.select(null);
    this.view.refreshGrid();
    this.changed();
  }

  private toggleSpawn(x: number, y: number) {
    const l = this.layout;
    const at = l.spawns.findIndex((s) => s.x === x && s.y === y);
    if (at >= 0) {
      if (l.spawns.length > 1) l.spawns.splice(at, 1); // sempre sobra ao menos uma entrada
    } else if (!l.walls[y * l.cols + x] && l.floor[y * l.cols + x] !== 0) {
      let n = l.spawns.length + 1;
      while (l.spawns.some((s) => s.id === `entrada_${n}`)) n++;
      l.spawns.push({ id: `entrada_${n}`, x, y });
    }
    this.changed();
  }

  private paint(x: number, y: number, t: Tool) {
    const l = this.layout;
    const i = y * l.cols + x;
    if (t.kind === 'floor') {
      if (l.walls[i]) return;
      if (l.floor[i] !== t.floor) this.view.putFloor(x, y, t.floor);
      else return;
    } else if (t.kind === 'wall') {
      if (l.walls[i]) return;
      // parede em cima de móvel ou entrada não faz sentido
      if (this.objectAt(x, y) || l.spawns.some((s) => s.x === x && s.y === y)) return;
      this.view.putWall(x, y, true);
      this.view.putFloor(x, y, l.floor[i] || FLOORS[0].id);
    } else if (t.kind === 'erase') {
      const o = this.objectAt(x, y);
      if (o) return void this.removeObject(o.id);
      if (l.walls[i]) this.view.putWall(x, y, false);
      else return;
    } else return;
    this.view.refreshGrid();
    this.changed();
  }

  /** O React trocou o layout inteiro (descartar alterações / recarregar): reconstrói a vista. */
  reload(layout: Layout2D) {
    this.bridge.layout = layout;
    this.selected = null;
    this.view.setLayout(layout);
    this.drawGrid();
    this.drawSpawns();
  }
}
