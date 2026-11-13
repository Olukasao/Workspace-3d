/**
 * Cliente da presença ao vivo (SSE em /api/live/stream).
 * - `snapshot` ao conectar (e a cada reconexão) substitui o estado inteiro: sem avatar duplicado após cair a rede;
 * - `person` é incremental; eventos com versão menor ou igual à conhecida são ignorados (chegaram atrasados);
 * - `resync` (troca de mesa, publicação, diretório) pede que a cena recarregue a visão operacional.
 * Uma única conexão por aba; o servidor consolida várias abas/dispositivos num avatar por pessoa.
 */
import { create } from 'zustand';
import { DEFAULT_AVATAR_STYLE, type AnyAvatarConfig, type EffectiveAvatarStyle } from '../shared/avatarAra';
import { DEFAULT_WORKSPACE_MODE, type WorkspaceState } from '../shared/workspace';

export type LiveStatus = 'offline' | 'in_call' | 'typing' | 'away' | 'online';
export interface LivePerson {
  employeeId: string;
  name: string;
  status: LiveStatus;
  call: { active: boolean; speaking: boolean | null; source: 'demo' | 'real' } | null;
  appearance: { config: AnyAvatarConfig; version: number } | null;
  simulated: boolean;
  version: number;
  seq: number;
}

interface LiveState {
  connected: boolean;
  presenceVisible: boolean;
  /** estilo de avatar em vigor: o do 3D escolhido pelo administrador, ou 'sprite2d' no modo 2D (chega no snapshot) */
  avatarStyle: EffectiveAvatarStyle;
  /** modo do ambiente (3D ou 2D) escolhido pelo administrador para toda a empresa; `version` descarta eventos atrasados */
  workspace: WorkspaceState;
  /** o servidor já informou o modo (até lá nenhum motor gráfico é carregado: nada de baixar o 3D para depois trocar para o 2D) */
  workspaceKnown: boolean;
  /** true enquanto a troca de ambiente acontece (o motor antigo sai, o novo entra) */
  switching: boolean;
  setWorkspace(w: WorkspaceState): void;
  setSwitching(v: boolean): void;
  people: Record<string, LivePerson>;
  resyncNonce: number;
  seq: number;
  ignoredStale: number;
  apply(p: LivePerson): void;
  snapshot(s: { seq: number; people: LivePerson[]; presenceVisible: boolean; avatarStyle?: EffectiveAvatarStyle; workspace?: WorkspaceState }): void;
}

export const useLive = create<LiveState>((set, get) => ({
  connected: false,
  presenceVisible: false,
  avatarStyle: DEFAULT_AVATAR_STYLE,
  workspace: { mode: DEFAULT_WORKSPACE_MODE, version: 0 },
  workspaceKnown: false,
  switching: false,
  setWorkspace(w) {
    if (w.version > get().workspace.version || !get().workspaceKnown) set({ workspace: w.version >= get().workspace.version ? w : get().workspace, workspaceKnown: true });
  },
  setSwitching(v) {
    set({ switching: v });
  },
  people: {},
  resyncNonce: 0,
  seq: 0,
  ignoredStale: 0,
  apply(p) {
    const cur = get().people[p.employeeId];
    if (cur && p.version <= cur.version) {
      set({ ignoredStale: get().ignoredStale + 1 });
      return;
    }
    set({ people: { ...get().people, [p.employeeId]: p }, seq: Math.max(get().seq, p.seq) });
  },
  snapshot(s) {
    set({ people: Object.fromEntries(s.people.map((p) => [p.employeeId, p])), seq: s.seq, presenceVisible: s.presenceVisible, avatarStyle: s.avatarStyle ?? DEFAULT_AVATAR_STYLE, ...(s.workspace && s.workspace.version >= get().workspace.version ? { workspace: s.workspace } : {}), ...(s.workspace ? { workspaceKnown: true } : {}) });
  },
}));

if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __office3dLive?: typeof useLive }).__office3dLive = useLive;

let source: EventSource | null = null;
let refs = 0;

/**
 * Eventos do escritório 2D (posições, layout, estações). Cada tela do 2D se inscreve ao montar e cancela ao desmontar: nada
 * fica escutando depois que o motor 2D sai. A inscrição vale mesmo que a conexão ainda não tenha sido aberta.
 */
const handlers = new Map<string, Set<(data: unknown) => void>>();
const EVENTS_2D = ['p2d', 'layout2d', 'seats2d', 'tv2d'] as const;
export function onLiveEvent(name: (typeof EVENTS_2D)[number], fn: (data: unknown) => void): () => void {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name)!.add(fn);
  return () => handlers.get(name)?.delete(fn);
}
export const liveHandlerCount = () => [...handlers.values()].reduce((n, s) => n + s.size, 0);

/** Abre (uma vez por aba) o fluxo de presença; devolve a função que fecha quando ninguém mais usa. */
export function connectLive(): () => void {
  refs++;
  if (!source) {
    source = new EventSource('/api/live/stream', { withCredentials: true });
    source.addEventListener('open', () => useLive.setState({ connected: true }));
    source.addEventListener('error', () => useLive.setState({ connected: false }));
    source.addEventListener('snapshot', (e) => useLive.getState().snapshot(JSON.parse((e as MessageEvent).data)));
    source.addEventListener('person', (e) => useLive.getState().apply(JSON.parse((e as MessageEvent).data)));
    source.addEventListener('resync', () => useLive.setState({ resyncNonce: useLive.getState().resyncNonce + 1 }));
    // troca de ambiente: o evento chega antes do snapshot novo; versões antigas ou repetidas são ignoradas
    source.addEventListener('mode', (e) => useLive.getState().setWorkspace(JSON.parse((e as MessageEvent).data)));
    for (const name of EVENTS_2D) source.addEventListener(name, (e) => handlers.get(name)?.forEach((fn) => fn(JSON.parse((e as MessageEvent).data))));
  }
  return () => {
    refs--;
    if (refs <= 0 && source) {
      source.close();
      source = null;
      useLive.setState({ connected: false });
    }
  };
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'office3d' }, body: JSON.stringify(body) }).then(async (r) => {
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message ?? `Erro ${r.status}`);
    return r.json();
  });

/** Sinal de digitação do chat interno: só o booleano (nunca conteúdo, teclas ou conversa). */
export const typingSignal = {
  last: 0,
  stopTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  /** chamar a cada tecla; envia "start" no máximo a cada 2,5 s e "stop" após 3 s sem digitar */
  keystroke() {
    const now = Date.now();
    if (now - this.last > 2500) {
      this.last = now;
      void post('/api/live/typing', { state: 'start' }).catch(() => undefined);
    }
    clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => this.stop(), 3000);
  },
  stop() {
    clearTimeout(this.stopTimer);
    if (!this.last) return;
    this.last = 0;
    void post('/api/live/typing', { state: 'stop' }).catch(() => undefined);
  },
};

/** "Ausente": a pessoa marca (ou o navegador marca depois de um tempo sem uso); vale só para ela. */
export const awaySignal = {
  current: false,
  set(away: boolean) {
    if (this.current === away) return;
    this.current = away;
    void post('/api/live/away', { away }).catch(() => {
      this.current = !away;
    });
  },
};

export const demoCall = {
  start: (speakingSignal: boolean) => post('/api/live/call', { action: 'start', speakingSignal }),
  end: () => post('/api/live/call', { action: 'end' }),
  speaking: (speaking: boolean) => post('/api/live/speaking', { speaking }),
};
