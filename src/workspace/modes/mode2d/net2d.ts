/**
 * Rede do escritório 2D (cliente). O servidor é a autoridade: este módulo só PROPÕE a posição da própria pessoa
 * (no máximo 10 vezes por segundo), aceita a correção quando o servidor recusa, e recebe posições, layout e estações.
 * Sem React: a cena Phaser lê o estado daqui, sem re-renderizar a interface a cada passo.
 */
import type { Dir, Layout2D } from '../../../../shared/office2d';
import { api } from '../../../api';
import { onLiveEvent } from '../../../live';

export interface Pos2D { id: string; officeId: string; x: number; y: number; dir: Dir; moving: boolean; seat: string | null }
export interface SeatInfo { stationId: string; employeeId: string; name: string; department: string }
export interface Office2DData { layout: Layout2D; version: number; published: boolean; seats: SeatInfo[] }

export class Net2D {
  /** posições mais recentes de todas as pessoas no escritório, com o instante em que chegaram */
  readonly positions = new Map<string, Pos2D & { at: number }>();
  data: Office2DData | null = null;
  me: Pos2D | null = null;
  spectator = false;
  private offs: Array<() => void> = [];
  private lastSent = 0;
  private pending: Pick<Pos2D, 'x' | 'y' | 'dir' | 'moving' | 'seat'> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Map<string, Set<(arg?: unknown) => void>>();
  private stopped = false;

  constructor(
    readonly officeId: string,
    private employeeId: string | null,
  ) {}

  on(event: 'layout' | 'seats' | 'positions' | 'corrected', fn: (arg?: unknown) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }
  private emit(event: string, arg?: unknown) {
    this.listeners.get(event)?.forEach((fn) => fn(arg));
  }

  async loadData() {
    this.data = await api.get<Office2DData>(`/api/office2d/${this.officeId}`);
  }

  async start() {
    await this.loadData();
    if (this.stopped) return; // cancelada enquanto carregava (o React monta duas vezes em desenvolvimento): não se inscreve
    // eventos de tempo real (inscrições canceladas em stop(): nada fica escutando depois que o 2D sai)
    this.offs.push(
      onLiveEvent('p2d', (d) => {
        const { p, gone } = d as { p: Pos2D[]; gone: string[] };
        const now = performance.now();
        for (const q of p) if (q.officeId === this.officeId) this.positions.set(q.id, { ...q, at: now });
        for (const id of gone) this.positions.delete(id);
        this.emit('positions');
      }),
      onLiveEvent('layout2d', async (d) => {
        const { officeId, version } = d as { officeId: string; version: number };
        if (officeId !== this.officeId || version <= (this.data?.version ?? 0)) return; // evento antigo ou repetido
        await this.loadData();
        this.emit('layout');
      }),
      onLiveEvent('seats2d', async (d) => {
        if ((d as { officeId: string }).officeId !== this.officeId) return;
        await this.loadData();
        this.emit('seats');
      }),
    );
    if (!this.employeeId) {
      this.spectator = true; // conta sem colaborador: só observa
      return;
    }
    const j = await api.post<{ me: Pos2D; positions: Pos2D[] }>(`/api/office2d/${this.officeId}/join`);
    if (this.stopped) return;
    this.me = j.me;
    const now = performance.now();
    for (const q of j.positions) this.positions.set(q.id, { ...q, at: now });
    this.emit('positions');
  }

  /** Propõe a posição. Agrupa: só a mais recente é enviada, no máximo a cada 100 ms. */
  sendMove(p: Pick<Pos2D, 'x' | 'y' | 'dir' | 'moving' | 'seat'>) {
    if (this.spectator || this.stopped) return;
    this.pending = p;
    if (this.timer) return;
    const wait = Math.max(0, 100 - (performance.now() - this.lastSent));
    this.timer = setTimeout(() => void this.flush(), wait);
  }

  private async flush() {
    this.timer = null;
    const p = this.pending;
    this.pending = null;
    if (!p || this.stopped) return;
    this.lastSent = performance.now();
    try {
      const r = await api.post<Pos2D & { corrected: boolean }>(`/api/office2d/${this.officeId}/move`, p);
      if (r.corrected) this.emit('corrected', r);
    } catch {
      /* rede instável: a próxima posição corrige */
    }
    if (this.pending && !this.timer) this.timer = setTimeout(() => void this.flush(), 100);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const off of this.offs) off();
    this.offs = [];
    this.listeners.clear();
    this.positions.clear();
  }
}
