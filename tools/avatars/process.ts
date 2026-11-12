/**
 * Pós-processa os GLB brutos dos avatares (saída do Blender) para distribuição web:
 *  - texturas em WebP (pele/olhos 1024 px; roupas, cabelos e acessórios 512 px);
 *  - material "tint" (parte principal da peça): textura em tons de cinza com brilho normalizado, para receber a cor
 *    escolhida pelo usuário (multiplicação no material);
 *  - dedup/prune; confere esqueleto, morphs e o atributo de máscara de pele do corpo;
 *  - grava public/assets/avatars/<base>/<id>.glb, as texturas de tom de pele e o manifesto com origem e licença.
 * Uso: npx tsx tools/avatars/process.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO, type Document, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import sharp from 'sharp';
import { AVATAR_CATALOG, type AvatarBase } from '../../shared/avatarCatalog';
import { writeAvatarCredits } from './credits';

const ROOT = path.resolve(import.meta.dirname, '../..');
const RAW = path.join(ROOT, '.build-tools/avatars-raw');
const OUT = path.join(ROOT, 'public/assets/avatars');

interface RawItem { id: string; slot: string; base: string; source: string; file: string; lod1: string | null; trisOriginal: number; tris: number; tint: boolean; hideBit: number | null; attach?: string; meta: Record<string, string> }
interface RawBase { base: string; headTop: number; bodyVerts: number; bodyTris: number; bones: string[]; shapeKeys: string[]; body: string; bodyLod1: string; items: RawItem[]; skins: Array<{ id: string; file: string; source: string; meta: Record<string, string> }>; parts: Record<string, { source: string; meta: Record<string, string> }>; skinDefault: string; skinDefaultMeta: Record<string, string> }

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Materiais que usam a textura (para decidir tamanho e tingimento). */
function materialsOf(doc: Document, tex: Texture): string[] {
  return doc.getRoot().listMaterials().filter((m) => [m.getBaseColorTexture(), m.getNormalTexture(), m.getMetallicRoughnessTexture(), m.getEmissiveTexture(), m.getOcclusionTexture()].includes(tex)).map((m) => m.getName());
}

async function processTextures(doc: Document) {
  const webp = doc.createExtension(EXTTextureWebP).setRequired(false);
  void webp;
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const mats = materialsOf(doc, tex);
    const isTintBase = doc.getRoot().listMaterials().some((m) => /^tint(.|$)/.test(m.getName()) && m.getBaseColorTexture() === tex); // o Blender numera cópias (tint.020)
    const big = mats.some((n) => /skin|eye/i.test(n));
    const max = big ? 1024 : 512;
    let pipe = sharp(Buffer.from(img)).resize(max, max, { fit: 'inside', withoutEnlargement: true });
    if (isTintBase) {
      // tons de cinza + brilho normalizado: a cor escolhida multiplica a textura sem escurecer demais
      const { data, info } = await sharp(Buffer.from(img)).resize(max, max, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let sum = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        n++;
      }
      const mean = n ? sum / n : 128;
      const gain = Math.min(3, 215 / Math.max(20, mean));
      for (let i = 0; i < data.length; i += 4) {
        const l = Math.min(255, (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * gain);
        data[i] = data[i + 1] = data[i + 2] = l;
      }
      pipe = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
    }
    const out = await pipe.webp({ quality: big ? 85 : 80, alphaQuality: 90 }).toBuffer();
    tex.setImage(new Uint8Array(out)).setMimeType('image/webp');
    const uri = tex.getURI();
    if (uri) tex.setURI(uri.replace(/\.(png|jpe?g)$/i, '.webp'));
  }
}

function summarize(doc: Document) {
  let tris = 0;
  const attrs = new Set<string>();
  let morphs = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    morphs = Math.max(morphs, mesh.listPrimitives()[0]?.listTargets().length ?? 0);
    for (const p of mesh.listPrimitives()) {
      tris += (p.getIndices()?.getCount() ?? 0) / 3;
      for (const s of p.listSemantics()) attrs.add(s);
    }
  }
  const joints = doc.getRoot().listSkins()[0]?.listJoints().map((j) => j.getName()) ?? [];
  return { tris: Math.round(tris), attributes: [...attrs].sort(), morphTargets: morphs, joints: joints.length };
}

async function main() {
  const build = JSON.parse(readFileSync(path.join(RAW, 'build.json'), 'utf8')) as { bits: Record<string, number>; bases: Record<string, RawBase>; faces: unknown[]; visemes: string[]; skins: unknown[] };
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const files: Record<string, { bytes: number; sha256: string; tris: number; attributes: string[]; morphTargets: number; joints: number }> = {};
  let total = 0;
  const one = async (rel: string) => {
    const doc = await io.read(path.join(RAW, rel));
    await processTextures(doc);
    await doc.transform(dedup(), prune());
    const bytes = await io.writeBinary(doc);
    const dst = path.join(OUT, rel);
    mkdirSync(path.dirname(dst), { recursive: true });
    writeFileSync(dst, bytes);
    files[rel] = { bytes: bytes.byteLength, sha256: sha(bytes), ...summarize(doc) };
    total += bytes.byteLength;
  };
  for (const b of Object.values(build.bases)) {
    // só o que está no catálogo é distribuído (peças fora da curadoria — ex.: estampa com logotipo — não vão para public/)
    const skipped = b.items.filter((it) => !AVATAR_CATALOG.some((c) => c.id === it.id && c.bases.includes(b.base as AvatarBase)));
    b.items = b.items.filter((it) => !skipped.includes(it));
    if (skipped.length) console.log(`${b.base}: fora do catálogo, não distribuídos: ${skipped.map((s) => s.id).join(', ')}`);
    await one(b.body);
    await one(b.bodyLod1);
    for (const it of b.items) {
      await one(it.file);
      if (it.lod1) await one(it.lod1);
    }
    for (const s of b.skins) {
      const dst = path.join(OUT, 'skins', b.base, `${s.id}.webp`);
      mkdirSync(path.dirname(dst), { recursive: true });
      const out = await sharp(path.join(RAW, s.file)).resize(1024, 1024, { fit: 'inside' }).webp({ quality: 85 }).toBuffer();
      writeFileSync(dst, out);
      total += out.length;
      files[`skins/${b.base}/${s.id}.webp`] = { bytes: out.length, sha256: sha(out), tris: 0, attributes: [], morphTargets: 0, joints: 0 };
    }
    const body = files[b.body];
    if (!body.attributes.some((a) => /hidea/i.test(a))) throw new Error(`${b.base}: o corpo não tem o atributo de máscara de pele (_hidea)`);
    if (body.morphTargets < 6) throw new Error(`${b.base}: morph targets ausentes (${body.morphTargets})`);
    console.log(`${b.base}: corpo ${body.tris} tri, ${body.joints} ossos, ${body.morphTargets} morphs, atributos ${body.attributes.join(' ')} — ${(body.bytes / 1024).toFixed(0)} KB`);
  }
  const manifest = { schema: 1, generatedAt: new Date().toISOString(), units: 'm', upAxis: 'Y', front: '+Z', rig: 'game_engine (MPFB2)', bits: build.bits, faces: build.faces, visemes: build.visemes, bases: build.bases, files };
  writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  writeAvatarCredits();
  console.log(`${Object.keys(files).length} arquivos, ${(total / 1048576).toFixed(1)} MB em public/assets/avatars`);
}

await main();
