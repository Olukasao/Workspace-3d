/**
 * Cliente da presença ao vivo (SSE em /api/live/stream).
 * - `snapshot` ao conectar (e a cada reconexão) substitui o estado inteiro: sem avatar duplicado após cair a rede;
 * - `person` é incremental; eventos com versão menor ou igual à conhecida são ignorados (chegaram atrasados);
 * - `resync` (troca de mesa, publicação, diretório) pede que a cena recarregue a visão operacional.
 * Uma única conexão por aba; o servidor consolida várias abas/dispositivos num avatar por pessoa.
 */
import { create } from 'zustand';
import { DEFAULT_AVATAR_STYLE, type AnyAvatarConfig, type AvatarStyle } from '../shared/avatarAra';

export type LiveStatus = 'offline' | 'in_call' | 'typing' | 'online';
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
  /** estilo de avatar ativo da empresa (o administrador pode trocar; chega no snapshot) */
  avatarStyle: AvatarStyle;
  people: Record<string, LivePerson>;
  resyncNonce: number;
  seq: number;
  ignoredStale: number;
  apply(p: LivePerson): void;
  snapshot(s: { seq: number; people: LivePerson[]; presenceVisible: boolean; avatarStyle?: AvatarStyle }): void;
}

export const useLive = create<LiveState>((set, get) => ({
  connected: false,
  presenceVisible: false,
  avatarStyle: DEFAULT_AVATAR_STYLE,
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
    set({ people: Object.fromEntries(s.people.map((p) => [p.employeeId, p])), seq: s.seq, presenceVisible: s.presenceVisible, avatarStyle: s.avatarStyle ?? DEFAULT_AVATAR_STYLE });
  },
}));

if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __office3dLive?: typeof useLive }).__office3dLive = useLive;

let source: EventSource | null = null;
let refs = 0;

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

export const demoCall = {
  start: (speakingSignal: boolean) => post('/api/live/call', { action: 'start', speakingSignal }),
  end: () => post('/api/live/call', { action: 'end' }),
  speaking: (speaking: boolean) => post('/api/live/speaking', { speaking }),
};
