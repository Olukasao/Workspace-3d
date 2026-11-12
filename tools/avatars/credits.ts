/**
 * Gera public/assets/avatars/CREDITS.md a partir do manifesto dos avatares: origem, autor, licença e alterações
 * de cada arquivo distribuído. Chamado ao fim de tools/avatars/process.ts (ou: npx tsx tools/avatars/credits.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'public/assets/avatars');

type Meta = Record<string, string>;
interface Item { id: string; slot: string; source: string; file: string; lod1: string | null; trisOriginal: number; tris: number; tint: boolean; meta: Meta }
interface Base { base: string; body: string; bodyLod1: string; items: Item[]; skins: Array<{ id: string; source: string; meta: Meta }>; parts: Record<string, { source: string; meta: Meta }> }

// endereços de onde os pacotes foram baixados (hashes em .build-tools/packs.sha256)
const PACK_URL: Record<string, string> = Object.fromEntries(
  ['makehuman_system_assets', 'suits01', 'glasses01', 'bodyparts05'].map((p) => [p, `https://files.makehumancommunity.org/asset_packs/${p}/${p}_cc0.zip`]),
);
PACK_URL.visemes01 = 'https://files.makehumancommunity.org/functional/visemes01.zip';
const BASE_PT: Record<string, string> = { male: 'masculino', female: 'feminino' };
const lic = (l: string) => (/^cc0/i.test(l) ? 'CC0 1.0' : l);
const pack = (m: Meta) => (PACK_URL[m.pack] ? `[${m.pack}](${PACK_URL[m.pack]})` : m.pack || '—');
const author = (m: Meta) => [m.author, m.original_author && m.original_author !== m.author ? `original: ${m.original_author}` : ''].filter(Boolean).join(' · ') || '—';

export function writeAvatarCredits() {
  const m = JSON.parse(readFileSync(path.join(OUT, 'manifest.json'), 'utf8')) as { generatedAt: string; bases: Record<string, Base>; files: Record<string, { bytes: number }> };
  const rows: string[] = [];
  const authors = new Map<string, Set<string>>();
  const note = (meta: Meta, what: string) => {
    const k = `${meta.author || '—'}|${lic(meta.license || '—')}|${meta.pack || '—'}`;
    if (!authors.has(k)) authors.set(k, new Set());
    authors.get(k)!.add(what);
  };
  for (const b of Object.values(m.bases)) {
    const bodyChanges = 'corpo MakeHuman gerado pelo MPFB2 (macro de gênero, proporções médias); rig game_engine; olhos, sobrancelhas, cílios e dentes do pacote do sistema; alvos de rosto e visemas incorporados como morph targets; atributo de máscara de pele; texturas em WebP; LOD1 com ~1/3 dos triângulos';
    const sys = b.parts.eyes?.meta ?? { author: 'makehuman_system', license: 'CC0', pack: 'makehuman_system_assets' };
    rows.push(`| ${b.body} · ${b.bodyLod1} | Corpo ${BASE_PT[b.base]} (com olhos, sobrancelhas, cílios e dentes) | MakeHuman base mesh + ${Object.values(b.parts).map((p) => p.source).join(', ')} | ${author(sys)} | ${lic(sys.license)} | ${pack(sys)} | ${bodyChanges} |`);
    note(sys, `corpo ${BASE_PT[b.base]}`);
    for (const s of b.skins) {
      rows.push(`| skins/${b.base}/${s.id}.webp | Tom de pele ${s.id} (${BASE_PT[b.base]}) | ${s.source} | ${author(s.meta)} | ${lic(s.meta.license)} | ${pack(s.meta)} | redimensionada para 1024 px, WebP |`);
      note(s.meta, `pele ${s.source}`);
    }
    for (const it of b.items) {
      const changes = [
        it.meta.pack === 'office3d' ? 'modelado proceduralmente no build (geometria original do projeto), preso ao osso da cabeça' : 'ajustado ao corpo pelo MPFB2 e religado ao rig game_engine',
        it.trisOriginal !== it.tris ? `reduzido de ${it.trisOriginal} para ${it.tris} triângulos` : '',
        it.tint ? 'parte principal em tons de cinza para receber a cor escolhida' : '',
        it.lod1 ? 'LOD1' : '',
        'texturas em WebP (512 px)',
      ].filter(Boolean).join('; ');
      rows.push(`| ${it.file}${it.lod1 ? ` · ${it.lod1}` : ''} | ${it.id} (${BASE_PT[b.base]}) | ${it.source} | ${author(it.meta)} | ${lic(it.meta.license || '—')} | ${pack(it.meta)} | ${changes} |`);
      note(it.meta, it.source);
    }
  }
  const md = `# Créditos e licenças dos avatares

Gerado por \`tools/avatars/credits.ts\` a partir de \`public/assets/avatars/manifest.json\` (${m.generatedAt}). Este arquivo acompanha a distribuição do produto.

- **MakeHuman** (malha base, roupas, cabelos, sapatos, peles, olhos, alvos de rosto) — https://www.makehumancommunity.org. Os pacotes de recursos usados são **CC0 1.0** (domínio público): https://creativecommons.org/publicdomain/zero/1.0/. Os modelos exportados do MakeHuman 1.1+ / MPFB2 são CC0 independentemente da licença da ferramenta.
- **MPFB2** (plugin do Blender que gerou os modelos) é GPL-3.0 e **não é distribuído**: foi usado só na construção (\`tools/avatars/build.py\`).
- **Visemas** (formas de boca): pacote \`visemes01\` da comunidade MakeHuman, CC0 1.0.
- **Headset**: geometria original do projeto, gerada no build.
- Itens CC0 não exigem atribuição; ficam registrados por transparência.

## Autores por pacote

| Autor | Licença | Pacote | Itens |
|---|---|---|---|
${[...authors].map(([k, v]) => { const [a, l, p] = k.split('|'); return `| ${a} | ${l} | ${PACK_URL[p] ? `[${p}](${PACK_URL[p]})` : p} | ${[...v].join(', ')} |`; }).join('\n')}

## Arquivos distribuídos

| Arquivo | No produto | Original | Autor | Licença | Pacote | Alterações |
|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
  writeFileSync(path.join(OUT, 'CREDITS.md'), md);
  return rows.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) console.log(`CREDITS.md: ${writeAvatarCredits()} linhas`);
