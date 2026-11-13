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
 * A aparência (avatar) é persistida à parte (tabela avatar_choices, uma linha por colaborador e estilo) e só viaja junto
 * para o cliente desenhar. O estilo ativo é um ajuste da empresa (company_settings.avatar_style), trocado pelo administrador.
 * Cada atualização leva `seq` (global, crescente) e `version` por pessoa; o cliente ignora eventos atrasados.
 */
import type { Response } from 'express';
import type { SessionUser } from '../shared/types';
import { DEFAULT_AVATAR_STYLE, isAvatarStyle, type AvatarStyle, type EffectiveAvatarStyle } from '../shared/avatarAra';
import { DEFAULT_WORKSPACE_MODE, isWorkspaceMode, type WorkspaceMode, type WorkspaceState } from '../shared/workspace';
import type { Office2D } from './office2d';
import { one, type Db } from './db/driver';

/** away = a própria pessoa marcou "ausente" (ou ficou sem mexer no computador por um tempo). */
export type LiveStatus = 'offline' | 'in_call' | 'typing' | 'away' | 'online';

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
  away: boolean;
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
  private styles = new Map<string, AvatarStyle>(); // cache do estilo ativo por empresa
  private workspace = new Map<string, WorkspaceState>(); // cache do modo (2D/3D) por empresa
  private p2d: Office2D | null = null;
  /**
   * Fora da demonstração, quem aparece no mapa (e como online) é só quem o Workspace (chat interno) marcou como "aberto":
   * a presença vem desse sinal, não de estar com a aba do Office 3D aberta. Sem o sinal, ninguém aparece.
   */
  private workspaceOpen = new Set<string>();
  get needsWorkspaceSignal() {
    return !this.demoMode;
  }

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

  attach2d(o: Office2D) {
    this.p2d = o;
  }

  /** Envia um evento SSE a todas as conexões da empresa (por padrão, só a quem pode ver a presença). */
  broadcast(companyId: string, event: string, data: unknown, presenceOnly = true) {
    for (const c of this.clients.values()) if (c.user.companyId === companyId && (!presenceOnly || c.canSeePresence)) send(c.res, event, data);
  }

  /** A pessoa está conectada (ou dentro da tolerância)? Usado para tirar do escritório 2D quem ficou offline. */
  isOnline(companyId: string, employeeId: string): boolean {
    const p = this.people.get(this.key(companyId, employeeId));
    return !!p && this.derive(p) !== 'offline';
  }

  /** Quem está online agora (inclui os colegas simulados do modo demonstração). Usado para colocar no escritório 2D. */
  onlineEmployees(): Array<{ companyId: string; employeeId: string }> {
    const out: Array<{ companyId: string; employeeId: string }> = [];
    for (const p of this.people.values()) if (this.derive(p) !== 'offline') out.push({ companyId: p.companyId, employeeId: p.employeeId });
    return out;
  }

  /** Modo já em memória (síncrono); null enquanto ninguém da empresa o consultou. */
  modeCached(companyId: string): WorkspaceMode | null {
    return this.workspace.get(companyId)?.mode ?? null;
  }

  /** Modo do ambiente virtual da empresa (padrão: 3D). `version` é o instante da última troca. */
  async workspaceState(companyId: string): Promise<WorkspaceState> {
    const hit = this.workspace.get(companyId);
    if (hit) return hit;
    const row = await one<{ setting_value: string; updated_at: number }>(this.db, "SELECT setting_value, updated_at FROM company_settings WHERE company_id = ? AND setting_key = 'workspace_mode'", [companyId]);
    const st: WorkspaceState = row && isWorkspaceMode(row.setting_value) ? { mode: row.setting_value, version: Number(row.updated_at) } : { mode: DEFAULT_WORKSPACE_MODE, version: 0 };
    this.workspace.set(companyId, st);
    return st;
  }

  /** Estilo de avatar em vigor: 'sprite2d' no modo 2D; no 3D, o estilo que o administrador escolheu. */
  async effectiveStyle(companyId: string): Promise<EffectiveAvatarStyle> {
    return (await this.workspaceState(companyId)).mode === '2d' ? 'sprite2d' : this.avatarStyle(companyId);
  }

  /**
   * Troca o modo da empresa para todos: grava, esquece o estado em memória (as aparências mudam de estilo), tira todos do
   * escritório 2D e manda a cada conexão o evento `mode` e um snapshot novo. As sessões e os dados continuam; cada navegador
   * desmonta o motor gráfico que sai e monta o que entra. Trocar para o modo em vigor não faz nada.
   */
  async setWorkspaceMode(companyId: string, mode: WorkspaceMode, userId: string): Promise<WorkspaceState> {
    const cur = await this.workspaceState(companyId);
    if (cur.mode === mode) return cur;
    const version = Math.max(Date.now(), cur.version + 1);
    await this.db.tx(async (tx) => {
      const row = await one<{ setting_value: string }>(tx, "SELECT setting_value FROM company_settings WHERE company_id = ? AND setting_key = 'workspace_mode'", [companyId]);
      if (row) await tx.exec("UPDATE company_settings SET setting_value = ?, updated_by = ?, updated_at = ? WHERE company_id = ? AND setting_key = 'workspace_mode'", [mode, userId, version, companyId]);
      else await tx.exec("INSERT INTO company_settings (company_id, setting_key, setting_value, updated_by, updated_at) VALUES (?, 'workspace_mode', ?, ?, ?)", [companyId, mode, userId, version]);
    });
    const next: WorkspaceState = { mode, version };
    this.workspace.set(companyId, next);
    this.p2d?.reset(companyId);
    for (const [k, p] of this.people) if (p.companyId === companyId) this.people.delete(k);
    for (const c of this.clients.values()) {
      if (c.user.companyId !== companyId) continue;
      if (c.user.employeeId) {
        const p = await this.person(companyId, c.user.employeeId);
        if (p) {
          p.connections.add(c.id);
          p.offlineAt = null;
        }
      }
      send(c.res, 'mode', next);
      send(c.res, 'snapshot', await this.snapshot(c.user, c.canSeePresence));
    }
    return next;
  }

  /** Estilo de avatar ativo da empresa (padrão: Ara 3D Gen). */
  async avatarStyle(companyId: string): Promise<AvatarStyle> {
    const hit = this.styles.get(companyId);
    if (hit) return hit;
    const row = await one<{ setting_value: string }>(this.db, "SELECT setting_value FROM company_settings WHERE company_id = ? AND setting_key = 'avatar_style'", [companyId]);
    const style = isAvatarStyle(row?.setting_value) ? row!.setting_value : DEFAULT_AVATAR_STYLE;
    this.styles.set(companyId, style);
    return style;
  }

  /** Troca o estilo da empresa: esquece o estado em memória e manda a todos um snapshot novo (aparências do novo estilo). */
  async setAvatarStyle(companyId: string, style: AvatarStyle, userId: string) {
    const now = Date.now();
    await this.db.tx(async (tx) => {
      const cur = await one<{ setting_value: string }>(tx, "SELECT setting_value FROM company_settings WHERE company_id = ? AND setting_key = 'avatar_style'", [companyId]);
      if (cur) await tx.exec("UPDATE company_settings SET setting_value = ?, updated_by = ?, updated_at = ? WHERE company_id = ? AND setting_key = 'avatar_style'", [style, userId, now, companyId]);
      else await tx.exec("INSERT INTO company_settings (company_id, setting_key, setting_value, updated_by, updated_at) VALUES (?, 'avatar_style', ?, ?, ?)", [companyId, style, userId, now]);
    });
    this.styles.set(companyId, style);
    for (const [k, p] of this.people) if (p.companyId === companyId) this.people.delete(k);
    // conexões abertas continuam contadas: quem tem SSE aberto volta a ser online ao reler a pessoa
    for (const c of this.clients.values()) {
      if (c.user.companyId !== companyId) continue;
      if (c.user.employeeId) {
        const p = await this.person(companyId, c.user.employeeId);
        if (p) {
          p.connections.add(c.id);
          p.offlineAt = null;
        }
      }
      send(c.res, 'snapshot', await this.snapshot(c.user, c.canSeePresence));
    }
  }

  private key = (companyId: string, employeeId: string) => `${companyId}:${employeeId}`;

  private async person(companyId: string, employeeId: string): Promise<PersonState | null> {
    const k = this.key(companyId, employeeId);
    let p = this.people.get(k);
    if (p) return p;
    const style = await this.effectiveStyle(companyId);
    const row = (await this.db.query<{ name: string; active: number; config_json: string | null; version: number | null; has_user: number }>(
      `SELECT e.name, e.active, a.config_json, a.version, (SELECT COUNT(*) FROM users u WHERE u.employee_id = e.id AND u.active = 1) AS has_user
         FROM employees e LEFT JOIN avatar_choices a ON a.employee_id = e.id AND a.company_id = e.company_id AND a.style = ?
        WHERE e.id = ? AND e.company_id = ?`,
      [style, employeeId, companyId],
    ))[0];
    if (!row || row.active !== 1) return null;
    // outra chamada pode ter criado a pessoa enquanto a consulta rodava: reaproveita (senão perderia as conexões)
    const raced = this.people.get(k);
    if (raced) return raced;
    p = {
      employeeId, companyId, name: row.name, connections: new Set(), offlineAt: null, typingUntil: 0, away: false, call: null,
      appearance: row.config_json ? { config: JSON.parse(row.config_json), version: Number(row.version) } : null,
      simulated: this.demoMode && Number(row.has_user) === 0, version: this.seq, lastPublished: '', // versão parte do seq global: nunca regride após invalidate

    };
    this.people.set(k, p);
    return p;
  }

  /** O Workspace avisou que a pessoa está com ele aberto (ou fechou). Devolve false se o colaborador não existe ou está inativo. */
  async setWorkspaceOpen(companyId: string, employeeId: string, open: boolean): Promise<boolean> {
    const p = await this.person(companyId, employeeId);
    if (!p) return false;
    const k = this.key(companyId, employeeId);
    if (open) this.workspaceOpen.add(k);
    else this.workspaceOpen.delete(k);
    this.publish(p);
    return true;
  }

  /** Lista completa de quem está com o Workspace aberto na empresa: quem não está na lista passa a offline. Devolve os ids aceitos. */
  async setWorkspaceSnapshot(companyId: string, employeeIds: string[]): Promise<string[]> {
    const want = new Set(employeeIds);
    const accepted: string[] = [];
    for (const id of want) if (await this.setWorkspaceOpen(companyId, id, true)) accepted.push(id);
      else want.delete(id);
    const prefix = `${companyId}:`;
    for (const k of [...this.workspaceOpen]) if (k.startsWith(prefix) && !want.has(k.slice(prefix.length))) await this.setWorkspaceOpen(companyId, k.slice(prefix.length), false);
    return accepted;
  }

  /** Estado derivado com a prioridade OFFLINE > EM ATENDIMENTO > DIGITANDO > ONLINE. */
  private derive(p: PersonState, now = Date.now()): LiveStatus {
    if (p.simulated) {
      if (p.simulatedStatus === 'offline') return 'offline';
      if (p.call?.active) return 'in_call';
      return p.simulatedStatus ?? 'online';
    }
    const connected = this.needsWorkspaceSignal ? this.workspaceOpen.has(this.key(p.companyId, p.employeeId)) : p.connections.size > 0 || (p.offlineAt !== null && now - p.offlineAt < this.cfg.graceMs);
    if (!connected) return 'offline';
    if (p.call?.active) return 'in_call';
    if (p.typingUntil > now) return 'typing';
    if (p.away) return 'away';
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
    this.p2d?.statusChanged(p.companyId, p.employeeId, v.status);
    const out = { ...v, version: p.version, seq: this.seq };
    for (const c of this.clients.values()) {
      if (c.user.companyId !== p.companyId || !c.canSeePresence) continue;
      send(c.res, 'person', out);
    }
  }

  private tick() {
    const now = Date.now();
    void this.p2d?.sweep().catch((e) => console.error('escritório 2D:', e));
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
  async snapshot(user: SessionUser, canSeePresence: boolean): Promise<{ seq: number; people: LivePerson[]; config: { graceMs: number; typingTtlMs: number }; presenceVisible: boolean; avatarStyle: EffectiveAvatarStyle; workspace: WorkspaceState }> {
    const rows = await this.db.query<{ id: string }>('SELECT id FROM employees WHERE company_id = ? AND active = 1', [user.companyId]);
    const people: LivePerson[] = [];
    if (canSeePresence) {
      for (const r of rows) {
        const p = await this.person(user.companyId, r.id);
        if (p) people.push({ ...this.view(p), version: p.version, seq: this.seq });
      }
    }
    return { seq: this.seq, people, config: { graceMs: this.cfg.graceMs, typingTtlMs: this.cfg.typingTtlMs }, presenceVisible: canSeePresence, avatarStyle: await this.effectiveStyle(user.companyId), workspace: await this.workspaceState(user.companyId) };
  }

  // ---------- sinais (sempre do PRÓPRIO colaborador) ----------

  async typing(user: SessionUser, state: 'start' | 'stop') {
    const p = await this.self(user);
    p.typingUntil = state === 'start' ? Date.now() + this.cfg.typingTtlMs : 0;
    this.publish(p);
    return this.view(p);
  }

  /** Marca a própria pessoa como ausente (ou de volta). Vale para o colaborador da sessão. */
  async setAway(user: SessionUser, away: boolean) {
    const p = await this.self(user);
    p.away = away;
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
