/**
 * Presença ao vivo dos colaboradores no escritório 3D.
 *
 * O servidor consolida, por COLABORADOR (não por aba):
 *  - conexão: conexões SSE abertas pelo aplicativo (qualquer aba/dispositivo). Sem conexões por mais de
 *    PRESENCE_GRACE_MS, a pessoa fica offline (tolerância a desconexões breves);
 *  - digitação no chat interno: início/fim com expiração (TYPING_TTL_MS). Só o booleano chega aqui — nunca teclas,
 *    conteúdo ou nome da conversa;
 *  - atendimento: ciclo início/fim vindo do provedor de atendimento/telefonia, mais o sinal booleano opcional de fala
 *    (SPEAKING_TTL_MS). Reconciliado periodicamente com a fonte.
 * Estado derivado, nesta prioridade: OFFLINE > EM ATENDIMENTO > DIGITANDO > ONLINE.
 *
 * A aparência (avatar) é persistida à parte (tabela avatar_profiles) e só viaja junto para o cliente desenhar.
 * Cada atualização leva `seq` (global, crescente) e `version` por pessoa; o cliente ignora eventos atrasados.
 */
import type { Response } from 'express';
import type { SessionUser } from '../shared/types';
import type { Db } from './db/driver';

export type LiveStatus = 'offline' | 'in_call' | 'typing' | 'online';

export interface LivePerson {
  employeeId: string;
  name: string;
  status: LiveStatus;
  /** atendimento ativo: headset + pose; `speaking` só existe se houver indicador autorizado de fala */
  call: { active: boolean; speaking: boolean | null; source: 'demo' | 'real' } | null;
  appearance: { config: unknown; version: number } | null;
  /** pessoa simulada pelo modo demonstração (sem conta) */
  simulated: boolean;
  /** versão por pessoa: cresce a cada mudança */
  version: number;
  seq: number;
}

export interface LiveConfig {
  graceMs: number;
  typingTtlMs: number;
  speakingTtlMs: number;
  callMaxMs: number;
  heartbeatMs: number;
}


interface PersonState {
  employeeId: string;
  companyId: string;
  name: string;
  connections: Set<number>;
  offlineAt: number | null; // quando a última conexão caiu (tolerância em curso)
  typingUntil: number;
  call: { active: boolean; startedAt: number; speakingUntil: number | null; hasSpeakingSignal: boolean; source: 'demo' | 'real' } | null;
  appearance: { config: unknown; version: number } | null;
  simulated: boolean;
  simulatedStatus?: LiveStatus;
  version: number;
  lastPublished: string;
}

interface Client {
  id: number;
  user: SessionUser;
  res: Response;
  canSeePresence: boolean;
}

/** Fonte de chamadas (atendimento/telefonia). A demonstração guarda as chamadas em memória. */
export interface CallSource {
  mode: 'demo' | 'real';
  /** Chamadas ativas segundo a fonte (para reconciliar). null = fonte indisponível (mantém o que há). */
  activeCalls(companyId: string): Promise<Set<string> | null>;
}

export class DemoCallSource implements CallSource {
  mode = 'demo' as const;
  private calls = new Map<string, Set<string>>();
  start(companyId: string, employeeId: string) {
    if (!this.calls.has(companyId)) this.calls.set(companyId, new Set());
    this.calls.get(companyId)!.add(employeeId);
  }
  end(companyId: string, employeeId: string) {
    this.calls.get(companyId)?.delete(employeeId);
  }
  async activeCalls(companyId: string) {
    return new Set(this.calls.get(companyId) ?? []);
  }
}

export class LiveHub {
  private people = new Map<string, PersonState>(); // chave: companyId:employeeId
  private clients = new Map<number, Client>();
  private nextClient = 1;
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private simTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: Db,
    public cfg: LiveConfig,
    public calls: CallSource,
    private demoMode: boolean,
  ) {}

  start() {
    // relógio: expira digitação/fala/tolerância e publica o que mudou
    this.timer = setInterval(() => this.tick(), 500);
    this.timer.unref?.();
    this.reconcileTimer = setInterval(() => void this.reconcileCalls(), 30_000);
    this.reconcileTimer.unref?.();
    if (this.demoMode) {
      this.simTimer = setInterval(() => void this.stepSimulation(), 9000);
      this.simTimer.unref?.();
    }
  }

  stop() {
    for (const t of [this.timer, this.reconcileTimer, this.simTimer]) if (t) clearInterval(t);
    for (const c of this.clients.values()) c.res.end();
    this.clients.clear();
  }

  private key = (companyId: string, employeeId: string) => `${companyId}:${employeeId}`;

  private async person(companyId: string, employeeId: string): Promise<PersonState | null> {
    const k = this.key(companyId, employeeId);
    let p = this.people.get(k);
    if (p) return p;
    const row = (await this.db.query<{ name: string; active: number; config_json: string | null; version: number | null; has_user: number }>(
      `SELECT e.name, e.active, a.config_json, a.version, (SELECT COUNT(*) FROM users u WHERE u.employee_id = e.id AND u.active = 1) AS has_user
         FROM employees e LEFT JOIN avatar_profiles a ON a.employee_id = e.id AND a.company_id = e.company_id
        WHERE e.id = ? AND e.company_id = ?`,
      [employeeId, companyId],
    ))[0];
    if (!row || row.active !== 1) return null;
    // outra chamada pode ter criado a pessoa enquanto a consulta rodava: reaproveita (senão perderia as conexões)
    const raced = this.people.get(k);
    if (raced) return raced;
    p = {
      employeeId, companyId, name: row.name, connections: new Set(), offlineAt: null, typingUntil: 0, call: null,
      appearance: row.config_json ? { config: JSON.parse(row.config_json), version: Number(row.version) } : null,
      simulated: this.demoMode && Number(row.has_user) === 0, version: this.seq, lastPublished: '', // versão parte do seq global: nunca regride após invalidate

    };
    this.people.set(k, p);
    return p;
  }

  /** Estado derivado com a prioridade OFFLINE > EM ATENDIMENTO > DIGITANDO > ONLINE. */
  private derive(p: PersonState, now = Date.now()): LiveStatus {
    if (p.simulated) {
      if (p.simulatedStatus === 'offline') return 'offline';
      if (p.call?.active) return 'in_call';
      return p.simulatedStatus ?? 'online';
    }
    const connected = p.connections.size > 0 || (p.offlineAt !== null && now - p.offlineAt < this.cfg.graceMs);
    if (!connected) return 'offline';
    if (p.call?.active) return 'in_call';
    if (p.typingUntil > now) return 'typing';
    return 'online';
  }

  private view(p: PersonState, now = Date.now()): LivePerson {
    const status = this.derive(p, now);
    const speaking = p.call?.active ? (p.call.hasSpeakingSignal ? (p.call.speakingUntil ?? 0) > now : null) : null;
    return {
      employeeId: p.employeeId,
      name: p.name,
      status,
      call: status === 'in_call' && p.call ? { active: true, speaking, source: p.call.source } : null,
      appearance: p.appearance,
      simulated: p.simulated,
      version: p.version,
      seq: this.seq,
    };
  }

  /** Publica a pessoa se o estado visível mudou. */
  private publish(p: PersonState, force = false) {
    const now = Date.now();
    const v = this.view(p, now);
    const sig = JSON.stringify([v.status, v.call, v.appearance?.version]);
    if (!force && sig === p.lastPublished) return;
    p.lastPublished = sig;
    this.seq++;
    p.version = this.seq;
    const out = { ...v, version: p.version, seq: this.seq };
    for (const c of this.clients.values()) {
      if (c.user.companyId !== p.companyId || !c.canSeePresence) continue;
      send(c.res, 'person', out);
    }
  }

  private tick() {
    const now = Date.now();
    for (const p of this.people.values()) {
      if (p.call?.active && now - p.call.startedAt > this.cfg.callMaxMs) p.call = null; // salvaguarda: chamada esquecida
      if (p.offlineAt !== null && p.connections.size === 0 && now - p.offlineAt >= this.cfg.graceMs) p.offlineAt = null;
      this.publish(p);
    }
  }

  // ---------- conexões (SSE) ----------

  async connect(user: SessionUser, res: Response, canSeePresence: boolean): Promise<() => void> {
    const id = this.nextClient++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 3000\n\n`);
    const client: Client = { id, user, res, canSeePresence };
    this.clients.set(id, client);
    // a própria conexão conta como presença (a pessoa está no aplicativo)
    if (user.employeeId) {
      const p = await this.person(user.companyId, user.employeeId);
      if (p) {
        p.connections.add(id);
        p.offlineAt = null;
        this.publish(p);
      }
    }
    send(res, 'snapshot', await this.snapshot(user, canSeePresence));
    const hb = setInterval(() => res.write(`: hb ${Date.now()}\n\n`), this.cfg.heartbeatMs);
    hb.unref?.();
    return () => {
      clearInterval(hb);
      this.clients.delete(id);
      if (!user.employeeId) return;
      const p = this.people.get(this.key(user.companyId, user.employeeId));
      if (!p) return;
      p.connections.delete(id);
      if (p.connections.size === 0) p.offlineAt = Date.now(); // tolerância começa agora
    };
  }

  /** Snapshot inicial da empresa (presença só para quem pode ver). */
  async snapshot(user: SessionUser, canSeePresence: boolean): Promise<{ seq: number; people: LivePerson[]; config: { graceMs: number; typingTtlMs: number }; presenceVisible: boolean }> {
    const rows = await this.db.query<{ id: string }>('SELECT id FROM employees WHERE company_id = ? AND active = 1', [user.companyId]);
    const people: LivePerson[] = [];
    if (canSeePresence) {
      for (const r of rows) {
        const p = await this.person(user.companyId, r.id);
        if (p) people.push({ ...this.view(p), version: p.version, seq: this.seq });
      }
    }
    return { seq: this.seq, people, config: { graceMs: this.cfg.graceMs, typingTtlMs: this.cfg.typingTtlMs }, presenceVisible: canSeePresence };
  }

  // ---------- sinais (sempre do PRÓPRIO colaborador) ----------

  async typing(user: SessionUser, state: 'start' | 'stop') {
    const p = await this.self(user);
    p.typingUntil = state === 'start' ? Date.now() + this.cfg.typingTtlMs : 0;
    this.publish(p);
    return this.view(p);
  }

  async callStart(user: SessionUser, opts: { speakingSignal: boolean; source: 'demo' | 'real' }) {
    const p = await this.self(user);
    p.call = { active: true, startedAt: Date.now(), speakingUntil: null, hasSpeakingSignal: opts.speakingSignal, source: opts.source };
    this.publish(p);
    return this.view(p);
  }

  async callEnd(user: SessionUser) {
    const p = await this.self(user);
    p.call = null; // ao terminar, o estado é recalculado a partir do que ainda vale (digitação, conexão)
    this.publish(p);
    return this.view(p);
  }

  async speaking(user: SessionUser, speaking: boolean) {
    const p = await this.self(user);
    if (!p.call?.active) return this.view(p);
    p.call.hasSpeakingSignal = true;
    p.call.speakingUntil = speaking ? Date.now() + this.cfg.speakingTtlMs : null;
    this.publish(p);
    return this.view(p);
  }

  private async self(user: SessionUser): Promise<PersonState> {
    if (!user.employeeId) throw Object.assign(new Error('Sua conta não está ligada a um colaborador do diretório.'), { status: 409, code: 'no_employee' });
    const p = await this.person(user.companyId, user.employeeId);
    if (!p) throw Object.assign(new Error('Colaborador inativo.'), { status: 409, code: 'no_employee' });
    return p;
  }

  /** Aparência salva: atualiza todos imediatamente (inclusive se a pessoa estiver em atendimento). */
  async appearanceChanged(companyId: string, employeeId: string, config: unknown, version: number) {
    const p = await this.person(companyId, employeeId);
    if (!p) return;
    p.appearance = { config, version };
    this.publish(p, true);
  }

  /** Colaborador desligado/reativado ou mesa trocada: força nova leitura no cliente. */
  invalidate(companyId: string) {
    for (const [k, p] of this.people) if (p.companyId === companyId) this.people.delete(k);
    for (const c of this.clients.values()) if (c.user.companyId === companyId) send(c.res, 'resync', { reason: 'directory' });
  }

  private async reconcileCalls() {
    const companies = new Set([...this.people.values()].filter((p) => p.call?.active && !p.simulated).map((p) => p.companyId));
    for (const companyId of companies) {
      const active = await this.calls.activeCalls(companyId).catch(() => null);
      if (!active) continue; // fonte indisponível: mantém
      for (const p of this.people.values()) {
        if (p.companyId === companyId && p.call?.active && !p.simulated && !active.has(p.employeeId)) {
          p.call = null;
          this.publish(p);
        }
      }
    }
  }

  // ---------- simulação (modo demonstração): colegas fictícios sem conta ----------

  /** Inicia os colegas fictícios da empresa com um estado determinístico. */
  async ensureSimulated(companyId: string) {
    if (!this.demoMode) return;
    const rows = await this.db.query<{ id: string }>('SELECT id FROM employees WHERE company_id = ? AND active = 1', [companyId]);
    for (const r of rows) {
      const p = await this.person(companyId, r.id);
      if (p?.simulated && !p.simulatedStatus) {
        p.simulatedStatus = hash(r.id) % 5 === 0 ? 'offline' : 'online';
        this.publish(p);
      }
    }
  }

  private stepSimulation() {
    const now = Date.now();
    const sims = [...this.people.values()].filter((p) => p.simulated && p.simulatedStatus);
    if (!sims.length) return;
    const p = sims[Math.floor(Math.random() * sims.length)];
    const r = Math.random();
    if (p.call?.active) {
      if (r < 0.5) p.call = null;
      else if (p.call.hasSpeakingSignal) p.call.speakingUntil = r < 0.8 ? now + this.cfg.speakingTtlMs : null;
    } else if (p.simulatedStatus === 'offline') {
      if (r < 0.4) p.simulatedStatus = 'online';
    } else if (r < 0.25) {
      p.call = { active: true, startedAt: now, speakingUntil: now + this.cfg.speakingTtlMs, hasSpeakingSignal: true, source: 'demo' };
    } else if (r < 0.55) {
      p.simulatedStatus = p.simulatedStatus === 'typing' ? 'online' : 'typing';
    } else if (r < 0.62) {
      p.simulatedStatus = 'offline';
    }
    this.publish(p);
  }

  /** Para medições: N colegas simulados com aparência e estados variados. */
  simulatedCount() {
    return [...this.people.values()].filter((p) => p.simulated).length;
  }

  clientCount() {
    return this.clients.size;
  }
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

function send(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
