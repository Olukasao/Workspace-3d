/**
 * Baixa os originais dos assets curados (tools/assets/sources.json) pelos canais oficiais e grava a proveniência
 * em assets-src/provenance.json: título, autor e licença LIDOS DA PÁGINA de cada modelo, URL, data de consulta e hash do original.
 * Os originais ficam em assets-src/originals/ (fora do git e do public/).
 * Uso: npm run assets:fetch
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ORIG = path.join(ROOT, 'assets-src/originals');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) asset-curation-script';
const today = new Date().toISOString().slice(0, 10);

interface Provenance {
  slug: string;
  sourceType: string;
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  downloadUrl: string;
  originalFile: string;
  originalFormat: string;
  originalSha256: string;
  originalBytes: number;
  consultedAt: string;
  extra?: Record<string, unknown>;
}

const LICENSE_URLS: Record<string, string> = {
  'CC0 1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC-BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
};

async function get(url: string): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 2) throw new Error(`Falha ao baixar ${url}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function save(rel: string, data: Buffer): string {
  const file = path.join(ORIG, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  return file;
}

/** Lê um campo string do estado embutido na página do Poly Pizza (window.__SERVER_APP_STATE__). */
function field(html: string, key: string): string | null {
  const m = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`).exec(html);
  return m ? (JSON.parse(`"${m[1]}"`) as string) : null;
}

async function polypizza(slug: string, id: string): Promise<Provenance> {
  const pageUrl = `https://poly.pizza/m/${id}`;
  const html = (await get(pageUrl)).toString('utf8');
  const start = html.indexOf('"model":{');
  const model = start >= 0 ? html.slice(start, html.indexOf('"suggested"', start) > 0 ? html.indexOf('"suggested"', start) : undefined) : html;
  const title = field(model, 'Title');
  const license = field(model, 'Licence');
  const resource = field(model, 'ResourceID');
  const publicId = field(model, 'PublicID');
  const creator = /"Creator":\{"Username":"((?:[^"\\]|\\.)*)"/.exec(model);
  if (!title || !license || !resource || !creator) throw new Error(`Página ${pageUrl}: metadados não encontrados.`);
  if (publicId !== id) throw new Error(`Página ${pageUrl}: identificador diferente do esperado (${publicId}).`);
  if (!LICENSE_URLS[license]) throw new Error(`Página ${pageUrl}: licença não prevista "${license}". Revise antes de usar.`);
  const downloadUrl = `https://static.poly.pizza/${resource}.glb`;
  const rel = `polypizza/${slug}.glb`;
  const data = existsSync(path.join(ORIG, rel)) ? readFileSync(path.join(ORIG, rel)) : await get(downloadUrl);
  save(rel, data);
  const tris = /"Tris":(\d+)/.exec(model);
  return {
    slug, sourceType: 'polypizza', title, author: JSON.parse(`"${creator[1]}"`) as string, license, licenseUrl: LICENSE_URLS[license],
    sourceUrl: pageUrl, downloadUrl, originalFile: rel, originalFormat: 'glb', originalSha256: sha(data), originalBytes: data.length, consultedAt: today,
    extra: { triangles: tris ? Number(tris[1]) : null, uploadedAs: field(model, 'Type') },
  };
}

let kenneyZip: { file: string; sha256: string; license: string } | null = null;
async function kenney(slug: string, name: string): Promise<Provenance> {
  const zipUrl = 'https://opengameart.org/sites/default/files/kenney_furniturePack.zip';
  const zipPath = path.join(ORIG, 'kenney/kenney_furniturePack.zip');
  if (!kenneyZip) {
    if (!existsSync(zipPath)) save('kenney/kenney_furniturePack.zip', await get(zipUrl));
    const licenseTxt = execFileSync('unzip', ['-p', zipPath, 'License.txt']).toString('utf8');
    if (!/Creative Commons Zero, CC0/.test(licenseTxt)) throw new Error('Kenney: License.txt não confirma CC0.');
    writeFileSync(path.join(ORIG, 'kenney/License.txt'), licenseTxt);
    kenneyZip = { file: zipPath, sha256: sha(readFileSync(zipPath)), license: licenseTxt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 4).join(' · ') };
  }
  // só os arquivos do subconjunto usado são extraídos (OBJ + MTL)
  const out: Buffer[] = [];
  for (const ext of ['obj', 'mtl']) {
    const data = execFileSync('unzip', ['-p', zipPath, `Models/${name}.${ext}`], { maxBuffer: 64 * 1024 * 1024 });
    if (!data.length) throw new Error(`Kenney: Models/${name}.${ext} não existe no pacote.`);
    save(`kenney/${name}.${ext}`, data);
    out.push(data);
  }
  return {
    slug, sourceType: 'kenney', title: name, author: 'Kenney (www.kenney.nl)', license: 'CC0 1.0', licenseUrl: LICENSE_URLS['CC0 1.0'],
    sourceUrl: 'https://opengameart.org/content/furniture-kit', downloadUrl: zipUrl, originalFile: `kenney/${name}.obj`, originalFormat: 'obj+mtl',
    originalSha256: sha(out[0]), originalBytes: out[0].length + out[1].length, consultedAt: today,
    extra: { pack: 'Furniture Pack (1.0)', packSha256: kenneyZip.sha256, packLicenseText: kenneyZip.license, fileInPack: `Models/${name}.obj` },
  };
}

async function polyhaven(slug: string, id: string, author: string): Promise<Provenance> {
  const info = JSON.parse((await get(`https://api.polyhaven.com/info/${id}`)).toString('utf8')) as { name: string; authors?: Record<string, string> };
  const files = JSON.parse((await get(`https://api.polyhaven.com/files/${id}`)).toString('utf8')) as { gltf: Record<string, { gltf: { url: string; include: Record<string, { url: string }> } }> };
  const pack = files.gltf['1k'].gltf;
  const main = await get(pack.url);
  save(`polyhaven/${id}/${id}.gltf`, main);
  let bytes = main.length;
  for (const [rel, f] of Object.entries(pack.include)) {
    const data = await get(f.url);
    save(`polyhaven/${id}/${rel}`, data);
    bytes += data.length;
  }
  const authors = Object.keys(info.authors ?? {});
  return {
    slug, sourceType: 'polyhaven', title: info.name, author: authors.length ? authors.join(', ') : author, license: 'CC0 1.0', licenseUrl: 'https://polyhaven.com/license',
    sourceUrl: `https://polyhaven.com/a/${id}`, downloadUrl: pack.url, originalFile: `polyhaven/${id}/${id}.gltf`, originalFormat: 'gltf+bin+jpg (1k)',
    originalSha256: sha(main), originalBytes: bytes, consultedAt: today,
  };
}

async function ambientcg(slug: string, id: string): Promise<Provenance> {
  const meta = JSON.parse((await get(`https://ambientcg.com/api/v2/full_json?id=${id}&include=downloadData`)).toString('utf8')) as {
    foundAssets: Array<{ assetId: string; displayName: string; downloadFolders: { default: { downloadFiletypeCategories: { zip: { downloads: Array<{ attribute: string; downloadLink: string }> } } } } }>;
  };
  const asset = meta.foundAssets.find((a) => a.assetId === id);
  const dl = asset?.downloadFolders.default.downloadFiletypeCategories.zip.downloads.find((d) => d.attribute === '1K-JPG');
  if (!asset || !dl) throw new Error(`ambientCG: ${id} sem download 1K-JPG.`);
  const zipRel = `ambientcg/${id}_1K-JPG.zip`;
  const zipPath = path.join(ORIG, zipRel);
  const zip = existsSync(zipPath) ? readFileSync(zipPath) : await get(dl.downloadLink);
  save(zipRel, zip);
  const color = execFileSync('unzip', ['-p', zipPath, `${id}_1K-JPG_Color.jpg`], { maxBuffer: 64 * 1024 * 1024 });
  if (!color.length) throw new Error(`ambientCG: mapa de cor de ${id} não encontrado no zip.`);
  save(`ambientcg/${id}_Color.jpg`, color);
  return {
    slug, sourceType: 'ambientcg', title: asset.displayName, author: 'ambientCG (Lennart Demes)', license: 'CC0 1.0', licenseUrl: 'https://docs.ambientcg.com/license/',
    sourceUrl: `https://ambientcg.com/a/${id}`, downloadUrl: dl.downloadLink, originalFile: `ambientcg/${id}_Color.jpg`, originalFormat: 'jpg 1K (mapa de cor extraído do zip PBR)',
    originalSha256: sha(color), originalBytes: color.length, consultedAt: today, extra: { zipSha256: sha(zip), zipBytes: zip.length },
  };
}

interface Entry {
  slug: string;
  source: { type: string; id?: string; file?: string; author?: string };
}

async function main() {
  const sources = JSON.parse(readFileSync(path.join(ROOT, 'tools/assets/sources.json'), 'utf8')) as { models: Entry[]; textures: Entry[] };
  const out: Provenance[] = [];
  const failures: Array<{ slug: string; error: string }> = [];
  for (const e of [...sources.models, ...sources.textures]) {
    try {
      const s = e.source;
      if (s.type === 'polypizza') out.push(await polypizza(e.slug, s.id!));
      else if (s.type === 'kenney') out.push(await kenney(e.slug, s.file!));
      else if (s.type === 'polyhaven') out.push(await polyhaven(e.slug, s.id!, s.author ?? ''));
      else if (s.type === 'ambientcg') out.push(await ambientcg(e.slug, s.id!));
      else continue; // procedural: gerado por build-procedural
      const p = out[out.length - 1];
      console.log(`ok  ${e.slug.padEnd(24)} ${p.license.padEnd(10)} ${p.author} — "${p.title}" (${(p.originalBytes / 1024).toFixed(0)} KB)`);
    } catch (err) {
      failures.push({ slug: e.slug, error: (err as Error).message });
      console.error(`ERRO ${e.slug}: ${(err as Error).message}`);
    }
  }
  mkdirSync(path.join(ROOT, 'assets-src'), { recursive: true });
  writeFileSync(path.join(ROOT, 'assets-src/provenance.json'), JSON.stringify({ generatedAt: new Date().toISOString(), items: out, failures }, null, 2));
  console.log(`\n${out.length} originais registrados, ${failures.length} falhas. Proveniência em assets-src/provenance.json`);
  if (failures.length) process.exitCode = 1;
}

await main();
