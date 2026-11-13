/**
 * Escritório 2D no servidor: layout (rascunho e publicado), estações, posição de cada pessoa e validação da movimentação.
 *  - o servidor é a autoridade: o cliente só PROPÕE uma posição; ela é aceita se for andável, se a velocidade for plausível,
 *    se o caminho não atravessar parede ou móvel, e (para sentar) se estiver no lugar de uma estação livre ou da própria pessoa;
 *  - ninguém move outra pessoa: a posição vale sempre para o colaborador da sessão;
 *  - as posições mudam em memória (efêmeras, como a presença) e saem em lotes de 10 por segundo para a empresa;
 *  - o layout publicado e os vínculos mesa-pessoa ficam no banco; nada disso é tocado pelo editor 3D.
 */
import type { SessionUser } from '../shared/types';
import { DIRS, TILE, findPath, gridOf, nearestFree, seatPointOf, walkable, type Dir, type Grid, type Layout2D } from '../shared/office2d';
import { defaultLayout2D } from '../shared/office2dDefault';
import { one, type Db } from './db/driver';
import { HttpError } from './http';
import type { LiveHub } from './live';

export interface Pos2D { id: string; officeId: string; x: number; y: number; dir: Dir; moving: boolean; seat: string | null; /** o servidor está levando a pessoa até a mesa dela */ auto?: boolean }
export interface MoveInput { x: number; y: number; dir: Dir; moving: boolean; seat: string | null }
interface LayoutEntry { layout: Layout2D; grid: Grid; version: number; published: boolean }
interface SeatsEntry { byStation: Map<string, string>; byEmployee: Map<string, string> }

/** Velocidade máxima aceita (px/s). O cliente anda a 110; a folga cobre atraso de rede e quadros perdidos. */
export const MAX_SPEED = 150;
const SLACK = 24;
const MIN_INTERVAL_MS = 40;
const FLUSH_MS = 100;
/** Velocidade de quem é levado até a mesa ao entrar (passo de caminhada, abaixo do limite de 150 px/s). */
const ARRIVE_SPEED = 80;
interface Route { path: Array<{ x: number; y: number }>; station: string; seatX: number; seatY: number; seatDir: Dir }

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

export class Office2D {
  private layouts = new Map<string, LayoutEntry>();
  private seats = new Map<string, SeatsEntry>();
  /** Geração de cada cache: uma leitura que começou antes de uma publicação não pode gravar o resultado velho depois dela. */
  private gen = new Map<string, number>();
  private bump = (key: string) => this.gen.set(key, (this.gen.get(key) ?? 0) + 1);
  private pos = new Map<string, Map<string, Pos2D>>(); // empresa → colaborador → posição
  private lastMove = new Map<string, number>();
  private dirty = new Map<string, Map<string, Pos2D>>();
  private gone = new Map<string, Set<string>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private routes = new Map<string, Route>(); // `${empresa}:${colaborador}` → trajeto até a mesa
  private lastAdvance = Date.now();

  constructor(
    private db: Db,
    private hub: LiveHub,
  ) {}

  start() {
    this.timer = setInterval(() => {
      const now = Date.now();
      this.advance(now - this.lastAdvance);
      this.lastAdvance = now;
      this.flush();
    }, FLUSH_MS);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- layout ----------
  /** Layout publicado do andar (ou o padrão, enquanto o administrador não publicou um). */
  async layoutOf(companyId: string, officeId: string): Promise<LayoutEntry> {
    const key = `${companyId}:${officeId}`;
    const hit = this.layouts.get(key);
    if (hit) return hit;
    const g = this.gen.get(`l:${key}`) ?? 0;
    const row = await one<{ layout_json: string; version: number }>(this.db, "SELECT layout_json, version FROM office2d_layouts WHERE company_id = ? AND office_id = ? AND status = 'published'", [companyId, officeId]);
    const layout = row ? (JSON.parse(row.layout_json) as Layout2D) : defaultLayout2D();
    const entry: LayoutEntry = { layout, grid: gridOf(layout), version: row ? Number(row.version) : 0, published: !!row };
    if ((this.gen.get(`l:${key}`) ?? 0) === g) this.layouts.set(key, entry);
    return entry;
  }

  async seatsOf(companyId: string, officeId: string): Promise<SeatsEntry> {
    const key = `${companyId}:${officeId}`;
    const hit = this.seats.get(key);
    if (hit) return hit;
    const g = this.gen.get(`s:${key}`) ?? 0;
    const rows = await this.db.query<{ station_id: string; employee_id: string }>('SELECT station_id, employee_id FROM seat2d_assignments WHERE company_id = ? AND office_id = ?', [companyId, officeId]);
    const e: SeatsEntry = { byStation: new Map(rows.map((r) => [r.station_id, r.employee_id])), byEmployee: new Map(rows.map((r) => [r.employee_id, r.station_id])) };
    if ((this.gen.get(`s:${key}`) ?? 0) === g) this.seats.set(key, e);
    return e;
  }

  // ---------- entrada e movimento ----------
  private seatPoint(layout: Layout2D, seatId: string) {
    return seatPointOf(layout, seatId);
  }

  /** Põe a pessoa no escritório (se ainda não estiver): numa entrada livre; quem tem mesa designada é levado até ela e senta. */
  private async spawn(companyId: string, employeeId: string, officeId: string): Promise<Pos2D> {
    const [{ layout, grid }, seats] = await Promise.all([this.layoutOf(companyId, officeId), this.seatsOf(companyId, officeId)]);
    const company = this.pos.get(companyId) ?? new Map<string, Pos2D>();
    this.pos.set(companyId, company);
    let p = company.get(employeeId);
    if (!p || p.officeId !== officeId) {
      const stationId = seats.byEmployee.get(employeeId);
      const sp = stationId ? this.seatPoint(layout, stationId) : null;
      const occupied = !!stationId && [...company.values()].some((q) => q.id !== employeeId && q.officeId === officeId && q.seat === stationId);
      // numa entrada livre, longe de quem já está por perto (para os nomes não se empilharem)
      const entrance = (): Pos2D => {
        const s = layout.spawns[hash(employeeId) % layout.spawns.length];
        const standing = [...company.values()].filter((q) => q.officeId === officeId && !q.seat);
        let best: { x: number; y: number } | null = null;
        for (let r = 0; r <= 6 && !best; r++) {
          const ring: Array<{ x: number; y: number }> = [];
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push({ x: s.x + dx, y: s.y + dy });
          ring.sort((a, b) => hash(`${employeeId}${a.x},${a.y}`) - hash(`${employeeId}${b.x},${b.y}`));
          best = ring.find((c) => !grid.blocked[c.y * grid.cols + c.x] && c.x >= 0 && c.y >= 0 && c.x < grid.cols && c.y < grid.rows && standing.every((q) => Math.hypot(q.x - (c.x * TILE + TILE / 2), q.y - (c.y * TILE + TILE / 2)) >= 30)) ?? null;
        }
        const c = best ?? nearestFree(grid, s.x, s.y) ?? s;
        return { id: employeeId, officeId, x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2, dir: 'down', moving: false, seat: null };
      };
      p = entrance();
      // quem tem mesa designada (e livre) entra por uma entrada e é levado até ela, onde senta na cadeira que já está no cenário
      if (stationId && sp && !occupied) {
        const cells = findPath(grid, { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) }, { x: Math.floor(sp.x / TILE), y: Math.floor(sp.y / TILE) });
        if (cells.length) {
          this.routes.set(`${companyId}:${employeeId}`, { path: cells.map((q) => ({ x: q.x * TILE + TILE / 2, y: q.y * TILE + TILE / 2 })), station: stationId, seatX: sp.x, seatY: sp.y, seatDir: sp.dir });
          p.auto = true;
        } else p = { id: employeeId, officeId, x: sp.x, y: sp.y, dir: sp.dir, moving: false, seat: stationId }; // sem caminho: já sentado
      }
      company.set(employeeId, p);
      this.mark(companyId, p);
    }
    return p;
  }

  /** Entrar no escritório pela tela do 2D: devolve a própria posição e a de todos os que já estão lá. */
  async join(user: SessionUser, officeId: string): Promise<{ me: Pos2D; positions: Pos2D[] }> {
    if (!user.employeeId) throw new HttpError(409, 'no_employee', 'Sua conta não está ligada a um colaborador do diretório: você só pode observar o escritório.');
    const me = await this.spawn(user.companyId, user.employeeId, officeId);
    this.mark(user.companyId, me);
    return { me, positions: this.list(user.companyId, officeId) };
  }

  /** O cliente propõe uma posição; devolve a posição aceita (`corrected` quando o servidor recusou e manteve a anterior). */
  async move(user: SessionUser, officeId: string, input: MoveInput): Promise<Pos2D & { corrected: boolean }> {
    if (!user.employeeId) throw new HttpError(409, 'no_employee', 'Sua conta não está ligada a um colaborador do diretório.');
    const p = this.pos.get(user.companyId)?.get(user.employeeId);
    if (!p || p.officeId !== officeId) throw new HttpError(409, 'not_joined', 'Entre no escritório antes de se mover.');
    const k = `${user.companyId}:${user.employeeId}`;
    if (p.auto) {
      // levado até a mesa: só assume o controle quem se mexe ou pede para sentar; sinal parado do cliente é corrigido para a posição do servidor
      if (input.moving || input.seat) {
        this.routes.delete(k);
        p.auto = false;
      } else return { ...p, corrected: true };
    }
    const now = Date.now();
    const last = this.lastMove.get(k) ?? 0;
    if (now - last < MIN_INTERVAL_MS) return { ...p, corrected: false };
    const dt = Math.min(1.5, (now - last) / 1000);
    this.lastMove.set(k, now);
    const [{ layout, grid }, seats] = await Promise.all([this.layoutOf(user.companyId, officeId), this.seatsOf(user.companyId, officeId)]);
    let { x, y } = input;
    let dir = input.dir;
    let ok = true;
    if (input.seat) {
      const sp = this.seatPoint(layout, input.seat);
      const owner = seats.byStation.get(input.seat);
      const taken = [...(this.pos.get(user.companyId)?.values() ?? [])].some((q) => q.id !== p.id && q.officeId === officeId && q.seat === input.seat);
      // sentar vale a mesma regra de andar: a pessoa precisa estar perto do lugar, com o caminho livre (não dá para "sentar" através de uma parede)
      const near = !!sp && (p.seat === input.seat || (Math.hypot(sp.x - p.x, sp.y - p.y) <= MAX_SPEED * dt + SLACK && this.pathClear(grid, p.x, p.y, sp.x, sp.y)));
      ok = !!sp && near && Math.hypot(x - sp.x, y - sp.y) <= 8 && (!owner || owner === user.employeeId) && !taken;
      if (ok && sp) [x, y, dir] = [sp.x, sp.y, sp.dir];
    } else {
      const d = Math.hypot(x - p.x, y - p.y);
      ok = d <= MAX_SPEED * dt + SLACK && walkable(grid, x, y) && this.pathClear(grid, p.x, p.y, x, y);
    }
    if (!ok) return { ...p, corrected: true };
    p.x = x;
    p.y = y;
    p.dir = dir;
    p.moving = input.moving && !input.seat;
    p.seat = input.seat;
    this.mark(user.companyId, p);
    return { ...p, corrected: false };
  }

  /** Confere pontos intermediários (a cada 8 px) para um salto não atravessar parede fina. */
  private pathClear(g: Grid, x0: number, y0: number, x1: number, y1: number) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8);
    for (let i = 1; i < n; i++) if (!walkable(g, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n)) return false;
    return true;
  }

  private dropRoutes(companyId: string, officeId: string) {
    for (const p of this.list(companyId, officeId)) {
      if (this.routes.delete(`${companyId}:${p.id}`)) {
        p.auto = false;
        p.moving = false;
      }
    }
  }

  /** Leva, passo a passo, quem acabou de entrar até a mesa dela; ao chegar, a pessoa senta. */
  advance(dtMs: number) {
    const dt = Math.min(1, Math.max(0, dtMs) / 1000);
    for (const [key, r] of [...this.routes]) {
      const [companyId, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      const p = this.pos.get(companyId)?.get(id);
      if (!p) {
        this.routes.delete(key);
        continue;
      }
      let left = ARRIVE_SPEED * dt;
      while (left > 0 && r.path.length) {
        const t = r.path[0];
        const d = Math.hypot(t.x - p.x, t.y - p.y);
        if (d <= left) {
          [p.x, p.y] = [t.x, t.y];
          left -= d;
          r.path.shift();
        } else {
          p.x += ((t.x - p.x) / d) * left;
          p.y += ((t.y - p.y) / d) * left;
          left = 0;
        }
        if (d > 0.5) p.dir = Math.abs(t.x - p.x) > Math.abs(t.y - p.y) ? (t.x > p.x ? 'right' : 'left') : t.y > p.y ? 'down' : 'up';
      }
      if (r.path.length) p.moving = true;
      else {
        // chegou: senta (a mesa continua livre e é dela)
        const taken = [...(this.pos.get(companyId)?.values() ?? [])].some((q) => q.id !== id && q.officeId === p.officeId && q.seat === r.station);
        [p.x, p.y, p.dir] = [r.seatX, r.seatY, r.seatDir];
        p.moving = false;
        p.seat = taken ? null : r.station;
        p.auto = false;
        this.routes.delete(key);
      }
      this.mark(companyId, p);
    }
  }

  list(companyId: string, officeId: string): Pos2D[] {
    return [...(this.pos.get(companyId)?.values() ?? [])].filter((p) => p.officeId === officeId);
  }

  // ---------- saída e limpeza ----------
  leave(companyId: string, employeeId: string) {
    const company = this.pos.get(companyId);
    if (!company?.delete(employeeId)) return;
    this.lastMove.delete(`${companyId}:${employeeId}`);
    this.routes.delete(`${companyId}:${employeeId}`);
    this.dirty.get(companyId)?.delete(employeeId);
    if (!this.gone.has(companyId)) this.gone.set(companyId, new Set());
    this.gone.get(companyId)!.add(employeeId);
  }

  /**
   * Chamado pelo relógio da presença: quem ficou offline sai do escritório e quem está online (no modo 2D) entra, mesmo que
   * a pessoa esteja em outra tela do aplicativo. A presença real é que decide quem aparece.
   */
  private sweeping = false;
  private firstOffice = new Map<string, string | null>();
  private async defaultOffice(companyId: string) {
    if (!this.firstOffice.has(companyId)) this.firstOffice.set(companyId, (await one<{ id: string }>(this.db, 'SELECT id FROM offices WHERE company_id = ? ORDER BY id LIMIT 1', [companyId]))?.id ?? null);
    return this.firstOffice.get(companyId) ?? null;
  }
  async sweep() {
    for (const [companyId, company] of this.pos) for (const id of [...company.keys()]) if (!this.hub.isOnline(companyId, id)) this.leave(companyId, id);
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (const { companyId, employeeId } of this.hub.onlineEmployees()) {
        if (this.hub.modeCached(companyId) !== '2d' || this.pos.get(companyId)?.has(employeeId)) continue;
        const officeId = await this.defaultOffice(companyId);
        if (officeId) await this.spawn(companyId, employeeId, officeId);
      }
    } finally {
      this.sweeping = false;
    }
  }

  /** Troca de modo (2D ↔ 3D): ninguém fica "no escritório 2D" quando o 3D assume. Quem voltar ao 2D entra de novo. */
  reset(companyId: string) {
    const company = this.pos.get(companyId);
    if (company) for (const id of company.keys()) this.leave(companyId, id);
    this.flush();
  }

  // ---------- mudanças do layout e das estações ----------
  /** O layout foi publicado: recarrega, reposiciona quem ficou em lugar inválido e avisa a empresa. */
  async layoutChanged(companyId: string, officeId: string) {
    this.layouts.delete(`${companyId}:${officeId}`);
    this.bump(`l:${companyId}:${officeId}`);
    const { layout, grid, version } = await this.layoutOf(companyId, officeId);
    this.dropRoutes(companyId, officeId); // o mapa mudou: quem estava a caminho da mesa para onde está
    for (const p of this.list(companyId, officeId)) {
      const stationOk = !p.seat || !!this.seatPoint(layout, p.seat);
      if (p.seat && stationOk) {
        const sp = this.seatPoint(layout, p.seat)!;
        [p.x, p.y, p.dir] = [sp.x, sp.y, sp.dir];
      } else if (!walkable(grid, p.x, p.y) || p.seat) {
        p.seat = null;
        const c = nearestFree(grid, Math.floor(p.x / TILE), Math.floor(p.y / TILE)) ?? layout.spawns[0];
        [p.x, p.y] = [c.x * TILE + TILE / 2, c.y * TILE + TILE / 2];
      }
      p.moving = false;
      this.mark(companyId, p);
    }
    this.hub.broadcast(companyId, 'layout2d', { officeId, version }, false);
  }

  /** Vínculos mesa-pessoa mudaram: quem estava sentado numa mesa que passou a ser de outra pessoa levanta. */
  async seatsChanged(companyId: string, officeId: string) {
    this.seats.delete(`${companyId}:${officeId}`);
    this.bump(`s:${companyId}:${officeId}`);
    const seats = await this.seatsOf(companyId, officeId);
    const { grid } = await this.layoutOf(companyId, officeId);
    this.dropRoutes(companyId, officeId);
    for (const p of this.list(companyId, officeId)) {
      if (!p.seat) continue;
      const owner = seats.byStation.get(p.seat);
      if (owner && owner !== p.id) {
        p.seat = null;
        const c = nearestFree(grid, Math.floor(p.x / TILE), Math.floor(p.y / TILE) + 1);
        if (c) [p.x, p.y] = [c.x * TILE + TILE / 2, c.y * TILE + TILE / 2];
        this.mark(companyId, p);
      }
    }
    this.hub.broadcast(companyId, 'seats2d', { officeId }, false);
  }

  // ---------- envio em lotes ----------
  private mark(companyId: string, p: Pos2D) {
    if (!this.dirty.has(companyId)) this.dirty.set(companyId, new Map());
    this.dirty.get(companyId)!.set(p.id, { ...p });
    this.gone.get(companyId)?.delete(p.id);
  }

  flush() {
    const companies = new Set([...this.dirty.keys(), ...this.gone.keys()]);
    for (const companyId of companies) {
      const p = [...(this.dirty.get(companyId)?.values() ?? [])];
      const gone = [...(this.gone.get(companyId) ?? [])];
      if (!p.length && !gone.length) continue;
      this.hub.broadcast(companyId, 'p2d', { t: Date.now(), p, gone });
    }
    this.dirty.clear();
    this.gone.clear();
  }
}

export const isDir = (d: unknown): d is Dir => DIRS.includes(d as Dir);
