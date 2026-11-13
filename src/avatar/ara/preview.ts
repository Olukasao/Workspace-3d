/** Cliente do worker de pré-visualização (src/avatar/ara/previewWorker.ts): um por aba, criado sob demanda. */
import type { AraParams } from '../../../shared/araCustom';
import type { FromPreviewWorker, ToPreviewWorker } from './previewWorker';

export const ARA_DATA_URL = '/assets/ara-data/';

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (r: { id: number; glb: ArrayBuffer; ms: number }) => void; reject: (e: Error) => void }>();

function spawn(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./previewWorker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<FromPreviewWorker>) => {
    const m = e.data;
    const p = waiting.get(m.id);
    if (!p) return;
    waiting.delete(m.id);
    if (m.type === 'built') p.resolve({ id: m.id, glb: m.glb, ms: m.ms });
    else p.reject(new Error(m.message));
  };
  w.onerror = (e) => {
    for (const p of waiting.values()) p.reject(new Error(e.message || 'O gerador da pré-visualização falhou.'));
    waiting.clear();
    worker = null;
  };
  w.postMessage({ type: 'init', assets: ARA_DATA_URL } satisfies ToPreviewWorker);
  worker = w;
  return w;
}

/** Gera o GLB da prévia. Pedidos novos substituem os anteriores ainda não executados (que terminam com `superseded`). */
export function buildPreview(params: AraParams): Promise<{ id: number; glb: ArrayBuffer; ms: number }> {
  const id = ++seq;
  const w = spawn();
  for (const [oldId, p] of waiting) {
    waiting.delete(oldId);
    p.reject(Object.assign(new Error('superseded'), { superseded: true }));
  }
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage({ type: 'build', id, params } satisfies ToPreviewWorker);
  });
}

export const isSuperseded = (e: unknown) => !!(e as { superseded?: boolean })?.superseded;

/** Libera o worker (e a memória do gerador) ao sair do editor. */
export function disposePreview() {
  for (const p of waiting.values()) p.reject(Object.assign(new Error('superseded'), { superseded: true }));
  waiting.clear();
  worker?.terminate();
  worker = null;
}
