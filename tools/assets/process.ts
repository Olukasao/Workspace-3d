/**
 * Processa os originais em assets distribuíveis:
 *  - normaliza para GLB autocontido, metros, Y para cima, frente em +Z, pivô na base (ou âncora de parede);
 *  - otimiza malha e texturas (WebP ≤ 512 px);
 *  - deduplica pelo hash do arquivo final (o arquivo é gravado uma vez; metadados e licenças NÃO se misturam);
 *  - grava public/assets/manifest.json (um registro por asset) e public/assets/CREDITS.md (avisos de licença).
 * Uso: npm run assets:process
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Document } from '@gltf-transform/core';
import { countTriangles, createIo, maxTextureSide, normalizeDocument, optimizeDocument, sha256 } from '../../server/assets/glb';
import { buildProcedural, objToDocument } from './procedural';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ORIG = path.join(ROOT, 'assets-src/originals');
const OUT = path.join(ROOT, 'public/assets');

interface ModelEntry {
  slug: string;
  name: string;
  category: string;
  kind: string;
  mount: 'floor' | 'wall' | 'surface';
  source: { type: string; id?: string; file?: string; builder?: string };
  fit?: { w?: number; d?: number; h?: number };
  rotY?: number;
  rotX?: number;
  surface?: boolean | number;
  maxTexture?: number;
  maxTriangles?: number;
}
interface TextureEntry {
  slug: string;
  name: string;
  use: string;
  source: { type: string; id: string };
}
interface Prov {
  slug: string;
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  originalFile: string;
  originalFormat: string;
  originalSha256: string;
  consultedAt: string;
  sourceType: string;
}

const VIA: Record<string, string> = { polypizza: 'Poly Pizza', kenney: 'OpenGameArt', polyhaven: 'Poly Haven', ambientcg: 'ambientCG' };

async function main() {
  const sources = JSON.parse(readFileSync(path.join(ROOT, 'tools/assets/sources.json'), 'utf8')) as { models: ModelEntry[]; textures: TextureEntry[]; rejected: unknown[]; pending: unknown[] };
  const provFile = path.join(ROOT, 'assets-src/provenance.json');
  const prov = new Map<string, Prov>((existsSync(provFile) ? (JSON.parse(readFileSync(provFile, 'utf8')) as { items: Prov[] }).items : []).map((p) => [p.slug, p]));
  const io = await createIo();
  mkdirSync(path.join(OUT, 'models'), { recursive: true });
  mkdirSync(path.join(OUT, 'textures'), { recursive: true });
  for (const f of readdirSync(path.join(OUT, 'models'))) rmSync(path.join(OUT, 'models', f));

  const today = new Date().toISOString().slice(0, 10);
  const byHash = new Map<string, string>();
  const models: Record<string, unknown>[] = [];
  let failed = 0;
  for (const e of sources.models) {
    try {
      const p = prov.get(e.slug);
      let doc: Document;
      const changes: string[] = [];
      if (e.source.type === 'procedural') {
        doc = buildProcedural(e.source.builder!);
      } else if (!p) {
        throw new Error('original não baixado (rode npm run assets:fetch)');
      } else if (e.source.type === 'kenney') {
        const base = path.join(ORIG, 'kenney', e.source.file!);
        doc = objToDocument(readFileSync(`${base}.obj`, 'utf8'), readFileSync(`${base}.mtl`, 'utf8'), e.source.file!);
        changes.push('convertido de OBJ+MTL para GLB (cores do MTL, normais planas)');
      } else {
        doc = await io.read(path.join(ORIG, p.originalFile));
        if (e.source.type === 'polyhaven') changes.push('convertido de glTF + arquivos externos para GLB autocontido');
      }
      const trisBefore = countTriangles(doc);
      const texBefore = maxTextureSide(doc);
      const pivot = e.mount === 'wall' ? 'wall-back' : 'base-center';
      const n = normalizeDocument(doc, { fit: e.fit, rotY: e.rotY, rotX: e.rotX, pivot });
      await optimizeDocument(doc, { maxTriangles: e.maxTriangles ?? 12000, maxTexture: e.maxTexture ?? 512 });
      const bytes = await io.writeBinary(doc);
      const hash = sha256(bytes);
      let file = byHash.get(hash);
      if (!file) {
        file = `models/${e.slug}.glb`;
        writeFileSync(path.join(OUT, file), bytes);
        byHash.set(hash, file);
      } else {
        changes.push(`arquivo idêntico a ${file}: reaproveitado (deduplicação por hash)`);
      }
      const tris = countTriangles(doc);
      const tex = maxTextureSide(doc);
      if (e.source.type !== 'procedural') {
        if (Math.abs(n.scale - 1) > 1e-6) changes.push(`escala uniforme ×${n.scale.toPrecision(4)} para metros`);
        if (e.rotY) changes.push(`giro de ${e.rotY}° em Y (frente em +Z)`);
        if (e.rotX) changes.push(`giro de ${e.rotX}° em X`);
        changes.push(pivot === 'wall-back' ? 'pivô movido para o centro da face traseira (âncora de parede)' : 'pivô movido para o centro da base');
        if (tris < trisBefore) changes.push(`malha simplificada de ${trisBefore} para ${tris} triângulos`);
        if (texBefore) changes.push(`texturas convertidas para WebP (maior lado ${texBefore}px → ${tex}px)`);
        changes.push('vértices soldados e dados não usados removidos');
      }
      const surfaceHeight = e.surface === true ? n.height : typeof e.surface === 'number' ? e.surface : null;
      const procedural = e.source.type === 'procedural';
      const title = procedural ? e.name : p!.title;
      const author = procedural ? 'Office 3D (geometria original)' : p!.author;
      const license = procedural ? 'Original do projeto' : p!.license;
      const sourceUrl = procedural ? '' : p!.sourceUrl;
      const attribution = procedural
        ? `${e.name} — geometria original do projeto Office 3D (tools/assets/procedural.ts).`
        : `"${title}" por ${author} [${license}] (${p!.licenseUrl}) via ${VIA[p!.sourceType]} (${sourceUrl})${license.startsWith('CC-BY') ? ' — modificado' : ''}.`;
      models.push({
        id: `asset_${e.slug}`, slug: e.slug, name: e.name, category: e.category, kind: e.kind, mount: e.mount, pivot,
        file, url: `/assets/${file}`, thumb: `/assets/thumbs/${e.slug}.webp`, sha256: hash, bytes: bytes.byteLength, triangles: tris, maxTexturePx: tex,
        dimensions: { width: n.width, depth: n.depth, height: n.height }, surfaceHeight,
        origin: procedural ? 'procedural' : 'download', originalTitle: title, author, license, licenseUrl: procedural ? '' : p!.licenseUrl, sourceUrl, attribution,
        consultedAt: procedural ? today : p!.consultedAt, version: 1,
        original: procedural ? { format: 'gerado por código', builder: e.source.builder } : { file: p!.originalFile, format: p!.originalFormat, sha256: p!.originalSha256 },
        changes,
      });
      console.log(`ok  ${e.slug.padEnd(24)} ${String(tris).padStart(6)} tri  ${(bytes.byteLength / 1024).toFixed(0).padStart(5)} KB  ${n.width}×${n.depth}×${n.height} m`);
    } catch (err) {
      failed++;
      console.error(`ERRO ${e.slug}: ${(err as Error).message}`);
    }
  }

  const textures: Record<string, unknown>[] = [];
  for (const t of sources.textures) {
    const p = prov.get(t.slug);
    if (!p) {
      failed++;
      console.error(`ERRO ${t.slug}: original não baixado`);
      continue;
    }
    const out = await sharp(path.join(ORIG, p.originalFile)).resize(512, 512, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
    const file = `textures/${t.slug}.webp`;
    writeFileSync(path.join(OUT, file), out);
    textures.push({
      id: `tex_${t.slug}`, slug: t.slug, name: t.name, use: t.use, file, url: `/assets/${file}`, sha256: sha256(out), bytes: out.length, sizePx: 512,
      originalTitle: p.title, author: p.author, license: p.license, licenseUrl: p.licenseUrl, sourceUrl: p.sourceUrl,
      attribution: `"${p.title}" por ${p.author} [${p.license}] (${p.licenseUrl}) via ambientCG (${p.sourceUrl}).`, consultedAt: p.consultedAt, version: 1,
      original: { file: p.originalFile, format: p.originalFormat, sha256: p.originalSha256 },
      changes: ['somente o mapa de cor é distribuído', 'reduzido de 1024 para 512 px e convertido para WebP (qualidade 80)'],
    });
    console.log(`ok  ${t.slug.padEnd(24)} textura ${(out.length / 1024).toFixed(0)} KB`);
  }

  const manifest = { schema: 1, generatedAt: new Date().toISOString(), units: 'm', upAxis: 'Y', front: '+Z', models, textures, rejected: sources.rejected, pending: sources.pending };
  writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // avisos de licença que acompanham a distribuição
  const lines = ['# Créditos e licenças dos assets', '', 'Gerado por `npm run assets:process` a partir de `public/assets/manifest.json`. Este arquivo acompanha a distribuição do produto.', '',
    'Licenças: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/ · CC-BY 3.0 — https://creativecommons.org/licenses/by/3.0/', '',
    'Os itens CC-BY exigem atribuição ao autor e indicação de alterações; ambas constam abaixo e na tela "Créditos" do produto. Os itens CC0 não exigem atribuição, mas ficam registrados.', '',
    '## Modelos 3D', '', '| Arquivo | Nome no produto | Original | Autor | Licença | Fonte | Alterações |', '|---|---|---|---|---|---|---|'];
  for (const m of models as Array<Record<string, string> & { changes: string[] }>) lines.push(`| ${m.file} | ${m.name} | ${m.originalTitle} | ${m.author} | ${m.license} | ${m.sourceUrl || '—'} | ${m.changes.join('; ') || '—'} |`);
  lines.push('', '## Texturas', '', '| Arquivo | Nome | Original | Autor | Licença | Fonte | Alterações |', '|---|---|---|---|---|---|---|');
  for (const t of textures as Array<Record<string, string> & { changes: string[] }>) lines.push(`| ${t.file} | ${t.name} | ${t.originalTitle} | ${t.author} | ${t.license} | ${t.sourceUrl} | ${t.changes.join('; ')} |`);
  writeFileSync(path.join(OUT, 'CREDITS.md'), lines.join('\n') + '\n');

  const total = models.reduce((s, m) => s + (m.bytes as number), 0) + textures.reduce((s, t) => s + (t.bytes as number), 0);
  console.log(`\n${models.length} modelos (${byHash.size} arquivos únicos) e ${textures.length} texturas — ${(total / 1048576).toFixed(2)} MB no total. ${failed} falhas.`);
  if (failed) process.exitCode = 1;
}

await main();
