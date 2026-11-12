/**
 * Cache de modelos GLB com contagem de referências (ideia reaproveitada de FigureBox Planner: src/services/modelTextures.ts).
 * - Cada URL é baixada uma vez; as instâncias usam clone(true), que COMPARTILHA geometria e material com o modelo-base.
 * - Quando a última instância sai de cena, o modelo-base é descartado (geometrias, materiais e texturas) após um intervalo.
 * - Falha de carregamento fica registrada: a cena mostra um substituto visual no lugar.
 */
import { useEffect, useState } from 'react';
import { Box3, Matrix4, Mesh, Vector3, type BufferGeometry, type Group, type Material, type Object3D, type Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface MeshPart {
  geometry: BufferGeometry;
  material: Material | Material[];
  /** Matriz da malha relativa à raiz do modelo. */
  matrix: Matrix4;
}

interface Entry {
  promise: Promise<Group>;
  scene: Group | null;
  failed: boolean;
  refs: number;
  timer: ReturnType<typeof setTimeout> | null;
  parts: MeshPart[] | null;
}

const loader = new GLTFLoader();
const cache = new Map<string, Entry>();
const GRACE_MS = 15_000;

function disposeObject(root: Object3D) {
  const textures = new Set<Texture>();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v && (v as Texture).isTexture) textures.add(v as Texture);
      mat.dispose();
    }
  });
  textures.forEach((t) => t.dispose());
}

function entry(url: string): Entry {
  let e = cache.get(url);
  if (!e) {
    const created: Entry = { promise: Promise.resolve(null as unknown as Group), scene: null, failed: false, refs: 0, timer: null, parts: null };
    created.promise = loader.loadAsync(url).then(
      (gltf) => {
        gltf.scene.traverse((o) => {
          const m = o as Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        created.scene = gltf.scene;
        return gltf.scene;
      },
      (err) => {
        created.failed = true;
        throw err;
      },
    );
    created.promise.catch(() => undefined);
    cache.set(url, created);
    e = created;
  }
  return e;
}

function retain(url: string) {
  const e = entry(url);
  e.refs++;
  if (e.timer) {
    clearTimeout(e.timer);
    e.timer = null;
  }
}

function release(url: string) {
  const e = cache.get(url);
  if (!e) return;
  e.refs = Math.max(0, e.refs - 1);
  if (e.refs === 0 && !e.timer) {
    e.timer = setTimeout(() => {
      if (e.refs > 0) return;
      if (e.scene) disposeObject(e.scene);
      cache.delete(url);
    }, GRACE_MS);
  }
}

export type AssetLoad = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; scene: Group };

/** Modelo-base de uma URL (não clonado). Mantém a referência enquanto o componente estiver montado. */
export function useAssetScene(url: string | null | undefined): AssetLoad {
  const [state, setState] = useState<AssetLoad>(() => {
    const e = url ? cache.get(url) : undefined;
    return e?.scene ? { state: 'ready', scene: e.scene } : e?.failed ? { state: 'failed' } : { state: 'loading' };
  });
  useEffect(() => {
    if (!url) {
      setState({ state: 'failed' });
      return;
    }
    let alive = true;
    retain(url);
    const e = entry(url);
    if (e.scene) setState({ state: 'ready', scene: e.scene });
    else if (e.failed) setState({ state: 'failed' });
    else {
      setState({ state: 'loading' });
      e.promise.then(
        (scene) => alive && setState({ state: 'ready', scene }),
        () => alive && setState({ state: 'failed' }),
      );
    }
    return () => {
      alive = false;
      release(url);
    };
  }, [url]);
  return state;
}

/** Malhas do modelo com matrizes relativas à raiz (para instanciamento). */
export function meshParts(url: string, scene: Group): MeshPart[] {
  const e = cache.get(url);
  if (e?.parts) return e.parts;
  scene.updateMatrixWorld(true);
  const inv = new Matrix4().copy(scene.matrixWorld).invert();
  const parts: MeshPart[] = [];
  scene.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) parts.push({ geometry: m.geometry, material: m.material, matrix: new Matrix4().multiplyMatrices(inv, m.matrixWorld) });
  });
  if (e) e.parts = parts;
  return parts;
}

export function sceneSize(scene: Group): Vector3 {
  return new Box3().setFromObject(scene).getSize(new Vector3());
}

/**
 * Ao desmontar a cena: descarta já o que não tem mais instância. O que ainda está em uso é liberado pela contagem
 * de referências quando as instâncias saem (em desenvolvimento o React monta/desmonta duas vezes, então não se pode apagar tudo).
 */
export function disposeAllAssets() {
  for (const [url, e] of cache) {
    if (e.refs > 0) continue;
    if (e.timer) clearTimeout(e.timer);
    if (e.scene) disposeObject(e.scene);
    cache.delete(url);
  }
}

export function cacheStats() {
  return { models: cache.size, referenced: [...cache.values()].filter((e) => e.refs > 0).length };
}
