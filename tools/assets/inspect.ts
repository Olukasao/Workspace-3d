/** Lista nós, malhas e limites de um GLB/glTF (diagnóstico de curadoria). Uso: npx tsx tools/assets/inspect.ts <arquivo> */
import { getBounds } from '@gltf-transform/functions';
import { createIo } from '../../server/assets/glb';

const io = await createIo();
for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const scene = doc.getRoot().listScenes()[0];
  const r = (v: number[]) => v.map((x) => +x.toFixed(3)).join(', ');
  const b = getBounds(scene);
  console.log(`## ${file}\ncena: min [${r(b.min)}] max [${r(b.max)}]`);
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const nb = getBounds(node);
    const mats = mesh.listPrimitives().map((p) => p.getMaterial()?.getName() || '-').join('/');
    console.log(`  ${(node.getName() || '(sem nome)').padEnd(28)} min [${r(nb.min)}] max [${r(nb.max)}] mat ${mats}`);
  });
}
