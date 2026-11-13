/**
 * Pós-processa os GLB brutos do estilo "Ara 3D Gen" para distribuição web (npm run avatars-ara:process):
 *  - LOD0 (detalhe médio): texturas em WebP (pele, olhos e cabelo 1024 px; roupas 512 px);
 *  - LOD1 (detalhe baixo + simplificação por meshoptimizer, sem morph targets): texturas 256–512 px;
 *  - confere esqueleto (nomes Mixamo) e morphs; grava public/assets/avatars-ara/** + manifest.json (origem e licença) + CREDITS.md.
 * Entrada: .build-tools/ara-raw/<id>.medium.glb e <id>.low.glb (tools/avatars-ara/build.mjs).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
interface GalleryEntry { id: string; name: string; gender: 'male' | 'female'; style: 'corporate' | 'casual'; params: Record<string, unknown> }

const ROOT = path.resolve(import.meta.dirname, '../..');
const RAW = path.join(ROOT, '.build-tools/ara-raw');
const OUT = path.join(ROOT, 'public/assets/avatars-ara');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Morph targets mantidos: 34 alvos estouram o shader no driver de vídeo (ANGLE/D3D11); o rig só usa os visemas e o piscar. */
const KEEP_MORPHS = ['viseme_aa', 'viseme_O', 'viseme_I', 'eyeBlinkLeft', 'eyeBlinkRight'];
function trimMorphs(doc: Document) {
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

function stats(doc: Document) {
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

async function main() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  await MeshoptSimplifier.ready;
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(path.join(OUT, 'lod1'), { recursive: true });
  const araCommit = (() => {
    try {
      return execFileSync('git', ['-C', path.join(ROOT, '.build-tools/ara3d'), 'rev-parse', 'HEAD']).toString().trim();
    } catch {
      return 'desconhecido';
    }
  })();
  const GALLERY = JSON.parse(readFileSync(path.join(RAW, 'gallery.json'), 'utf8')) as GalleryEntry[]; // gerado por build.mjs
  const files: Record<string, { bytes: number; sha256: string; tris: number }> = {};
  const characters = [];
  let total = 0;
  for (const e of GALLERY) {
    // LOD0
    const d0 = await io.read(path.join(RAW, `${e.id}.medium.glb`));
    trimMorphs(d0);
    await textures(d0, 1024, 256);
    await d0.transform(dedup(), prune());
    const s0 = stats(d0);
    if (s0.joints[0] !== 'Hips' || !s0.joints.includes('LeftHandIndex1') || s0.morphs !== KEEP_MORPHS.length) throw new Error(`${e.id}: esqueleto ou morphs inesperados (${s0.joints[0]}, ${s0.morphs} morphs)`);
    const b0 = await io.writeBinary(d0);
    writeFileSync(path.join(OUT, `${e.id}.glb`), b0);
    // LOD1: detalhe baixo, sem morphs, simplificado
    const d1 = await io.read(path.join(RAW, `${e.id}.low.glb`));
    for (const mesh of d1.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) for (const t of p.listTargets()) { p.removeTarget(t); t.dispose(); }
    await d1.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.28, error: 0.006, lockBorder: true }));
    // longe, só a cor importa: sem normal, rugosidade, oclusão nem emissivo (menos texturas na GPU e menos memória)
    for (const m of d1.getRoot().listMaterials()) {
      m.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null);
    }
    await textures(d1, 512, 128);
    await d1.transform(dedup(), prune());
    const s1 = stats(d1);
    const b1 = await io.writeBinary(d1);
    writeFileSync(path.join(OUT, 'lod1', `${e.id}.glb`), b1);
    files[`${e.id}.glb`] = { bytes: b0.byteLength, sha256: sha(b0), tris: s0.tris };
    files[`lod1/${e.id}.glb`] = { bytes: b1.byteLength, sha256: sha(b1), tris: s1.tris };
    total += b0.byteLength + b1.byteLength;
    const p = e.params as Record<string, string | number>;
    characters.push({ id: e.id, name: e.name, gender: e.gender, style: e.style, file: `${e.id}.glb`, lod1: `lod1/${e.id}.glb`, tris: s0.tris, lod1Tris: s1.tris, height: s0.height, params: { outfit: p.outfit, hair: p.hair, shoes: p.shoes, eyes: p.eyes, skin: p.skin, gender: p.gender, age: p.age } });
    console.log(`${e.id}: ${s0.tris} tri (${(b0.byteLength / 1048576).toFixed(1)} MB) · LOD1 ${s1.tris} tri (${(b1.byteLength / 1048576).toFixed(2)} MB) · ${s0.height} m`);
  }
  const manifest = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    units: 'm',
    upAxis: 'Y',
    front: '+Z',
    rig: 'Mixamo (jogo, 65 ossos + rosto)',
    generator: { name: 'Ara 3D Gen', url: 'https://github.com/olatunde85/3d-gen', commit: araCommit, license: 'MIT (código); exportações sem atribuição obrigatória' },
    data: { name: 'MakeHuman system assets', license: 'CC0 1.0', url: 'https://www.makehumancommunity.org' },
    characters,
    files,
  };
  writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  writeFileSync(
    path.join(OUT, 'CREDITS.md'),
    `# Créditos e licenças dos avatares (estilo Ara 3D Gen)

Gerado por \`tools/avatars-ara/process.ts\` (${manifest.generatedAt}). Este arquivo acompanha a distribuição do produto.

- **Gerador:** [Ara 3D Gen](https://github.com/olatunde85/3d-gen) (commit \`${araCommit}\`), código MIT. Os personagens exportados podem ser usados em projetos comerciais e não comerciais sem atribuição. Só o gerador foi usado, na construção: ele não é distribuído com o produto.
- **Dados dos corpos, rostos, cabelos, roupas e sapatos:** MakeHuman, pacote \`makehuman_system_assets\`, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (Data Collection AB, Joel Palmius e Jonas Hauquier). Texturas das peças procedurais geradas pelo Ara 3D Gen.
- **Animação:** procedural, do próprio Office 3D. Nenhum dado de captura de movimento (CMU ou outros) é distribuído.

## Personagens

| Arquivo | Nome no produto | Roupa | Cabelo | Alterações |
|---|---|---|---|---|
${characters.map((c) => `| ${c.file} · ${c.lod1} | ${c.name} | ${c.params.outfit} | ${c.params.hair} | sem animações embutidas; texturas em WebP; LOD1 simplificado (${c.lod1Tris} triângulos, sem morph targets) |`).join('\n')}
`,
  );
  console.log(`${characters.length} personagens, ${(total / 1048576).toFixed(1)} MB em public/assets/avatars-ara`);
}

await main();
