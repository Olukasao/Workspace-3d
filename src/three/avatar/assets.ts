/**
 * Montagem de um avatar a partir dos GLB do catálogo (public/assets/avatars):
 *  - o corpo é clonado com SkeletonUtils (um esqueleto por avatar; geometria e materiais compartilhados);
 *  - cada peça é religada ao esqueleto do corpo pelos nomes dos ossos (mesmo rig game_engine em todos os arquivos);
 *  - a pele coberta pela roupa é descartada no shader do corpo (bits _hidea/_hideb gravados pelo build do Blender);
 *  - a parte principal de cada peça ("tint") recebe a cor escolhida; materiais são reaproveitados por (material, cor);
 *  - o headset vem preso ao osso da cabeça.
 * GLB e texturas ficam em cache global: N avatares iguais compartilham tudo, menos o esqueleto e os materiais com cor.
 */
import { Color, DoubleSide, Material, Mesh, MeshStandardMaterial, Object3D, Skeleton, SkinnedMesh, SRGBColorSpace, TextureLoader, type Bone, type Group, type Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AvatarBase, AvatarConfig } from '../../../shared/avatarCatalog';
import { disposeMaterial, disposeScene } from '../dispose';
import { FACES, itemFor, slotColorHex, AVATAR_SLOTS } from '../../../shared/avatarCatalog';

export interface ManifestItem { id: string; slot: string; base: AvatarBase; source: string; file: string; lod1: string | null; tris: number; tint: boolean; hideBit: number | null; attach?: string; meta: Record<string, string> }
export interface ManifestBase { base: AvatarBase; headTop: number; body: string; bodyLod1: string; items: ManifestItem[]; skins: Array<{ id: string; file: string }>; shapeKeys: string[]; bones: string[] }
export interface AvatarManifest { bits: Record<string, number>; bases: Record<AvatarBase, ManifestBase>; files: Record<string, { bytes: number; tris: number }> }

const ROOT = '/assets/avatars/';
let manifest: Promise<AvatarManifest> | null = null;
export function loadAvatarManifest(): Promise<AvatarManifest> {
  manifest ??= fetch(ROOT + 'manifest.json').then((r) => {
    if (!r.ok) throw new Error('manifesto dos avatares indisponível');
    return r.json() as Promise<AvatarManifest>;
  });
  return manifest;
}

const loader = new GLTFLoader();
const gltfs = new Map<string, Promise<GLTF>>();
export function loadGltf(rel: string): Promise<GLTF> {
  let p = gltfs.get(rel);
  if (!p) {
    p = loader.loadAsync(ROOT + rel);
    p.catch(() => gltfs.delete(rel));
    gltfs.set(rel, p);
  }
  return p;
}

const texLoader = new TextureLoader();
const textures = new Map<string, Promise<Texture>>();
function loadSkin(rel: string): Promise<Texture> {
  let p = textures.get(rel);
  if (!p) {
    p = texLoader.loadAsync(ROOT + rel).then((t) => {
      t.colorSpace = SRGBColorSpace;
      t.flipY = false; // convenção glTF
      t.anisotropy = 4;
      return t;
    });
    textures.set(rel, p);
  }
  return p;
}

/** Libera da GPU todos os modelos, texturas e materiais dos avatares em cache (ao sair do modo 3D). */
export function disposeAvatarAssets() {
  for (const p of gltfs.values()) void p.then((g) => disposeScene(g.scene), () => undefined);
  gltfs.clear();
  for (const m of tinted.values()) disposeMaterial(m);
  tinted.clear();
  for (const p of textures.values()) void p.then((t) => t.dispose(), () => undefined);
  textures.clear();
  manifest = null;
}

// ---------- materiais ----------
const tinted = new Map<string, Material>();
/** Material da peça com a cor do usuário na parte "tint"; os demais são compartilhados como vieram. */
function materialFor(src: Material, color: string | undefined, slot: string): Material {
  const isTint = /^tint(.|$)/.test(src.name) && !!color; // o Blender numera cópias (tint.020)
  const key = `${src.uuid}|${isTint ? color : ''}|${slot}`;
  let m = tinted.get(key);
  if (m) return m;
  m = isTint ? src.clone() : src;
  if (isTint) (m as MeshStandardMaterial).color = new Color(color);
  const std = m as MeshStandardMaterial;
  // O MPFB exporta quase tudo como BLEND (transparente): sem escrita de profundidade, a pele some na frente de olhos e dentes.
  // Opaco por padrão; recorte por alfa só onde há fios (cabelo, barba, sobrancelha, cílios); óculos mantêm a transparência das lentes.
  const cutout = slot === 'hair' || slot === 'beard' || /eyebrow|eyelash/i.test(src.name);
  const eyes = /high-poly|low-poly/i.test(src.name); // olho: córnea transparente sobre a íris
  if (!cutout && slot !== 'glasses' && !eyes) {
    if (std === src) m = std.clone();
    const o = m as MeshStandardMaterial;
    o.transparent = false;
    o.opacity = 1;
    o.alphaTest = 0;
    o.depthWrite = true;
  }
  if (cutout) {
    if (std === src) m = std.clone();
    const std2 = m as MeshStandardMaterial;
    std2.transparent = false;
    std2.alphaTest = 0.4;
    std2.alphaToCoverage = true;
    std2.side = DoubleSide;
    std2.depthWrite = true;
  }
  (m as MeshStandardMaterial).roughness = Math.max((m as MeshStandardMaterial).roughness ?? 0.8, slot === 'glasses' || slot === 'headset' ? 0.35 : 0.55);
  tinted.set(key, m);
  return m;
}

/** Material da pele por avatar: tom (textura) + máscara de pele coberta (uniforms). */
function skinMaterial(src: MeshStandardMaterial, tone: Texture | null, maskA: number, maskB: number): MeshStandardMaterial {
  const m = src.clone();
  if (tone) m.map = tone;
  m.roughness = 0.55;
  m.transparent = false; // opaca (ver materialFor)
  m.opacity = 1;
  m.alphaTest = 0;
  m.depthWrite = true;
  m.userData.mask = { a: maskA, b: maskB };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uMaskA = { value: maskA };
    shader.uniforms.uMaskB = { value: maskB };
    m.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float _hidea;\nattribute float _hideb;\nuniform float uMaskA;\nuniform float uMaskB;\nvarying float vHide;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHide = (((int(_hidea) & int(uMaskA)) != 0) || ((int(_hideb) & int(uMaskB)) != 0)) ? 1.0 : 0.0;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHide;')
      .replace('void main() {', 'void main() {\nif (vHide > 0.001) discard;');
  };
  m.customProgramCacheKey = () => 'office3d-avatar-skin';
  return m;
}

export interface BuiltAvatar {
  root: Group;
  bones: Record<string, Bone>;
  /** malhas com morphs (corpo, sobrancelhas, cílios, dentes, barba) */
  morphMeshes: Mesh[];
  headset: Object3D | null;
  skin: MeshStandardMaterial | null;
  lod: 0 | 1;
  height: number;
  missing: string[];
  /** nome do morph usado pelo rig → nome real no modelo (estilos com outra nomenclatura) */
  morphAlias?: Record<string, string>;
  dispose(): void;
}

/** Bits de pele escondida pelas peças vestidas. */
function maskFor(m: AvatarManifest, ids: string[]): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const id of ids) {
    const bit = m.bits[id];
    if (bit === undefined) continue;
    if (bit < 24) a |= 1 << bit;
    else b |= 1 << (bit - 24);
  }
  return { a, b };
}

/** Constrói o avatar. Peças ausentes/incompatíveis são puladas e listadas em `missing` (a cena mostra o resto). */
export async function buildAvatar(cfg: AvatarConfig, lod: 0 | 1 = 0): Promise<BuiltAvatar> {
  const m = await loadAvatarManifest();
  const base = m.bases[cfg.base];
  const body = await loadGltf(lod ? base.bodyLod1 : base.body);
  const root = cloneSkinned(body.scene) as Group;
  root.name = 'avatar';
  const bones: Record<string, Bone> = {};
  let bodyMesh: SkinnedMesh | null = null;
  const morphMeshes: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Bone).isBone) bones[o.name] = o as Bone;
    const mesh = o as SkinnedMesh;
    if (mesh.isMesh) {
      mesh.castShadow = lod === 0; // longe (LOD1) a sombra do personagem não aparece: economiza a passada de sombra
      mesh.frustumCulled = false; // o recorte é feito por avatar inteiro
      if (mesh.morphTargetDictionary) morphMeshes.push(mesh);
      if (mesh.name === 'body' || (mesh.material as Material)?.name === 'skin') bodyMesh = mesh;
      else if (mesh.material) mesh.material = materialFor(mesh.material as Material, undefined, (mesh.material as Material).name);
    }
  });
  const missing: string[] = [];
  const equipped: Array<{ item: ManifestItem; color?: string }> = [];
  for (const slot of AVATAR_SLOTS) {
    const id = (cfg as unknown as Record<string, string>)[slot];
    if (!id || id === 'none') continue;
    if (slot === 'headset') continue; // headset é montado à parte (visível em atendimento)
    const item = base.items.find((i) => i.id === id);
    if (!item) {
      missing.push(id);
      continue;
    }
    equipped.push({ item, color: slotColorHex(cfg, slot) });
  }
  const mask = maskFor(m, equipped.map((e) => e.item.id));
  let skin: MeshStandardMaterial | null = null;
  if (bodyMesh) {
    const bm = bodyMesh as SkinnedMesh;
    const tone = base.skins.find((s) => s.id === cfg.skin);
    skin = skinMaterial(bm.material as MeshStandardMaterial, tone ? await loadSkin(`skins/${cfg.base}/${tone.id}.webp`).catch(() => null) : null, mask.a, mask.b);
    bm.material = skin;
  }
  const parent = (bodyMesh as SkinnedMesh | null)?.parent ?? root;
  const bodySkeleton = (bodyMesh as SkinnedMesh | null)?.skeleton ?? null;
  // o clone do SkeletonUtils dá um esqueleto a cada malha do arquivo do corpo (olhos, dentes...): unifica no do corpo
  if (bodySkeleton) {
    root.traverse((o) => {
      const sm = o as SkinnedMesh;
      if (sm.isSkinnedMesh && sm.skeleton !== bodySkeleton && sameRig(bodySkeleton, sm.skeleton)) sm.bind(bodySkeleton, sm.bindMatrix);
    });
  }
  const attach = async (item: ManifestItem, color: string | undefined): Promise<Object3D | null> => {
    const g = await loadGltf(lod && item.lod1 ? item.lod1 : item.file).catch(() => null);
    if (!g) {
      missing.push(item.id);
      return null;
    }
    const added: Object3D[] = [];
    g.scene.traverse((o) => {
      const src = o as SkinnedMesh;
      if (!src.isMesh) return;
      const mat = Array.isArray(src.material) ? src.material.map((x) => materialFor(x, color, item.slot)) : materialFor(src.material as Material, color, item.slot);
      if (item.attach === 'head' || !src.isSkinnedMesh) {
        // preso a um osso (headset): mantém a transformação local relativa ao osso
        const boneName = src.parent?.name ?? 'head';
        const target = bones[boneName] ?? bones.head;
        const mesh = new Mesh(src.geometry, mat);
        mesh.position.copy(src.position);
        mesh.quaternion.copy(src.quaternion);
        mesh.scale.copy(src.scale);
        mesh.castShadow = true;
        mesh.name = item.id;
        target?.add(mesh);
        added.push(mesh);
        return;
      }
      const mesh = new SkinnedMesh(src.geometry, mat);
      mesh.name = item.id;
      if (src.morphTargetDictionary) {
        mesh.morphTargetDictionary = src.morphTargetDictionary;
        mesh.morphTargetInfluences = new Array(src.morphTargetInfluences?.length ?? 0).fill(0);
        morphMeshes.push(mesh);
      }
      // mesmo rig em todos os arquivos: a peça usa o esqueleto do corpo (uma textura de ossos e um cálculo de matrizes
      // por avatar, em vez de um por peça); se a ordem dos ossos ou a pose de bind diferir, cria um esqueleto próprio
      const skeleton = bodySkeleton && sameRig(bodySkeleton, src.skeleton) ? bodySkeleton : new Skeleton(src.skeleton.bones.map((b) => bones[b.name] ?? b), src.skeleton.boneInverses);
      mesh.bind(skeleton, src.bindMatrix);
      mesh.castShadow = lod === 0;
      mesh.frustumCulled = false;
      parent.add(mesh);
      added.push(mesh);
    });
    return added[0] ?? null;
  };
  await Promise.all(equipped.map((e) => attach(e.item, e.color)));
  const ownMaterials = trimShoesUnderHem(parent, cfg.bottom, cfg.shoes);
  let headset: Object3D | null = null;
  const hsItem = base.items.find((i) => i.id === (cfg.headset && cfg.headset !== 'none' ? cfg.headset : 'headset.office'));
  if (hsItem) {
    headset = await attach(hsItem, undefined);
    if (headset) headset.visible = false;
  }
  root.updateMatrixWorld(true);
  const built: BuiltAvatar = {
    root, bones, morphMeshes, headset, skin, lod, height: base.headTop, missing,
    dispose() {
      root.removeFromParent();
      skin?.dispose();
      for (const x of ownMaterials) x.dispose();
    },
  };
  // variação de rosto: morph target do corpo (não é tocado pela animação)
  const face = FACES.find((x) => x.id === cfg.face)?.morph;
  if (face) setMorph(built, face, 1);
  return built;
}

/** Mesmos ossos, na mesma ordem, com a mesma pose de bind (tolerância de 1e-4). */
function sameRig(body: Skeleton, item: Skeleton): boolean {
  if (body.bones.length !== item.bones.length) return false;
  for (let i = 0; i < body.bones.length; i++) {
    if (body.bones[i].name !== item.bones[i].name) return false;
    const a = body.boneInverses[i].elements, b = item.boneInverses[i].elements;
    for (let k = 0; k < 16; k++) if (Math.abs(a[k] - b[k]) > 1e-4) return false;
  }
  return true;
}

/**
 * Calça justa + sapato de cano: a gola do sapato atravessa a barra nas pernas mais finas (visto nas folhas de clipping).
 * A parte do sapato acima da barra fica escondida pela calça de qualquer jeito, então é descartada no shader,
 * comparando a altura na pose de bind (antes do skinning: vale sentado ou em pé). Saia (barra alta) não corta nada.
 */
function trimShoesUnderHem(parent: Object3D, bottomId: string, shoesId: string): Material[] {
  const meshes = parent.children.filter((o): o is SkinnedMesh => (o as SkinnedMesh).isSkinnedMesh === true);
  const bottoms = meshes.filter((o) => o.name === bottomId);
  const shoes = meshes.filter((o) => o.name === shoesId);
  if (!bottoms.length || !shoes.length) return [];
  let hem = Infinity;
  for (const b of bottoms) {
    if (!b.geometry.boundingBox) b.geometry.computeBoundingBox();
    hem = Math.min(hem, b.geometry.boundingBox!.min.y);
  }
  const cut = hem + 0.01; // 1 cm sob a barra continua desenhado (sem fresta)
  const own: Material[] = [];
  for (const s of shoes) {
    if (!s.geometry.boundingBox) s.geometry.computeBoundingBox();
    if (s.geometry.boundingBox!.max.y <= cut) continue;
    const src = s.material as MeshStandardMaterial;
    const m = src.clone();
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uCutY = { value: cut };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vBindY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBindY = transformed.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uCutY;\nvarying float vBindY;')
        .replace('void main() {', 'void main() {\nif (vBindY > uCutY) discard;');
    };
    m.customProgramCacheKey = () => 'office3d-shoe-cut';
    s.material = m;
    own.push(m);
  }
  return own;
}

/** Influência de um morph (por nome) em todas as malhas do avatar que o tenham. */
export function setMorph(av: BuiltAvatar, name: string, value: number) {
  const real = av.morphAlias?.[name] ?? name;
  for (const mesh of av.morphMeshes) {
    const i = mesh.morphTargetDictionary?.[real];
    if (i !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[i] = value;
  }
}

export { itemFor };
