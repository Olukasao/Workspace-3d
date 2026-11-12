/**
 * Pipeline de GLB usado tanto pela curadoria (tools/assets) quanto pelo upload do administrador:
 * inspeção de segurança, normalização (metros, Y para cima, pivô na base ou âncora de parede) e medidas.
 */
import { createHash } from 'node:crypto';
import { Document, NodeIO, type Node as GNode } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';

export interface GlbLimits {
  maxBytes: number;
  maxTriangles: number;
  maxTextureSize: number;
}

export const UPLOAD_LIMITS: GlbLimits = { maxBytes: 8 * 1024 * 1024, maxTriangles: 150_000, maxTextureSize: 2048 };

/** Extensões aceitas em upload. As demais são recusadas quando aparecem como obrigatórias. */
const ALLOWED_REQUIRED_EXTENSIONS = new Set(['KHR_materials_emissive_strength', 'KHR_materials_unlit', 'KHR_mesh_quantization', 'KHR_texture_transform', 'EXT_texture_webp', 'KHR_materials_transmission', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_clearcoat']);

export class GlbRejected extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Checagem estrutural ANTES de interpretar o arquivo: assinatura GLB, versão 2, tamanho declarado,
 * chunk JSON válido e nenhum recurso externo (buffers/imagens com `uri` só podem ser data: embutido — aqui nem isso: exige GLB autocontido).
 */
export function inspectGlb(bytes: Uint8Array, limits: GlbLimits = UPLOAD_LIMITS): { json: Record<string, unknown> } {
  if (bytes.byteLength > limits.maxBytes) throw new GlbRejected('too_large', `Arquivo acima do limite de ${(limits.maxBytes / 1048576).toFixed(0)} MB.`);
  if (bytes.byteLength < 20) throw new GlbRejected('invalid_type', 'Arquivo vazio ou truncado.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new GlbRejected('invalid_type', 'O arquivo não é um GLB (assinatura glTF binária ausente).');
  if (view.getUint32(4, true) !== 2) throw new GlbRejected('invalid_type', 'Só glTF 2.0 é aceito.');
  if (view.getUint32(8, true) !== bytes.byteLength) throw new GlbRejected('invalid_type', 'Tamanho declarado no cabeçalho não confere com o arquivo.');
  const jsonLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLen > bytes.byteLength) throw new GlbRejected('invalid_type', 'Bloco JSON do GLB ausente ou corrompido.');
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen))) as Record<string, unknown>;
  } catch {
    throw new GlbRejected('invalid_type', 'Bloco JSON do GLB inválido.');
  }
  const withUri = (list: unknown) => (Array.isArray(list) ? list.filter((e) => e && typeof e === 'object' && typeof (e as { uri?: unknown }).uri === 'string') : []);
  if (withUri(json.buffers).length || withUri(json.images).length) {
    throw new GlbRejected('external_resources', 'O modelo referencia arquivos externos (buffers ou imagens por URI). Envie um GLB autocontido.');
  }
  const required = Array.isArray(json.extensionsRequired) ? (json.extensionsRequired as string[]) : [];
  const unknown = required.filter((e) => !ALLOWED_REQUIRED_EXTENSIONS.has(e));
  if (unknown.length) throw new GlbRejected('unsupported_extension', `Extensão obrigatória não suportada: ${unknown.join(', ')}.`);
  return { json };
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function countTriangles(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices();
      n += idx ? idx.getCount() / 3 : (p.getAttribute('POSITION')?.getCount() ?? 0) / 3;
    }
  }
  return Math.round(n);
}

export interface NormalizeOptions {
  /** Escala uniforme para que a medida indicada (m) seja atingida. Sem `fit`, o modelo já deve estar em metros. */
  fit?: { w?: number; d?: number; h?: number };
  /** Giro (graus) para a frente do modelo apontar para +Z. */
  rotY?: number;
  /** Giro (graus) em X para endireitar modelos exportados deitados. */
  rotX?: number;
  pivot: 'base-center' | 'wall-back';
}

export interface NormalizeResult {
  width: number;
  depth: number;
  height: number;
  scale: number;
}

function wrapScene(doc: Document, name: string): GNode {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new GlbRejected('invalid_model', 'O modelo não tem cena.');
  const wrapper = doc.createNode(name);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  scene.addChild(wrapper);
  return wrapper;
}

const quatY = (deg: number): [number, number, number, number] => [0, Math.sin((deg * Math.PI) / 360), 0, Math.cos((deg * Math.PI) / 360)];
const quatX = (deg: number): [number, number, number, number] => [Math.sin((deg * Math.PI) / 360), 0, 0, Math.cos((deg * Math.PI) / 360)];

/**
 * Normaliza o documento: remove animações/skins/câmeras (cena estática), gira, escala para metros e
 * reposiciona o pivô — centro da base (objetos de piso/superfície) ou centro da face traseira (objetos de parede).
 */
export function normalizeDocument(doc: Document, opts: NormalizeOptions): NormalizeResult {
  const root = doc.getRoot();
  for (const a of root.listAnimations()) a.dispose();
  for (const s of root.listSkins()) s.dispose();
  for (const c of root.listCameras()) c.dispose();
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const t of prim.listTargets()) {
        prim.removeTarget(t);
        t.dispose();
      }
      for (const sem of prim.listSemantics()) if (sem.startsWith('JOINTS_') || sem.startsWith('WEIGHTS_')) prim.setAttribute(sem, null);
    }
  }
  const scenes = root.listScenes();
  if (!scenes.length) throw new GlbRejected('invalid_model', 'O modelo não tem cena.');
  root.setDefaultScene(scenes[0]);
  for (const extra of scenes.slice(1)) extra.dispose();

  if (opts.rotX) wrapScene(doc, 'office3d_rot_x').setRotation(quatX(opts.rotX));
  if (opts.rotY) wrapScene(doc, 'office3d_rot_y').setRotation(quatY(opts.rotY));

  const scene = scenes[0];
  const b0 = getBounds(scene);
  const size = [b0.max[0] - b0.min[0], b0.max[1] - b0.min[1], b0.max[2] - b0.min[2]];
  if (!size.every((v) => Number.isFinite(v)) || Math.max(...size) <= 0) throw new GlbRejected('invalid_model', 'O modelo não tem geometria mensurável.');
  let scale = 1;
  if (opts.fit?.h) scale = opts.fit.h / size[1];
  else if (opts.fit?.w) scale = opts.fit.w / size[0];
  else if (opts.fit?.d) scale = opts.fit.d / size[2];
  const cx = (b0.min[0] + b0.max[0]) / 2;
  const cy = (b0.min[1] + b0.max[1]) / 2;
  const cz = (b0.min[2] + b0.max[2]) / 2;
  const wrapper = wrapScene(doc, 'office3d_root');
  wrapper.setScale([scale, scale, scale]);
  if (opts.pivot === 'wall-back') wrapper.setTranslation([-cx * scale, -cy * scale, -b0.min[2] * scale]);
  else wrapper.setTranslation([-cx * scale, -b0.min[1] * scale, -cz * scale]);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { width: round(size[0] * scale), height: round(size[1] * scale), depth: round(size[2] * scale), scale };
}

export async function createIo(): Promise<NodeIO> {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS);
}

export interface OptimizeOptions {
  maxTriangles?: number;
  maxTexture?: number;
}

/** Otimização para web: solda vértices, simplifica malhas pesadas, remove duplicatas/sobras e comprime texturas em WebP. */
export async function optimizeDocument(doc: Document, opts: OptimizeOptions = {}): Promise<void> {
  const before = countTriangles(doc);
  const target = opts.maxTriangles ?? 12_000;
  const steps = [weld()];
  if (before > target) {
    const { MeshoptSimplifier } = await import('meshoptimizer');
    await MeshoptSimplifier.ready;
    steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: target / before, error: 0.02, lockBorder: false }));
  }
  steps.push(dedup(), prune());
  if (doc.getRoot().listTextures().length) {
    const sharp = (await import('sharp')).default;
    const max = opts.maxTexture ?? 512;
    steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [max, max], quality: 82 }));
  }
  await doc.transform(...steps);
}

/** Maior lado (px) entre as texturas embutidas, ou 0 se não houver. */
export function maxTextureSide(doc: Document): number {
  let max = 0;
  for (const t of doc.getRoot().listTextures()) {
    const s = t.getSize();
    if (s) max = Math.max(max, s[0], s[1]);
  }
  return max;
}
