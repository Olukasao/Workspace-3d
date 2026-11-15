/**
 * Vida autônoma do escritório (estilo "The Sims"): quando uma pessoa não está ligada a um sistema real, ela continua vivendo.
 * Cada colaborador trabalha na própria mesa, digita, atende ligações e, movido por necessidades (sede, vontade de conversar,
 * descanso, tarefas), levanta, anda até a copa, a impressora, o sofá, a TV, a sala de reunião ou a mesa de um colega, faz o que
 * foi fazer e volta ao lugar. O motor é independente de gráfico: o 2D (pixels) e o 3D (metros) só fornecem o mapa de navegação
 * (`nav`), os pontos de interesse (`pois`) e as mesas; o resultado sai em `views`.
 */
export interface Pt {
  x: number;
  y: number;
}

export type PoiKind = 'coffee' | 'water' | 'printer' | 'sofa' | 'meeting' | 'screen' | 'shelf' | 'board';

export interface Poi {
  id: string;
  kind: PoiKind;
  /** onde a pessoa fica (em pé) ou senta */
  at: Pt;
  /** direção para onde fica virada (radianos, atan2(dy, dx) no plano do motor) */
  face: number;
  /** é um assento (a pessoa senta) */
  sit?: boolean;
}

export interface LifeAgent {
  id: string;
  name: string;
  dept: string;
  desk: { at: Pt; face: number; seatId: string } | null;
}

export interface LifeNav {
  /** caminho andável de `a` até `b` (sem incluir `a`), ou null se não houver */
  path(a: Pt, b: Pt): Pt[] | null;
  /** ponto andável mais próximo de `p` */
  snap(p: Pt): Pt | null;
  /** o ponto está livre (andável)? usado para o desvio entre pessoas */
  isFree?(p: Pt): boolean;
  /** unidades do mapa por segundo */
  speed: number;
}

export type LifeActivity = 'work' | 'type' | 'call' | 'talk' | 'drink' | 'tool' | 'rest' | 'look';
export type LifeStatus = 'online' | 'typing' | 'in_call' | 'away';

export interface AgentView {
  id: string;
  x: number;
  y: number;
  face: number;
  moving: boolean;
  sit: boolean;
  /** assento ocupado agora (estação da própria mesa ou `poi:<id>`), ou null em pé */
  seatId: string | null;
  activity: LifeActivity;
  status: LifeStatus;
  speaking: boolean | null;
  /** o que a pessoa está fazendo, em português ("foi tomar um café") */
  note: string;
}

type Mode = 'desk' | 'walk' | 'dwell';
type Need = 'thirst' | 'social' | 'rest' | 'task' | 'meet';

interface Plan {
  need: Need;
  poi?: Poi;
  /** visitar a mesa de um colega */
  peer?: string;
  dwell: number;
  activity: LifeActivity;
  note: string;
}

interface Inner {
  a: LifeAgent;
  pos: Pt;
  face: number;
  mode: Mode;
  sit: boolean;
  seatId: string | null;
  path: Pt[];
  plan: Plan | null;
  /** tempo restante na etapa atual */
  t: number;
  activity: LifeActivity;
  note: string;
  needs: Record<Need, number>;
  /** quem está me visitando (eu fico conversando) */
  visitor: string | null;
  walkClock: number;
  speaking: boolean | null;
  speakT: number;
  /** quanto falta para a próxima mudança de atividade na mesa */
  deskT: number;
}

const TAU = Math.PI * 2;
const angDiff = (a: number, b: number) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

export interface LifeOptions {
  agents: LifeAgent[];
  pois: Poi[];
  nav: LifeNav;
  /** pontos de entrada (usados quando alguém não tem mesa) */
  spawns: Pt[];
  /** distância de uma visita à mesa do colega, nas unidades do mapa */
  chatGap: number;
  /** semente do acaso (reproduzível nos testes) */
  seed?: number;
  /** departamentos que fazem ligações */
  callDepts?: string[];
}

export class Life {
  private s = new Map<string, Inner>();
  private occupied = new Map<string, string>(); // poi → agente
  private rnd: () => number;
  private controlled = new Set<string>();
  clock = 0;

  constructor(private o: LifeOptions) {
    let x = (o.seed ?? 1234567) >>> 0;
    this.rnd = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (const a of o.agents) this.add(a);
  }

  add(a: LifeAgent) {
    const start = a.desk?.at ?? this.o.spawns[0] ?? { x: 0, y: 0 };
    this.s.set(a.id, {
      a,
      pos: { ...start },
      face: a.desk?.face ?? 0,
      mode: 'desk',
      sit: !!a.desk,
      seatId: a.desk?.seatId ?? null,
      path: [],
      plan: null,
      t: 0,
      activity: 'work',
      note: 'trabalhando',
      needs: { thirst: this.rnd() * 0.8, social: this.rnd() * 0.8, rest: this.rnd() * 0.5, task: this.rnd() * 0.7, meet: this.rnd() * 0.3 },
      visitor: null,
      walkClock: 0,
      speaking: null,
      speakT: 0,
      deskT: 2 + this.rnd() * 8,
    });
  }

  /** O jogador assume uma pessoa (ela deixa de ser simulada); `false` devolve à simulação. */
  control(id: string, on: boolean) {
    const i = this.s.get(id);
    if (!i) return;
    if (on) {
      this.controlled.add(id);
      this.freePoi(id);
      if (i.visitor) this.s.get(i.visitor)!.plan = null;
      i.visitor = null;
      i.plan = null;
      i.path = [];
      i.mode = 'desk';
    } else {
      this.controlled.delete(id);
      this.goHome(i);
    }
  }
  isControlled = (id: string) => this.controlled.has(id);

  /** A pessoa controlada pelo jogador informa onde está. */
  setControlled(id: string, p: { x: number; y: number; face?: number; seatId?: string | null }) {
    const i = this.s.get(id);
    if (!i) return;
    i.pos = { x: p.x, y: p.y };
    if (p.face !== undefined) i.face = p.face;
    i.seatId = p.seatId ?? null;
    i.sit = !!p.seatId;
  }

  private freePoi(id: string) {
    for (const [k, v] of this.occupied) if (v === id) this.occupied.delete(k);
  }

  views(): AgentView[] {
    return [...this.s.values()].map((i) => this.view(i));
  }
  view(i: Inner | string): AgentView {
    const n = typeof i === 'string' ? this.s.get(i)! : i;
    const status: LifeStatus = !n.sit ? 'away' : n.activity === 'call' ? 'in_call' : n.activity === 'type' ? 'typing' : 'online';
    return { id: n.a.id, x: n.pos.x, y: n.pos.y, face: n.face, moving: n.mode === 'walk' && n.path.length > 0, sit: n.sit, seatId: n.seatId, activity: n.activity, status, speaking: n.speaking, note: n.note };
  }

  // ---------- decisão ----------
  private atDesk(i: Inner) {
    return i.mode === 'desk' && !!i.a.desk && i.sit;
  }

  private pick<T>(xs: T[]): T | undefined {
    return xs[Math.floor(this.rnd() * xs.length)];
  }

  private freePois(kind: PoiKind, sitOnly?: boolean) {
    return this.o.pois.filter((p) => p.kind === kind && !this.occupied.has(p.id) && (sitOnly === undefined || !!p.sit === sitOnly));
  }

  private goHome(i: Inner) {
    this.freePoi(i.a.id);
    i.plan = null;
    const d = i.a.desk;
    if (!d) {
      i.mode = 'dwell';
      i.t = 2;
      i.sit = false;
      i.seatId = null;
      return;
    }
    const path = this.o.nav.path(i.pos, d.at);
    if (!path) {
      this.sitDown(i);
      return;
    }
    i.mode = 'walk';
    i.path = path;
    i.note = 'voltando para a mesa';
    i.activity = 'work';
    i.sit = false;
    i.seatId = null;
    i.walkClock = 0;
  }

  private sitDown(i: Inner) {
    const d = i.a.desk!;
    i.mode = 'desk';
    i.pos = { ...d.at };
    i.face = d.face;
    i.sit = true;
    i.seatId = d.seatId;
    i.activity = 'work';
    i.note = 'trabalhando';
    i.deskT = 8 + this.rnd() * 16;
    i.plan = null;
    i.path = [];
  }

  private startWalk(i: Inner, plan: Plan, to: Pt): boolean {
    const path = this.o.nav.path(i.pos, to);
    if (!path) {
      i.needs[plan.need] = 0.3;
      return false;
    }
    if (plan.poi) this.occupied.set(plan.poi.id, i.a.id);
    i.plan = plan;
    i.mode = 'walk';
    i.path = path;
    i.sit = false;
    i.seatId = null;
    i.activity = 'work';
    i.note = plan.note;
    i.walkClock = 0;
    return true;
  }

  private choose(i: Inner): boolean {
    const n = i.needs;
    const entries = (Object.keys(n) as Need[]).map((k) => [k, n[k] + this.rnd() * 0.35] as const).sort((a, b) => b[1] - a[1]);
    for (const [need] of entries) {
      if (n[need] < 0.85) break;
      if (this.tryNeed(i, need)) return true;
    }
    return false;
  }

  private tryNeed(i: Inner, need: Need): boolean {
    const r = this.rnd();
    if (need === 'thirst') {
      const poi = this.pick(this.freePois(r < 0.55 ? 'coffee' : 'water')) ?? this.pick(this.freePois('coffee')) ?? this.pick(this.freePois('water'));
      if (!poi) return false;
      return this.startWalk(i, { need, poi, dwell: 6 + this.rnd() * 6, activity: 'drink', note: poi.kind === 'coffee' ? 'foi tomar um café' : 'foi beber água' }, poi.at);
    }
    if (need === 'task') {
      if (r < 0.55) {
        const poi = this.pick(this.freePois('printer'));
        if (poi) return this.startWalk(i, { need, poi, dwell: 5 + this.rnd() * 5, activity: 'tool', note: 'buscando uma impressão' }, poi.at);
      }
      const poi = this.pick(this.freePois(r < 0.8 ? 'shelf' : 'board'));
      if (!poi) return false;
      return this.startWalk(i, { need, poi, dwell: 5 + this.rnd() * 6, activity: poi.kind === 'board' ? 'talk' : 'tool', note: poi.kind === 'board' ? 'anotando no quadro' : 'procurando um documento' }, poi.at);
    }
    if (need === 'rest') {
      const poi = r < 0.6 ? this.pick(this.freePois('sofa', true)) : this.pick(this.freePois('screen'));
      if (!poi) return false;
      return this.startWalk(i, { need, poi, dwell: poi.sit ? 14 + this.rnd() * 14 : 7 + this.rnd() * 7, activity: poi.sit ? 'rest' : 'look', note: poi.sit ? 'fazendo uma pausa' : 'olhando a TV' }, poi.at);
    }
    if (need === 'social') {
      const peers = [...this.s.values()].filter((q) => q !== i && !this.controlled.has(q.a.id) && this.atDesk(q) && !q.visitor);
      const peer = this.pick(peers);
      if (!peer) return false;
      const d = peer.a.desk!;
      const dir = { x: Math.cos(d.face), y: Math.sin(d.face) };
      const side = this.rnd() < 0.5 ? 1 : -1;
      const want = { x: d.at.x - dir.x * this.o.chatGap * 0.2 - dir.y * side * this.o.chatGap, y: d.at.y - dir.y * this.o.chatGap * 0.2 + dir.x * side * this.o.chatGap };
      const spot = this.o.nav.snap(want);
      if (!spot) return false;
      const plan: Plan = { need, peer: peer.a.id, dwell: 8 + this.rnd() * 10, activity: 'talk', note: `foi conversar com ${peer.a.name.split(' ')[0]}` };
      if (!this.startWalk(i, plan, spot)) return false;
      peer.visitor = i.a.id;
      return true;
    }
    // reunião rápida: duas a quatro pessoas sentam na sala
    const seats = this.freePois('meeting', true);
    if (seats.length < 2) return false;
    const mates = [...this.s.values()].filter((q) => q !== i && !this.controlled.has(q.a.id) && this.atDesk(q) && !q.visitor);
    const group = [i, ...mates.sort(() => this.rnd() - 0.5).slice(0, 1 + Math.floor(this.rnd() * 2))].slice(0, seats.length);
    const dwell = 18 + this.rnd() * 14;
    let ok = false;
    group.forEach((g, k) => {
      if (this.startWalk(g, { need: 'meet', poi: seats[k], dwell: dwell + k * 0.5, activity: 'talk', note: 'em reunião rápida' }, seats[k].at)) ok = true;
    });
    return ok;
  }

  // ---------- passo ----------
  tick(dt: number) {
    this.clock += dt;
    for (const i of this.s.values()) {
      if (this.controlled.has(i.a.id)) continue;
      i.needs.thirst += dt / 110;
      i.needs.social += dt / 140;
      i.needs.rest += dt / 190;
      i.needs.task += dt / 120;
      i.needs.meet += dt / 330;

      if (i.mode === 'desk') this.deskStep(i, dt);
      else if (i.mode === 'walk') this.walkStep(i, dt);
      else this.dwellStep(i, dt);

      // fala (balão): alterna a cada poucos segundos
      i.speakT -= dt;
      if (i.speakT <= 0) {
        i.speaking = i.activity === 'call' || i.activity === 'talk' ? !i.speaking : null;
        i.speakT = 0.7 + this.rnd() * 1.6;
      }
      if (i.activity !== 'call' && i.activity !== 'talk') i.speaking = null;
    }
  }

  private deskStep(i: Inner, dt: number) {
    const d = i.a.desk;
    if (!d) {
      this.goHome(i);
      return;
    }
    i.deskT -= dt;
    if (i.visitor) {
      const v = this.s.get(i.visitor);
      if (!v || v.plan?.peer !== i.a.id) {
        i.visitor = null;
        return;
      }
      i.activity = 'talk';
      i.note = 'conversando com um colega';
      if (v.mode === 'dwell') i.face += angDiff(i.face, Math.atan2(v.pos.y - i.pos.y, v.pos.x - i.pos.x)) * Math.min(1, dt * 3);
      return;
    }
    // sem visita: volta a olhar para a tela
    if (i.activity === 'talk') {
      i.activity = 'work';
      i.note = 'trabalhando';
      i.deskT = 4 + this.rnd() * 6;
    }
    i.face += angDiff(i.face, d.face) * Math.min(1, dt * 3);
    if (i.deskT > 0) return;
    if (i.activity === 'call') {
      i.activity = 'work';
      i.deskT = 6 + this.rnd() * 10;
      i.note = 'trabalhando';
      return;
    }
    if (this.choose(i)) return;
    const r = this.rnd();
    if (this.o.callDepts?.includes(i.a.dept) && r < 0.16) {
      i.activity = 'call';
      i.deskT = 14 + this.rnd() * 22;
      i.note = 'em atendimento';
    } else if (r < 0.7) {
      i.activity = 'type';
      i.deskT = 5 + this.rnd() * 12;
      i.note = 'digitando';
    } else {
      i.activity = 'work';
      i.deskT = 4 + this.rnd() * 9;
      i.note = 'trabalhando';
    }
  }

  private walkStep(i: Inner, dt: number) {
    i.walkClock += dt;
    let move = this.o.nav.speed * dt;
    while (move > 0 && i.path.length) {
      const w = i.path[0];
      const dx = w.x - i.pos.x;
      const dy = w.y - i.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-6) {
        i.path.shift();
        continue;
      }
      i.face += angDiff(i.face, Math.atan2(dy, dx)) * Math.min(1, dt * 10);
      const step = Math.min(move, dist);
      i.pos.x += (dx / dist) * step;
      i.pos.y += (dy / dist) * step;
      move -= step;
      if (step >= dist - 1e-6) i.path.shift();
    }
    this.separate(i, dt);
    if (i.walkClock > 90) {
      // travou: nunca fica preso no mapa
      this.freePoi(i.a.id);
      if (i.plan?.peer) {
        const peer = this.s.get(i.plan.peer);
        if (peer) peer.visitor = null;
      }
      if (i.a.desk) {
        this.sitDown(i);
        return;
      }
      i.path = [];
    }
    if (i.path.length) return;
    // chegou
    if (!i.plan) {
      if (i.a.desk) this.sitDown(i);
      else {
        i.mode = 'dwell';
        i.t = 3;
        i.activity = 'work';
      }
      return;
    }
    const p = i.plan;
    i.mode = 'dwell';
    i.t = p.dwell;
    i.activity = p.activity;
    i.note = p.note;
    if (p.poi) {
      i.face = p.poi.face;
      if (p.poi.sit) {
        i.pos = { ...p.poi.at };
        i.sit = true;
        i.seatId = `poi:${p.poi.id}`;
      }
    }
  }

  /** Desvio simples: quem passa perto de alguém em pé ou andando é empurrado para o lado (com uma folga para a direita, que desfaz o empate de frente a frente). */
  private separate(i: Inner, dt: number) {
    const R = this.o.nav.speed * 0.42;
    let fx = 0;
    let fy = 0;
    for (const o of this.s.values()) {
      if (o === i || o.sit) continue;
      const dx = i.pos.x - o.pos.x;
      const dy = i.pos.y - o.pos.y;
      const d = Math.hypot(dx, dy);
      if (d >= R || d < 1e-6) continue;
      const w = (R - d) / R;
      fx += (dx / d) * w;
      fy += (dy / d) * w;
      // folga lateral (à direita de quem anda): evita dois ficarem presos de frente um para o outro
      fx += -Math.sin(i.face) * w * 0.7;
      fy += Math.cos(i.face) * w * 0.7;
    }
    if (!fx && !fy) return;
    const k = this.o.nav.speed * dt * 1.1;
    const next = { x: i.pos.x + fx * k, y: i.pos.y + fy * k };
    if (!this.o.nav.isFree || this.o.nav.isFree(next)) i.pos = next;
  }

  private dwellStep(i: Inner, dt: number) {
    i.t -= dt;
    if (i.plan?.peer) {
      const peer = this.s.get(i.plan.peer);
      if (peer) i.face += angDiff(i.face, Math.atan2(peer.pos.y - i.pos.y, peer.pos.x - i.pos.x)) * Math.min(1, dt * 4);
    }
    if (i.t > 0) return;
    const plan = i.plan;
    if (plan) i.needs[plan.need] = Math.max(0, i.needs[plan.need] - 1.2 - this.rnd() * 0.3);
    if (plan?.peer) {
      const peer = this.s.get(plan.peer);
      if (peer) peer.visitor = null;
    }
    this.goHome(i);
  }
}
