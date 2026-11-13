/**
 * Worker da pré-visualização do "Meu avatar" (estilo Ara 3D Gen): roda o gerador do Ara no navegador, fora da thread da
 * tela, e devolve um GLB do personagem para o renderizador do Office 3D. É só prévia local: o modelo que os colegas veem é
 * gerado pelo servidor ao salvar. Sem morph targets (faceShapes desligado): não precisa de visemas e evita o shader pesado.
 * Se chegarem vários pedidos enquanto um roda, só o mais recente é executado.
 */
import { AssetLibrary, fetchSource } from '../../../vendor/ara3d/src/core/assets';
import { buildHuman } from '../../../vendor/ara3d/src/core/human';
import { DEFAULT_PARAMS } from '../../../vendor/ara3d/src/core/params';
import { exportCharacter } from '../../../vendor/ara3d/src/export';
import { toHumanParams, type AraParams } from '../../../shared/araCustom';

export type ToPreviewWorker = { type: 'init'; assets: string } | { type: 'build'; id: number; params: AraParams };
export type FromPreviewWorker = { type: 'built'; id: number; glb: ArrayBuffer; ms: number } | { type: 'error'; id: number; message: string };

let lib: Promise<AssetLibrary> | undefined;
let pending: Extract<ToPreviewWorker, { type: 'build' }> | null = null;
let busy = false;
const post = (m: FromPreviewWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

async function loop() {
  busy = true;
  while (pending) {
    const m = pending;
    pending = null;
    const t0 = performance.now();
    try {
      const L = await lib!;
      const ch = await buildHuman(L, toHumanParams(DEFAULT_PARAMS, m.params, { detail: 'medium', faceShapes: false, name: 'preview' }));
      const file = await exportCharacter(L, ch, 'glb');
      const glb = file.data.slice().buffer as ArrayBuffer; // cópia exata (o buffer original pode ser maior que o arquivo)
      post({ type: 'built', id: m.id, glb, ms: Math.round(performance.now() - t0) }, [glb]);
    } catch (e) {
      post({ type: 'error', id: m.id, message: (e as Error).message ?? String(e) });
    }
  }
  busy = false;
}

self.onmessage = (e: MessageEvent<ToPreviewWorker>) => {
  const m = e.data;
  if (m.type === 'init') {
    lib = new AssetLibrary(fetchSource(m.assets)).init();
    return;
  }
  pending = m;
  if (!busy) void loop();
};
