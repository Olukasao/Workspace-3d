/**
 * Monta public/assets/lpc a partir do Universal LPC Spritesheet Character Generator.
 * Só entram peças cuja licença permite o uso com atribuição (CC0, OGA-BY 3.0, CC-BY 3.0/4.0): nada que exija compartilhar igual (CC-BY-SA, GPL).
 * Uso: git clone --depth 1 https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator.git <pasta>
 *      LPC_REPO=<pasta> node tools/lpc/build.mjs
 * Baixa só as animações usadas (andar, parado, sentado) das peças curadas abaixo, para o commit fixado em COMMIT.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.LPC_REPO;
if (!REPO) throw new Error('Defina LPC_REPO com a pasta do clone do gerador.');
const COMMIT = '04140673ec02906f8233523639733c83690df750';
const RAW = `https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/${COMMIT}/spritesheets/`;
const OUT = path.resolve('public/assets/lpc');
const ANIMS = ['walk', 'idle', 'sit'];
const PERMISSIVE = new Set(['CC0', 'CC0 1.0', 'OGA-BY 3.0', 'CC-BY 3.0', 'CC-BY 4.0']);
const BODIES = ['male', 'female'];

// peças curadas (nome do arquivo em sheet_definitions, sem .json)
const CURATED = {
  hair: ['hair_afro', 'hair_cornrows', 'hair_dreadlocks_short', 'hair_dreadlocks_long', 'hair_flat_top_fade', 'hair_flat_top_straight', 'hair_natural', 'hair_twists_fade', 'hair_twists_straight', 'hair_balding', 'hair_buzzcut', 'hair_bob', 'hair_bob_side_part', 'hair_lob', 'hair_bangs_bun', 'hair_braid', 'hair_half_up', 'hair_high_ponytail', 'hair_long_tied', 'hair_ponytail2', 'hair_shoulderl', 'hair_shoulderr', 'hair_curly_long', 'hair_curly_short', 'hair_curly_short2', 'hair_curtains_long', 'hair_long_center_part', 'hair_long_messy', 'hair_long_straight', 'hair_wavy', 'hair_cowlick', 'hair_curtains', 'hair_idol', 'hair_page', 'hair_page2', 'hair_parted3', 'hair_plain', 'hair_single', 'hair_halfmessy', 'hair_spiked', 'hair_princess', 'hair_sara', 'hair_xlong', 'hair_xlong_wavy'],
  torso: ['torso_clothes_longsleeve2', 'torso_clothes_longsleeve2_buttoned', 'torso_clothes_longsleeve2_cardigan', 'torso_clothes_longsleeve2_polo', 'torso_clothes_longsleeve2_scoop', 'torso_clothes_longsleeve2_vneck', 'torso_clothes_longsleeve_scoop', 'torso_clothes_shortsleeve', 'torso_clothes_shortsleeve_cardigan', 'torso_clothes_shortsleeve_polo', 'torso_clothes_tshirt', 'torso_clothes_tshirt_buttoned', 'torso_clothes_tshirt_scoop', 'torso_clothes_tshirt_vneck', 'torso_clothes_sleeveless1', 'torso_clothes_sleeveless2', 'torso_clothes_sleeveless2_buttoned', 'torso_clothes_sleeveless2_cardigan', 'torso_clothes_sleeveless2_polo', 'torso_clothes_sleeveless2_scoop', 'torso_clothes_sleeveless2_vneck'],
  legs: ['legs_pants', 'legs_pants2', 'legs_cuffed', 'legs_formal', 'legs_formal_striped', 'legs_shorts', 'legs_shorts_short', 'legs_leggings', 'legs_leggings2', 'legs_skirts_plain'],
  shoes: ['feet_boots_basic', 'feet_boots_revised', 'feet_shoes_basic', 'feet_shoes_revised', 'feet_sandals', 'feet_shoes_sara'],
  beard: ['beards_medium', 'beards_trimmed', 'beards_winter', 'beards_chevron', 'beards_handlebar', 'beards_horseshoe', 'beards_lampshade', 'beards_walrus'],
  glasses: ['facial_glasses', 'facial_glasses_halfmoon'],
};
const RECOLOR_FALLBACK = { hair: 'hair', beard: 'hair', torso: 'cloth', legs: 'cloth', shoes: 'cloth', glasses: null };

const defs = new Map();
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.json') && !e.name.startsWith('meta')) {
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (j && j.layer_1) defs.set(e.name.slice(0, -5), j);
      } catch { /* ignora */ }
    }
  }
};
walk(path.join(REPO, 'sheet_definitions'));

const files = new Set(); // caminhos relativos a spritesheets/ a baixar
const credits = new Map(); // chave do crédito → { authors, licenses, urls, files:Set }
const addCredit = (c, label) => {
  const k = JSON.stringify([c.authors, c.licenses]);
  const e = credits.get(k) ?? { authors: c.authors, licenses: c.licenses, urls: new Set(), items: new Set() };
  for (const u of c.urls ?? []) e.urls.add(u);
  e.items.add(label);
  credits.set(k, e);
};
const permissive = (c) => (c.licenses ?? []).some((l) => PERMISSIVE.has(l));

function layersOf(def) {
  const out = [];
  for (let i = 1; def[`layer_${i}`]; i++) out.push(def[`layer_${i}`]);
  return out;
}
function fileList(dir, variant) {
  return ANIMS.map((a) => (variant ? `${dir}${a}/${variant}.png` : `${dir}${a}.png`));
}

const manifest = { version: 1, commit: COMMIT, bodies: {}, parts: {}, palettes: {} };

// corpo e cabeça (um por tipo de corpo)
for (const b of BODIES) {
  const bodyDir = `body/bodies/${b}/`;
  const headDir = `head/heads/human/${b === 'male' ? 'male' : 'female'}/`;
  manifest.bodies[b] = { body: bodyDir, head: headDir };
  for (const d of [bodyDir, headDir]) for (const f of fileList(d)) files.add(f);
}
for (const k of ['body/bodies/male', 'body/bodies/female']) {
  const def = defs.get('body');
  const c = def?.credits?.find((x) => x.file === k);
  if (c && permissive(c)) addCredit(c, k);
  else throw new Error(`Crédito do corpo ${k} não é permissivo ou não foi encontrado.`);
}
for (const h of ['heads_human_male', 'heads_human_female']) {
  const def = defs.get(h);
  if (!def) throw new Error(`Falta ${h}`);
  for (const c of def.credits ?? []) addCredit(c, h);
  if (!(def.credits ?? []).every(permissive)) throw new Error(`${h} não é permissivo`);
}

let skipped = 0;
for (const [cat, ids] of Object.entries(CURATED)) {
  manifest.parts[cat] = [];
  for (const id of ids) {
    const def = defs.get(id);
    if (!def) { console.warn('sem definição:', id); skipped++; continue; }
    const credits_ = def.credits ?? [];
    if (!credits_.length || !credits_.every(permissive)) { console.warn('licença não permissiva, fora:', id); skipped++; continue; }
    if (!ANIMS.every((a) => (def.animations ?? []).includes(a))) { console.warn('sem as animações usadas:', id); skipped++; continue; }
    const ls = layersOf(def);
    if (!ls.every((l) => BODIES.every((b) => typeof l[b] === 'string'))) { console.warn('sem os dois tipos de corpo:', id); skipped++; continue; }
    const variant = Array.isArray(def.variants) ? (cat === 'glasses' ? 'black' : def.variants[0]) : null;
    const recolor = def.recolors ? (def.recolors.material ?? def.recolors.color_1?.material ?? null) : RECOLOR_FALLBACK[cat];
    const layers = ls.map((l) => ({ z: l.zPos, male: l.male, female: l.female }));
    const lines = layers.flatMap((l) => BODIES.flatMap((b) => fileList(l[b], variant)));
    manifest.parts[cat].push({ id, name: def.name, layers, recolor: variant ? null : recolor, variant });
    for (const f of lines) files.add(f);
    for (const c of credits_) addCredit(c, id);
  }
}

// paletas usadas (corpo, cabelo, tecido, olhos) e a cor de origem de cada uma
const BASE = { body: 'light', hair: 'orange', cloth: 'white', eye: 'blue' };
for (const [mat, base] of Object.entries(BASE)) {
  const j = JSON.parse(fs.readFileSync(path.join(REPO, 'palette_definitions', mat, `${mat}_ulpc.json`), 'utf8'));
  manifest.palettes[mat] = { base, colors: j };
}

// baixa as imagens (8 em paralelo)
const list = [...files];
let done = 0;
let bad = 0;
async function get(rel) {
  const dest = path.join(OUT, 'spritesheets', rel);
  if (fs.existsSync(dest)) return true;
  const r = await fetch(RAW + rel.split('/').map(encodeURIComponent).join('/'));
  if (!r.ok) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return true;
}
const missing = [];
async function worker() {
  while (list.length) {
    const rel = list.pop();
    let ok = false;
    for (let t = 0; t < 3 && !ok; t++) ok = await get(rel).catch(() => false);
    if (!ok) { bad++; missing.push(rel); }
    if (++done % 100 === 0) console.log(`  ${done}/${files.size}`);
  }
}
fs.mkdirSync(OUT, { recursive: true });
await Promise.all(Array.from({ length: 8 }, worker));

// peças com arquivo faltando saem do catálogo
const miss = new Set(missing);
for (const cat of Object.keys(manifest.parts)) {
  manifest.parts[cat] = manifest.parts[cat].filter((p) => {
    const lines = p.layers.flatMap((l) => BODIES.flatMap((b) => fileList(l[b], p.variant)));
    const ok = lines.every((f) => !miss.has(f));
    if (!ok) console.warn('arquivo faltando, peça removida:', p.id);
    return ok;
  });
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));

// créditos
const rows = [...credits.values()].map((c) => ({ authors: c.authors, licenses: c.licenses, urls: [...c.urls], items: [...c.items].sort() }));
fs.writeFileSync(path.join(OUT, 'credits.json'), JSON.stringify(rows));
const md = [
  '# Universal LPC Spritesheet Character Generator: créditos',
  '',
  `Peças do repositório https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator (commit ${COMMIT}), do projeto Liberated Pixel Cup e de seus colaboradores.`,
  'Cada peça aqui incluída lista entre suas licenças ao menos uma que exige só atribuição (CC0, OGA-BY 3.0, CC-BY 3.0 ou 4.0); é sob essa opção que o produto as usa. Nenhuma peça é usada sob CC-BY-SA ou GPL.',
  'Licenças: OGA-BY 3.0 https://opengameart.org/content/oga-by-30-faq · CC-BY 3.0 https://creativecommons.org/licenses/by/3.0/ · CC0 https://creativecommons.org/publicdomain/zero/1.0/',
  'Arquivos: public/assets/lpc/spritesheets (apenas andar, parado e sentado). As cores vêm de paletas aplicadas em tempo de execução. Lista completa por autor abaixo.',
  '',
  ...rows.flatMap((c) => [`## ${c.authors.join(', ')}`, `- Licenças oferecidas: ${c.licenses.join(', ')}`, `- Peças: ${c.items.join(', ')}`, ...c.urls.map((u) => `- Fonte: ${u}`), '']),
];
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), md.join('\n'));
console.log(`Pronto: ${files.size} imagens (${bad} faltando), ${Object.values(manifest.parts).reduce((n, a) => n + a.length, 0)} peças, ${skipped} fora; créditos de ${rows.length} grupos.`);

// catálogo para o servidor validar o avatar (shared/avatarLpc.generated.ts)
const q = (a) => JSON.stringify(a);
const parts = Object.fromEntries(Object.entries(manifest.parts).map(([c, a]) => [c, a.map((p) => ({ id: p.id, name: p.name }))]));
const SKINS = ['light', 'amber', 'olive', 'taupe', 'bronze', 'brown', 'black'];
fs.writeFileSync(
  path.resolve('shared/avatarLpc.generated.ts'),
  `// GERADO por tools/lpc/build.mjs (não edite): catálogo do Universal LPC usado pelo avatar 2D.\n` +
    `export const LPC_BODIES = ${q(BODIES)} as const;\n` +
    `export const LPC_SKINS = ${q(SKINS)} as const;\n` +
    `export const LPC_HAIR_COLORS = ${q(Object.keys(manifest.palettes.hair.colors))} as const;\n` +
    `export const LPC_CLOTH_COLORS = ${q(Object.keys(manifest.palettes.cloth.colors))} as const;\n` +
    `export const LPC_EYE_COLORS = ${q(Object.keys(manifest.palettes.eye.colors))} as const;\n` +
    `export const LPC_PARTS: Record<'hair' | 'torso' | 'legs' | 'shoes' | 'beard' | 'glasses', ReadonlyArray<{ id: string; name: string }>> = ${q(parts)};\n`,
);
