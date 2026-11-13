/**
 * Thread de trabalho que gera o modelo 3D de um personagem personalizado (estilo Ara 3D Gen).
 * Roda fora da thread principal porque construir o corpo e otimizar as texturas leva alguns segundos de CPU,
 * e isso não pode atrasar a presença ao vivo (SSE) nem as demais rotas. Quem chama: server/araGen.ts.
 * Entrada: parâmetros JÁ validados (shared/araCustom.ts). Saída: LOD0 (detalhe médio, com visemas) e LOD1 (distante).
 */
import { parentPort, workerData } from 'node:worker_threads';
import { buildHuman } from '../vendor/ara3d/src/core/human';
import { DEFAULT_PARAMS } from '../vendor/ara3d/src/core/params';
import { exportCharacter } from '../vendor/ara3d/src/export';
import { nodeLibrary } from '../vendor/ara3d/scripts/node-assets';
import { toHumanParams, type AraParams } from '../shared/araCustom';
import { newIO, optimizeLod0, optimizeLod1 } from '../tools/avatars-ara/optimize';

export interface GenRequest { id: number; params: AraParams }
export type GenReply = { id: number; ok: true; lod0: Uint8Array; lod1: Uint8Array; height: number; tris: number; lod1Tris: number; ms: number } | { id: number; ok: false; error: string };

const lib = await nodeLibrary((workerData as { assets: string }).assets);
const io = newIO();

parentPort!.on('message', async ({ id, params }: GenRequest) => {
  const t0 = Date.now();
  try {
    // detalhe médio com expressões e visemas (o rig usa a fala); detalhe baixo sem morphs, para simplificar
    const medium = await buildHuman(lib, toHumanParams(DEFAULT_PARAMS, params, { detail: 'medium', faceShapes: true }));
    const glb0 = await exportCharacter(lib, medium, 'glb');
    const low = await buildHuman(lib, toHumanParams(DEFAULT_PARAMS, params, { detail: 'low', faceShapes: false }));
    const glb1 = await exportCharacter(lib, low, 'glb');
    const o0 = await optimizeLod0(io, glb0.data);
    const o1 = await optimizeLod1(io, glb1.data);
    const reply: GenReply = { id, ok: true, lod0: o0.bytes, lod1: o1.bytes, height: o0.stats.height, tris: o0.stats.tris, lod1Tris: o1.stats.tris, ms: Date.now() - t0 };
    parentPort!.postMessage(reply, [o0.bytes.buffer as ArrayBuffer, o1.bytes.buffer as ArrayBuffer]);
  } catch (e) {
    const reply: GenReply = { id, ok: false, error: (e as Error).message ?? String(e) };
    parentPort!.postMessage(reply);
  }
});
