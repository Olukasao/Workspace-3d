/** Teste de fumaça: o gerador do Ara (vendor/ara3d), com o `three` do projeto, gera um personagem personalizado. */
import { join } from 'node:path';
import { buildHuman } from '../../vendor/ara3d/src/core/human';
import { DEFAULT_PARAMS } from '../../vendor/ara3d/src/core/params';
import { exportCharacter } from '../../vendor/ara3d/src/export';
import { nodeLibrary } from '../../vendor/ara3d/scripts/node-assets';

const lib = await nodeLibrary(join(import.meta.dirname, '../../public/assets/ara-data'));
const t0 = performance.now();
const params = { ...DEFAULT_PARAMS, name: 'smoke', gender: 0.1, age: 0.6, weight: 0.65, height: 0.3, modifiers: { 'head/head-age': 0.4 }, outfit: 'set_pantsuit', hair: 'bob01', animations: false, restPose: 'A' as const, rig: 'game' as const, faceBones: false };
const ch = await buildHuman(lib, params);
const t1 = performance.now();
const f = await exportCharacter(lib, ch, 'glb');
console.log(`ok: ${(ch.height * 100).toFixed(0)} cm, build ${(t1 - t0).toFixed(0)} ms, export ${(performance.now() - t1).toFixed(0)} ms, ${(f.data.length / 1048576).toFixed(1)} MB`);

// quantos morph targets saem com e sem ossos de rosto
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
for (const faceBones of [false, true]) {
  const c = await buildHuman(lib, { ...params, faceBones });
  const file = await exportCharacter(lib, c, 'glb');
  const d = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(file.data);
  const t = Math.max(0, ...d.getRoot().listMeshes().flatMap((m) => m.listPrimitives().map((p) => p.listTargets().length)));
  console.log(`faceBones=${faceBones}: ${t} morph targets, ${d.getRoot().listSkins()[0]?.listJoints().length} ossos`);
}
