/**
 * Otimização dos GLB do estilo Ara 3D Gen para a web. Usado pelo pipeline da galeria (tools/avatars-ara/process.ts) e pelo
 * servidor, que gera o modelo de cada personagem personalizado ao salvar (server/araWorker.ts).
 *  - LOD0 (detalhe médio): só 5 morph targets (3 visemas e o piscar; 34 estouram o shader no driver ANGLE/D3D11),
 *    texturas em WebP (pele, olhos e cabelo 1024 px; roupas 256 px);
 *  - LOD1 (detalhe baixo, simplificado com meshoptimizer a 28%): sem morph targets, sem normal/rugosidade/oclusão/emissivo,
 *    texturas de 512 px (pele, olhos e cabelo) e 128 px.
 */
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

/** Morph targets mantidos no LOD0 (o rig só usa os visemas e o piscar). */
export const KEEP_MORPHS = ['viseme_aa', 'viseme_O', 'viseme_I', 'eyeBlinkLeft', 'eyeBlinkRight'];

export function trimMorphs(doc: Document) {
  for (const mesh of doc.getRoot().listMeshes()) {
    const names = ((mesh.getExtras() as { targetNames?: string[] }).targetNames ?? []) as string[];
    const keep = names.map((n, i) => (KEEP_MORPHS.includes(n) ? i : -1)).filter((i) => i >= 0);
    for (const prim of mesh.listPrimitives()) {
      prim.listTargets().forEach((t, i) => {
        if (!keep.includes(i)) {
          prim.removeTarget(t);
          t.dispose();
        }
      });
    }
    mesh.setExtras({ ...mesh.getExtras(), targetNames: keep.map((i) => names[i]) });
    mesh.setWeights(keep.map(() => 0));
  }
}

const BIG = /^(skin|eyes|hair)\b/i; // materiais que aparecem de perto: mais resolução

async function textures(doc: Document, bigPx: number, smallPx: number) {
  doc.createExtension(EXTTextureWebP).setRequired(false);
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const mats = doc.getRoot().listMaterials().filter((m) => [m.getBaseColorTexture(), m.getNormalTexture(), m.getMetallicRoughnessTexture(), m.getEmissiveTexture(), m.getOcclusionTexture()].includes(tex));
    const px = mats.some((m) => BIG.test(m.getName())) ? bigPx : smallPx;
    const out = await sharp(Buffer.from(img)).resize(px, px, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, alphaQuality: 90 }).toBuffer();
    tex.setImage(new Uint8Array(out)).setMimeType('image/webp');
    const uri = tex.getURI();
    if (uri) tex.setURI(uri.replace(/\.(png|jpe?g)$/i, '.webp'));
  }
}

export interface GlbStats { tris: number; morphs: number; joints: string[]; height: number }

export function stats(doc: Document): GlbStats {
  let tris = 0;
  let morphs = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      tris += (p.getIndices()?.getCount() ?? 0) / 3;
      morphs = Math.max(morphs, p.listTargets().length);
      const pos = p.getAttribute('POSITION');
      if (pos) for (let i = 0; i < pos.getCount(); i++) {
        const y = pos.getElement(i, [] as number[])[1];
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const joints = doc.getRoot().listSkins()[0]?.listJoints().map((j) => j.getName()) ?? [];
  return { tris: Math.round(tris), morphs, joints, height: +(maxY - minY).toFixed(3) };
}

export const newIO = () => new NodeIO().registerExtensions(ALL_EXTENSIONS);

export interface Optimized { bytes: Uint8Array; stats: GlbStats }

/** GLB do detalhe médio → LOD0 leve. Confere o esqueleto (nomes Mixamo) e os morphs. */
export async function optimizeLod0(io: NodeIO, glb: Uint8Array): Promise<Optimized> {
  const doc = await io.readBinary(glb);
  trimMorphs(doc);
  await textures(doc, 1024, 256);
  await doc.transform(dedup(), prune());
  const s = stats(doc);
  if (s.joints[0] !== 'Hips' || !s.joints.includes('LeftHandIndex1') || s.morphs !== KEEP_MORPHS.length) throw new Error(`esqueleto ou morphs inesperados (${s.joints[0]}, ${s.morphs} morphs)`);
  return { bytes: await io.writeBinary(doc), stats: s };
}

/** GLB do detalhe baixo → LOD1 (distante): simplificado, sem morphs e só com a textura de cor. */
export async function optimizeLod1(io: NodeIO, glb: Uint8Array): Promise<Optimized> {
  await MeshoptSimplifier.ready;
  const doc = await io.readBinary(glb);
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) for (const t of p.listTargets()) { p.removeTarget(t); t.dispose(); }
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.28, error: 0.006, lockBorder: true }));
  for (const m of doc.getRoot().listMaterials()) m.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null);
  await textures(doc, 512, 128);
  await doc.transform(dedup(), prune());
  return { bytes: await io.writeBinary(doc), stats: stats(doc) };
}
