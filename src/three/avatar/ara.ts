/**
 * Estilo de avatar "Ara 3D Gen": personagens prontos (galeria) exportados como um GLB único (malha com pele,
 * esqueleto de 69 ossos com nomes Mixamo e 34 morph targets). Este módulo carrega o GLB e devolve o mesmo
 * `BuiltAvatar` do estilo MakeHuman, para o rig procedural (IK) e a cena usarem os dois sem diferença:
 *  - ossos Mixamo recebem também os nomes do rig game_engine que rig.ts usa (mapa em `BONE_MAP`);
 *  - os visemas do rig apontam para os morph targets `viseme_*` (mapa em `MORPH_ALIAS`);
 *  - o headset é geometria original, montada na posição da cabeça deste personagem e presa ao osso `Head`.
 */
import { Box3, Color, CatmullRomCurve3, CylinderGeometry, DoubleSide, Group, Material, Mesh, MeshStandardMaterial, SphereGeometry, TubeGeometry, Vector3, type Bone, type Object3D, type SkinnedMesh } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { isAraCustom, isAraPreset, type AraAvatarConfig } from '../../../shared/avatarAra';
import type { BuiltAvatar } from './assets';

export interface AraCharacter { id: string; name: string; gender: 'male' | 'female'; style: 'corporate' | 'casual'; file: string; lod1: string; tris: number; lod1Tris: number; height: number }
export interface AraManifest { characters: AraCharacter[]; files: Record<string, { bytes: number }> }

const ROOT = '/assets/avatars-ara/';
let manifest: Promise<AraManifest> | null = null;
export function loadAraManifest(): Promise<AraManifest> {
  manifest ??= fetch(ROOT + 'manifest.json').then((r) => {
    if (!r.ok) throw new Error('manifesto dos avatares (Ara 3D Gen) indisponível');
    return r.json() as Promise<AraManifest>;
  });
  return manifest;
}

const loader = new GLTFLoader();
const gltfs = new Map<string, Promise<GLTF>>();
function loadGltf(rel: string): Promise<GLTF> {
  let p = gltfs.get(rel);
  if (!p) {
    p = loader.loadAsync(ROOT + rel).then((g) => {
      tuneMaterials(g.scene);
      return g;
    });
    p.catch(() => gltfs.delete(rel));
    gltfs.set(rel, p);
  }
  return p;
}

/** Prévias do editor (parâmetros ainda não salvos): o modelo gerado no navegador, guardado só em memória e só nesta aba. */
const previewBuffers = new Map<string, ArrayBuffer>();
export function registerPreviewModel(key: string, bytes: ArrayBuffer) {
  previewBuffers.set(key, bytes);
}
export function dropPreviewModel(key: string) {
  previewBuffers.delete(key);
  gltfs.delete(`preview:${key}`);
}
export const araModelUrl = (model: string, lod: 0 | 1) => `/api/avatar/model/${model}/lod${lod}.glb`;

/** Modelo de um personagem personalizado: a prévia local (se for uma) ou o que o servidor gerou (cookie da sessão, mesma origem). */
function loadCustom(model: string, lod: 0 | 1): Promise<GLTF> {
  const preview = previewBuffers.get(model);
  const key = preview ? `preview:${model}` : `custom:${model}:${lod}`;
  let p = gltfs.get(key);
  if (!p) {
    p = (preview ? loader.parseAsync(preview.slice(0), '') : loader.loadAsync(araModelUrl(model, lod))).then((g) => {
      tuneMaterials(g.scene);
      return g;
    });
    p.catch(() => gltfs.delete(key));
    gltfs.set(key, p);
  }
  return p;
}

/** O Ara exporta cabelo/cílios/sobrancelhas como transparência e a pele com um overlay de detalhes: ajusta o desenho. */
function tuneMaterials(scene: Object3D) {
  const seen = new Set<Material>();
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (seen.has(m)) continue;
      seen.add(m);
      const std = m as MeshStandardMaterial;
      const name = std.name;
      if (/^(hair|eyebrows|eyelashes)/i.test(name)) {
        std.transparent = false;
        std.alphaTest = 0.4;
        std.alphaToCoverage = true; // borda suave sem ordenar transparência
        std.side = DoubleSide;
        std.depthWrite = true;
      } else if (/details/i.test(name)) {
        std.transparent = true;
        std.depthWrite = false;
        std.polygonOffset = true;
        std.polygonOffsetFactor = -1;
      } else if (std.transparent && !/eyes/i.test(name)) {
        std.transparent = false; // o resto é opaco (o exportador marca BLEND por segurança)
        std.opacity = 1;
        std.depthWrite = true;
      }
      std.roughness = Math.max(std.roughness ?? 0.8, 0.45);
    }
  });
}

/** nome do rig game_engine (usado por rig.ts) → nome Mixamo do Ara */
function boneMap(): Record<string, string> {
  const map: Record<string, string> = { pelvis: 'Hips', spine_01: 'Spine', spine_02: 'Spine1', spine_03: 'Spine2', neck_01: 'Neck', head: 'Head' };
  for (const [s, side] of [['l', 'Left'], ['r', 'Right']] as const) {
    Object.assign(map, {
      [`clavicle_${s}`]: `${side}Shoulder`,
      [`upperarm_${s}`]: `${side}Arm`,
      [`lowerarm_${s}`]: `${side}ForeArm`,
      [`hand_${s}`]: `${side}Hand`,
      [`thigh_${s}`]: `${side}UpLeg`,
      [`calf_${s}`]: `${side}Leg`,
      [`foot_${s}`]: `${side}Foot`,
      [`ball_${s}`]: `${side}ToeBase`,
    });
    for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) for (let k = 1; k <= 4; k++) map[`${f}_0${k}_${s}`] = `${side}Hand${f[0].toUpperCase()}${f.slice(1)}${k}`;
  }
  return map;
}
const BONE_MAP = boneMap();

/** visemas do rig (nomes do estilo MakeHuman) → morph targets do Ara */
export const MORPH_ALIAS: Record<string, string> = { viseme_aa_ah_ax_01: 'viseme_aa', viseme_ao_03: 'viseme_O', viseme_y_iy_ih_ix_06: 'viseme_I' };

const headsetMat = new MeshStandardMaterial({ color: new Color('#23272e'), roughness: 0.5, metalness: 0.2 });
const headsetAccent = new MeshStandardMaterial({ color: new Color('#3b82f6'), roughness: 0.5 });

/** Headset original do projeto, nas medidas da cabeça deste personagem (espaço do avatar, antes de prender ao osso). */
function makeHeadset(headY: number, headZ: number): Group {
  const g = new Group();
  g.name = 'headset.office';
  const zc = headZ - 0.012; // orelhas um pouco atrás do centro da cabeça
  const yE = headY + 0.018; // altura das orelhas
  const band = new CatmullRomCurve3(
    [[0.087, 0.0], [0.09, 0.05], [0.078, 0.108], [0.04, 0.147], [0, 0.158], [-0.04, 0.147], [-0.078, 0.108], [-0.09, 0.05], [-0.087, 0.0]].map(([x, y]) => new Vector3(x, headY + 0.018 + y, zc)),
  );
  g.add(new Mesh(new TubeGeometry(band, 40, 0.0055, 8), headsetMat));
  for (const sx of [1, -1]) {
    const cup = new Mesh(new CylinderGeometry(0.034, 0.034, 0.024, 24), headsetMat);
    cup.rotation.z = Math.PI / 2;
    cup.position.set(sx * 0.092, yE, zc);
    g.add(cup);
    if (sx === 1) {
      const pad = new Mesh(new CylinderGeometry(0.028, 0.028, 0.004, 20), headsetAccent);
      pad.rotation.z = Math.PI / 2;
      pad.position.set(0.105, yE, zc);
      g.add(pad);
    }
  }
  // haste do microfone: do lado esquerdo do personagem (+X) até perto do canto da boca
  const boom = new CatmullRomCurve3([new Vector3(0.1, yE - 0.012, zc + 0.01), new Vector3(0.088, yE - 0.06, zc + 0.065), new Vector3(0.05, headY - 0.034, headZ + 0.1), new Vector3(0.022, headY - 0.04, headZ + 0.112)]);
  g.add(new Mesh(new TubeGeometry(boom, 24, 0.0035, 6), headsetMat));
  const tip = new Mesh(new SphereGeometry(0.009, 12, 10), headsetAccent);
  tip.position.copy(boom.getPoint(1));
  g.add(tip);
  g.traverse((o) => ((o as Mesh).isMesh ? ((o as Mesh).castShadow = false) : undefined));
  return g;
}

/** Constrói o avatar do estilo Ara 3D Gen. Personagem inexistente cai no primeiro da galeria e entra em `missing`. */
export async function buildAraAvatar(cfg: AraAvatarConfig, lod: 0 | 1 = 0): Promise<BuiltAvatar> {
  const m = await loadAraManifest();
  const missing: string[] = [];
  let g: GLTF;
  let meshId: string;
  let height: number;
  if (isAraCustom(cfg) && cfg.model) {
    g = await loadCustom(cfg.model, lod);
    meshId = cfg.model;
    height = new Box3().setFromObject(g.scene).getSize(new Vector3()).y;
  } else {
    // personagem pronto da galeria (padrão de quem ainda não personalizou); personalizado sem modelo cai no primeiro da galeria
    const wanted = isAraPreset(cfg) ? cfg.character : '(sem modelo)';
    let ch = m.characters.find((c) => c.id === wanted);
    if (!ch) {
      missing.push(wanted);
      ch = m.characters[0];
    }
    g = await loadGltf(lod && ch.lod1 ? ch.lod1 : ch.file);
    meshId = ch.id;
    height = ch.height;
  }
  const root = cloneSkinned(g.scene) as Group;
  root.name = 'avatar';
  const bones: Record<string, Bone> = {};
  const morphMeshes: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Bone).isBone) bones[o.name] = o as Bone;
    const mesh = o as SkinnedMesh;
    if (mesh.isMesh) {
      mesh.castShadow = lod === 0;
      mesh.frustumCulled = false; // o recorte é feito por avatar inteiro
      mesh.name = meshId;
      if (mesh.morphTargetDictionary && mesh.morphTargetInfluences?.length) morphMeshes.push(mesh);
    }
  });
  for (const [mine, theirs] of Object.entries(BONE_MAP)) if (bones[theirs]) bones[mine] = bones[theirs];
  root.updateMatrixWorld(true);
  let headset: Object3D | null = null;
  const head = bones.head;
  if (head) {
    const p = root.worldToLocal(head.getWorldPosition(new Vector3()));
    headset = makeHeadset(p.y, p.z);
    headset.visible = false;
    root.add(headset);
    head.attach(headset); // segue a cabeça, mantendo a posição atual
  }
  return {
    root, bones, morphMeshes, headset, skin: null, lod, height, missing, morphAlias: MORPH_ALIAS,
    dispose() {
      root.removeFromParent();
    },
  };
}
