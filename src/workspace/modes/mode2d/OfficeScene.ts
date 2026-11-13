/**
 * Cena do escritório 2D (jogar): o Phaser controla o loop visual; o React só desenha painéis fora do canvas.
 *  - andar com WASD/setas ou clicando no chão (caminho A* pela grade), colisão com paredes e móveis;
 *  - sentar/levantar na estação (E, Espaço ou clicando na mesa);
 *  - clicar numa pessoa abre o cartão dela; clicar em outro lugar fecha;
 *  - posições de todos vêm do servidor (interpoladas); a própria posição é proposta ao servidor, que valida.
 */
import Phaser from 'phaser';
import { FOOT, TILE, findPath, looseSeats, seatPointOf, walkable, type Dir, type Layout2D } from '../../../../shared/office2d';
import { isSprite2D } from '../../../../shared/avatar2d';
import { useLive } from '../../../live';
import { LayoutView } from './layoutView';
import type { Net2D } from './net2d';
import { PersonView } from './PersonView';

export const SPEED = 110;

export interface SceneBridge {
  net: Net2D;
  employeeId: string | null;
  onSelect: (s: { employeeId: string; sx: number; sy: number } | null) => void;
  onHint: (text: string | null) => void;
  isTyping: () => boolean;
}

type KeyMap = Record<'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'E' | 'SPACE', Phaser.Input.Keyboard.Key>;

export class OfficeScene extends Phaser.Scene {
  private view!: LayoutView;
  private readonly people = new Map<string, PersonView>();
  private keys!: KeyMap;
  private me = { x: 0, y: 0, dir: 'down' as Dir, moving: false, seat: null as string | null };
  private path: Array<{ x: number; y: number }> = [];
  private pendingSit: string | null = null;
  private sentSig = '';
  private hint: string | null = null;
  private drag: { x: number; y: number } | null = null;

  constructor(private bridge: SceneBridge) {
    super('office');
  }

  private get net() {
    return this.bridge.net;
  }
  private get layout(): Layout2D {
    return this.view.layout;
  }

  /** O jogo já foi destruído (o React desmontou antes do Phaser terminar de iniciar): a cena não deve fazer nada nem se inscrever. */
  private get gone() {
    const g = this.sys?.game;
    return !g || (g as unknown as { pendingDestroy?: boolean }).pendingDestroy === true || !g.renderer;
  }

  create() {
    if (this.gone) return;
    const data = this.net.data!;
    this.cameras.main.setBackgroundColor('#20242b');
    this.view = new LayoutView(this, data.layout, true, true);
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.view.width, this.view.height).setZoom(2).setRoundPixels(true);

    const kb = this.input.keyboard!;
    kb.disableGlobalCapture(); // as teclas continuam funcionando nos campos de texto e nos diálogos
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,E,SPACE') as KeyMap;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerup', () => (this.drag = null));
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoomBy(dy > 0 ? 0.9 : 1.1));

    const me = this.net.me;
    if (me) {
      this.me = { x: me.x, y: me.y, dir: me.dir, moving: false, seat: me.seat };
      cam.centerOn(me.x, me.y);
    } else cam.centerOn(this.view.width / 2, this.view.height / 2);

    const offs = [
      this.net.on('layout', () => this.reloadLayout()),
      this.net.on('corrected', (r) => this.snapTo(r as { x: number; y: number; dir: Dir; seat: string | null })),
    ];
    // diagnóstico: aparência em uso por pessoa (window.__office2d.looks())
    (window as unknown as { __office2d?: unknown }).__office2d = {
      looks: () => Object.fromEntries([...this.people].map(([id, pv]) => [id, pv.look])),
      looseSeats: () => looseSeats(this.layout).map((s) => ({ id: s.id, dir: s.dir })),
      goSit: (seatId: string) => {
        const sp = this.seatPoint(seatId);
        if (sp && this.routeTo(sp.cx, sp.cy)) this.pendingSit = seatId;
      },
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      delete (window as unknown as { __office2d?: unknown }).__office2d;
      offs.forEach((off) => off());
      for (const pv of this.people.values()) pv.destroy();
      this.people.clear();
      this.view.destroy();
    });
  }

  // ---------- controles públicos (usados pelos painéis do React) ----------
  zoomBy(f: number) {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * f, 1, 4));
  }
  focusOn(employeeId: string) {
    const pv = this.people.get(employeeId);
    if (pv) this.cameras.main.pan(pv.x, pv.y, 350, 'Sine.easeInOut', true);
  }
  get zoom() {
    return this.cameras.main.zoom;
  }

  private reloadLayout() {
    if (this.gone) return;
    const data = this.net.data!;
    this.view.setLayout(data.layout);
    this.cameras.main.setBounds(0, 0, this.view.width, this.view.height);
    this.path = [];
  }

  private snapTo(r: { x: number; y: number; dir: Dir; seat: string | null }) {
    this.me = { x: r.x, y: r.y, dir: r.dir, moving: false, seat: r.seat };
    this.path = [];
    this.pendingSit = null;
  }

  // ---------- entrada do mouse / toque ----------
  private onPointerMove(p: Phaser.Input.Pointer) {
    if (!p.isDown || !this.net.spectator) return;
    const cam = this.cameras.main;
    if (this.drag) cam.setScroll(cam.scrollX - (p.x - this.drag.x) / cam.zoom, cam.scrollY - (p.y - this.drag.y) / cam.zoom);
    this.drag = { x: p.x, y: p.y };
  }

  private onPointerDown(p: Phaser.Input.Pointer) {
    if (p.rightButtonDown() || this.bridge.isTyping()) return;
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    // 1) pessoa sob o cursor → cartão
    const hit = [...this.people.values()].filter((pv) => pv.hit(w.x, w.y)).sort((a, b) => b.y - a.y)[0];
    if (hit) {
      this.bridge.onSelect({ employeeId: hit.id, sx: p.x, sy: p.y });
      return;
    }
    this.bridge.onSelect(null);
    this.drag = { x: p.x, y: p.y };
    if (!this.net.me) return;
    // 2) mesa com estação → andar até o lugar e sentar
    for (const st of this.layout.stations) {
      const obj = this.layout.objects.find((o) => o.id === st.objectId);
      const img = obj && this.view.objects.get(obj.id);
      if (!obj || !img || !img.getBounds().contains(w.x, w.y)) continue;
      const seat = seatPointOf(this.layout, st.id);
      if (seat && this.routeTo(seat.cx, seat.cy)) this.pendingSit = st.id;
      return;
    }
    // 2b) cadeira solta (reunião, copa) → andar até ela e sentar virado para o lado dela
    for (const s of looseSeats(this.layout)) {
      const img = this.view.objects.get(s.id.slice('chair:'.length));
      if (!img || !img.getBounds().contains(w.x, w.y)) continue;
      if (this.routeTo(s.cx, s.cy)) this.pendingSit = s.id;
      return;
    }
    // 3) chão → andar até a célula
    this.routeTo(Math.floor(w.x / TILE), Math.floor(w.y / TILE));
    this.pendingSit = null;
    const m = this.add.ellipse(Math.floor(w.x / TILE) * TILE + 16, Math.floor(w.y / TILE) * TILE + 16, 14, 8, 0xffffff, 0.7).setDepth(99999);
    this.tweens.add({ targets: m, alpha: 0, scaleX: 1.8, scaleY: 1.8, duration: 450, onComplete: () => m.destroy() });
  }

  private routeTo(cx: number, cy: number): boolean {
    const from = { x: Math.floor(this.me.x / TILE), y: Math.floor(this.me.y / TILE) };
    const path = findPath(this.view.grid, from, { x: cx, y: cy });
    if (!path.length) return false;
    if (this.me.seat) this.stand();
    this.path = path;
    return true;
  }

  // ---------- sentar e levantar ----------
  private seatPoint(seatId: string) {
    return seatPointOf(this.layout, seatId);
  }
  private owner(stationId: string) {
    return this.net.data?.seats.find((s) => s.stationId === stationId);
  }
  private nearestStation(maxDist: number) {
    let best: { id: string; d: number } | null = null;
    for (const st of [...this.layout.stations, ...looseSeats(this.layout)]) {
      const sp = this.seatPoint(st.id);
      if (!sp) continue;
      const d = Math.hypot(sp.x - this.me.x, sp.y - this.me.y);
      if (d <= maxDist && (!best || d < best.d)) best = { id: st.id, d };
    }
    return best?.id ?? null;
  }
  private sit(stationId: string) {
    const sp = this.seatPoint(stationId);
    const owner = this.owner(stationId);
    if (!sp) return;
    if (owner && owner.employeeId !== this.bridge.employeeId) return void this.bridge.onHint(`Esta estação é de ${owner.name}.`);
    const taken = [...this.net.positions.values()].some((q) => q.id !== this.bridge.employeeId && q.seat === stationId);
    if (taken) return void this.bridge.onHint('Esta estação está ocupada.');
    this.me = { x: sp.x, y: sp.y, dir: sp.dir, moving: false, seat: stationId };
    this.path = [];
    this.pendingSit = null;
  }
  private stand() {
    this.me.seat = null;
  }

  // ---------- loop ----------
  update(time: number, deltaMs: number) {
    if (!this.view) return;
    const dt = Math.min(0.1, deltaMs / 1000);
    const t = time / 1000;
    if (this.net.me && !this.autoFollow()) this.updateLocal(dt);
    this.syncPeople(t, dt);
    this.updateHint();
    const cam = this.cameras.main;
    const mine = this.people.get(this.bridge.employeeId ?? '');
    if (mine && !cam.panEffect.isRunning) cam.centerOn(mine.x, mine.y - 8);
  }

  /**
   * Ao entrar, o servidor leva a pessoa até a mesa dela e a faz sentar: o cliente só acompanha. Mexer (teclado ou clique no chão)
   * ou pedir para sentar assume o controle.
   */
  private following = false;
  private autoFollow(): boolean {
    const pos = this.net.positions.get(this.bridge.employeeId ?? '');
    if (!pos) return false;
    const k = this.keys;
    const manual = !this.bridge.isTyping() && (k.A.isDown || k.D.isDown || k.W.isDown || k.S.isDown || k.LEFT.isDown || k.RIGHT.isDown || k.UP.isDown || k.DOWN.isDown);
    if (pos.auto && !manual && !this.path.length) {
      this.following = true;
      Object.assign(this.me, { x: pos.x, y: pos.y, dir: pos.dir, moving: pos.moving, seat: pos.seat });
      return true;
    }
    if (this.following && !pos.auto) {
      // chegou à mesa: aceita a posição final e não reenvia
      this.following = false;
      Object.assign(this.me, { x: pos.x, y: pos.y, dir: pos.dir, moving: false, seat: pos.seat });
      this.sentSig = `${Math.round(pos.x)}|${Math.round(pos.y)}|${pos.dir}|false|${pos.seat}`;
    }
    return false;
  }

  private updateLocal(dt: number) {
    const typing = this.bridge.isTyping();
    const k = this.keys;
    let vx = 0;
    let vy = 0;
    if (!typing) {
      vx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
      vy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
      if (Phaser.Input.Keyboard.JustDown(k.E) || Phaser.Input.Keyboard.JustDown(k.SPACE)) {
        if (this.me.seat) this.stand();
        else {
          const near = this.nearestStation(40);
          if (near) this.sit(near);
        }
      }
    }
    if (vx || vy) {
      this.path = [];
      this.pendingSit = null;
      if (this.me.seat) this.stand();
    } else if (this.path.length && !this.me.seat) {
      const c = this.path[0];
      const tx = c.x * TILE + TILE / 2;
      const ty = c.y * TILE + TILE / 2;
      const d = Math.hypot(tx - this.me.x, ty - this.me.y);
      if (d < 3) {
        this.path.shift();
        if (!this.path.length && this.pendingSit) this.sit(this.pendingSit);
      } else [vx, vy] = [(tx - this.me.x) / d, (ty - this.me.y) / d];
    }
    if ((vx || vy) && !this.me.seat) {
      const len = Math.hypot(vx, vy);
      const step = SPEED * dt;
      const nx = this.me.x + (vx / len) * step;
      const ny = this.me.y + (vy / len) * step;
      const g = this.view.grid;
      let moved = false;
      if (walkable(g, nx, this.me.y, FOOT)) {
        this.me.x = nx;
        moved = true;
      }
      if (walkable(g, this.me.x, ny, FOOT)) {
        this.me.y = ny;
        moved = true;
      }
      this.me.moving = moved;
      if (Math.abs(vx) > Math.abs(vy)) this.me.dir = vx > 0 ? 'right' : 'left';
      else if (vy) this.me.dir = vy > 0 ? 'down' : 'up';
      if (!moved) this.path = [];
    } else this.me.moving = false;

    const sig = `${Math.round(this.me.x)}|${Math.round(this.me.y)}|${this.me.dir}|${this.me.moving}|${this.me.seat}`;
    if (sig !== this.sentSig) {
      this.sentSig = sig;
      this.net.sendMove({ x: this.me.x, y: this.me.y, dir: this.me.dir, moving: this.me.moving, seat: this.me.seat });
    }
  }

  private syncPeople(t: number, dt: number) {
    const live = useLive.getState().people;
    const myId = this.bridge.employeeId;
    for (const [id, pos] of this.net.positions) {
      const lp = live[id];
      if (lp && lp.status === 'offline') continue;
      let pv = this.people.get(id);
      if (!pv) {
        pv = new PersonView(this, id, lp?.name ?? id, id === myId);
        this.people.set(id, pv);
        pv.setTarget(id === myId ? this.me.x : pos.x, id === myId ? this.me.y : pos.y, true);
      }
      if (id === myId) {
        // o servidor reposicionou a pessoa (layout publicado, estação trocada): aceita se a diferença for grande
        if (Math.hypot(pos.x - this.me.x, pos.y - this.me.y) > 56 && performance.now() - pos.at < 400) this.snapTo(pos);
        pv.setTarget(this.me.x, this.me.y, true);
        pv.dir = this.me.dir;
        pv.moving = this.me.moving;
        pv.seated = !!this.me.seat;
      } else {
        pv.setTarget(pos.x, pos.y);
        pv.dir = pos.dir;
        pv.moving = pos.moving;
        pv.seated = !!pos.seat;
      }
      pv.setName(lp?.name ?? id);
      pv.status = lp?.status ?? 'online';
      pv.speaking = lp?.call?.speaking ?? null;
      const cfg = lp?.appearance?.config;
      pv.setAppearance(cfg, pv.status === 'in_call' || (isSprite2D(cfg) && cfg.headsetAlways));
    }
    for (const [id, pv] of this.people)
      if (!this.net.positions.has(id) || live[id]?.status === 'offline') {
        pv.destroy();
        this.people.delete(id);
      }
    for (const pv of this.people.values()) pv.update(dt, t, pv.isMe);
  }

  private updateHint() {
    let text: string | null = null;
    if (this.net.me && !this.bridge.isTyping()) {
      if (this.me.seat) text = 'Pressione E para levantar';
      else {
        const near = this.nearestStation(40);
        const owner = near ? this.owner(near) : null;
        if (near && (!owner || owner.employeeId === this.bridge.employeeId)) text = 'Pressione E para sentar';
      }
    }
    if (text !== this.hint) {
      this.hint = text;
      this.bridge.onHint(text);
    }
  }
}
