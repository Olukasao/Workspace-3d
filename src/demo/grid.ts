/** Navegação em grade genérica (A* com suavização por linha de visão) usada pela vida autônoma. */
import type { Pt } from '../../shared/life';

export class NavGrid {
  readonly blocked: Uint8Array;
  constructor(
    readonly cols: number,
    readonly rows: number,
    readonly cell: number,
    readonly ox: number,
    readonly oy: number,
  ) {
    this.blocked = new Uint8Array(cols * rows);
  }
  cellOf(p: Pt) {
    return { x: Math.floor((p.x - this.ox) / this.cell), y: Math.floor((p.y - this.oy) / this.cell) };
  }
  center(cx: number, cy: number): Pt {
    return { x: this.ox + (cx + 0.5) * this.cell, y: this.oy + (cy + 0.5) * this.cell };
  }
  inside(cx: number, cy: number) {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
  }
  free(cx: number, cy: number) {
    return this.inside(cx, cy) && !this.blocked[cy * this.cols + cx];
  }
  /** bloqueia (1) ou libera (0) o retângulo [x0,x1]×[y0,y1], em unidades do mundo */
  rect(x0: number, y0: number, x1: number, y1: number, v: 0 | 1) {
    const a = this.cellOf({ x: x0, y: y0 });
    const b = this.cellOf({ x: x1, y: y1 });
    for (let cy = Math.max(0, a.y); cy <= Math.min(this.rows - 1, b.y); cy++) for (let cx = Math.max(0, a.x); cx <= Math.min(this.cols - 1, b.x); cx++) this.blocked[cy * this.cols + cx] = v;
  }
  inflate(r: number) {
    const src = this.blocked.slice();
    for (let cy = 0; cy < this.rows; cy++)
      for (let cx = 0; cx < this.cols; cx++) {
        if (!src[cy * this.cols + cx]) continue;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (this.inside(cx + dx, cy + dy)) this.blocked[(cy + dy) * this.cols + cx + dx] = 1;
      }
  }
  nearestFree(cx: number, cy: number) {
    for (let r = 0; r < Math.max(this.cols, this.rows); r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && this.free(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
    return null;
  }
  snap(p: Pt): Pt | null {
    const c = this.cellOf(p);
    const f = this.free(c.x, c.y) ? c : this.nearestFree(c.x, c.y);
    return f ? this.center(f.x, f.y) : null;
  }
  private los(a: { x: number; y: number }, b: { x: number; y: number }) {
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2 || 1;
    for (let i = 0; i <= n; i++) {
      const x = Math.round(a.x + ((b.x - a.x) * i) / n);
      const y = Math.round(a.y + ((b.y - a.y) * i) / n);
      if (!this.free(x, y)) return false;
    }
    return true;
  }
  /** caminho de `a` até `b` em unidades do mundo (a ponta final é exatamente `b`) */
  path(a: Pt, b: Pt): Pt[] | null {
    const ca = this.cellOf(a);
    const cb = this.cellOf(b);
    const s = this.free(ca.x, ca.y) ? ca : this.nearestFree(ca.x, ca.y);
    const t = this.free(cb.x, cb.y) ? cb : this.nearestFree(cb.x, cb.y);
    if (!s || !t) return null;
    const key = (x: number, y: number) => y * this.cols + x;
    const open: Array<{ x: number; y: number; f: number }> = [{ x: s.x, y: s.y, f: 0 }];
    const g = new Map<number, number>([[key(s.x, s.y), 0]]);
    const prev = new Map<number, number>();
    const h = (x: number, y: number) => Math.max(Math.abs(x - t.x), Math.abs(y - t.y)) + 0.41 * Math.min(Math.abs(x - t.x), Math.abs(y - t.y));
    let n = 0;
    let found = s.x === t.x && s.y === t.y;
    while (open.length && !found && n++ < 20000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur.x === t.x && cur.y === t.y) {
        found = true;
        break;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!this.free(nx, ny) || (dx && dy && (!this.free(cur.x + dx, cur.y) || !this.free(cur.x, cur.y + dy)))) continue;
        const ng = (g.get(key(cur.x, cur.y)) ?? 0) + (dx && dy ? 1.41 : 1);
        if (ng < (g.get(key(nx, ny)) ?? Infinity)) {
          g.set(key(nx, ny), ng);
          prev.set(key(nx, ny), key(cur.x, cur.y));
          open.push({ x: nx, y: ny, f: ng + h(nx, ny) });
        }
      }
    }
    if (!found) return null;
    const cells: Array<{ x: number; y: number }> = [{ x: t.x, y: t.y }];
    let k = key(t.x, t.y);
    while (k !== key(s.x, s.y)) {
      k = prev.get(k)!;
      cells.push({ x: k % this.cols, y: Math.floor(k / this.cols) });
    }
    cells.reverse();
    // suaviza: pula para o ponto mais distante com linha de visão livre
    const out: Array<{ x: number; y: number }> = [];
    let i = 0;
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      while (j > i + 1 && !this.los(cells[i], cells[j])) j--;
      out.push(cells[j]);
      i = j;
    }
    const pts = out.map((c) => this.center(c.x, c.y));
    if (pts.length) pts[pts.length - 1] = { ...b };
    else pts.push({ ...b });
    return pts;
  }
}
