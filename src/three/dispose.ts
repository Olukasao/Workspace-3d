/** Libera da GPU as geometrias, os materiais e as texturas de um objeto 3D (usado ao sair do modo 3D). */
import type { Material, Mesh, Object3D, Texture } from 'three';

const TEXTURE_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'lightMap'] as const;

export function disposeMaterial(m: Material) {
  for (const k of TEXTURE_KEYS) ((m as unknown as Record<string, Texture | null | undefined>)[k])?.dispose();
  m.dispose();
}

export function disposeScene(root: Object3D) {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m) disposeMaterial(m);
  });
}
