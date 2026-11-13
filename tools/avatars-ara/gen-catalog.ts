/**
 * Gera shared/araCatalog.generated.ts a partir dos dados do Ara (public/assets/ara-data/catalog.json) e da galeria
 * (.build-tools/ara-raw/gallery.json): controles de corpo, opções de olhos, cabelo, pele etc. e os 16 personagens prontos.
 * O arquivo gerado é versionado: cliente e servidor o compartilham (validação e editor).
 * Uso: npm run avatars-ara:catalog  (depois de avatars-ara:build)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const cat = JSON.parse(readFileSync(path.join(ROOT, 'public/assets/ara-data/catalog.json'), 'utf8')) as {
  sliders: Array<{ category: string; group: string; sliders: Array<{ id: string; label: string; bipolar: boolean }> }>;
  [k: string]: unknown;
};
const gallery = JSON.parse(readFileSync(path.join(ROOT, '.build-tools/ara-raw/gallery.json'), 'utf8')) as Array<{ id: string; name: string; gender: string; style: string; params: Record<string, unknown> }>;

type Opt = { id: string; name: string; thumb?: string; tags?: string[] };
const opts = (k: string): Opt[] => (cat[k] as Opt[]).map((o) => ({ id: o.id, name: o.name, ...(o.thumb ? { thumb: o.thumb } : {}), tags: o.tags ?? [] }));
const sliders = cat.sliders.flatMap((g) => g.sliders.map((s) => ({ id: s.id, category: g.category, group: g.group, label: s.label, bipolar: s.bipolar })));

// só os campos que o editor controla (o resto é fixo no servidor)
const KEEP = ['gender', 'age', 'muscle', 'weight', 'height', 'proportions', 'african', 'asian', 'caucasian', 'breastSize', 'breastFirmness', 'modifiers', 'skin', 'skinTint', 'eyes', 'eyebrows', 'eyelashes', 'hair', 'hairTint', 'hairColor', 'facialHair', 'beardColor', 'earrings', 'earringMetal', 'outfit', 'top', 'jacket', 'bottom', 'accessories', 'garmentStyles', 'shoes', 'outfitTint'];
const presets = gallery.map((g) => ({ id: g.id, name: g.name, gender: g.gender, style: g.style, params: Object.fromEntries(KEEP.filter((k) => k in g.params).map((k) => [k, g.params[k]])) }));

const out = `// GERADO por tools/avatars-ara/gen-catalog.ts — não edite à mão (npm run avatars-ara:catalog).
/* eslint-disable */
export interface AraOpt { id: string; name: string; thumb?: string; tags: string[] }
export interface AraSlider { id: string; category: string; group: string; label: string; bipolar: boolean }
export const ARA_SLIDERS: readonly AraSlider[] = ${JSON.stringify(sliders)};
export const ARA_SKINS: readonly AraOpt[] = ${JSON.stringify(opts('skins'))};
export const ARA_EYES: readonly AraOpt[] = ${JSON.stringify(opts('eyes'))};
export const ARA_EYEBROWS: readonly AraOpt[] = ${JSON.stringify(opts('eyebrows'))};
export const ARA_EYELASHES: readonly AraOpt[] = ${JSON.stringify(opts('eyelashes'))};
export const ARA_HAIR: readonly AraOpt[] = ${JSON.stringify(opts('hair'))};
export const ARA_OUTFITS: readonly AraOpt[] = ${JSON.stringify(opts('outfits'))};
export const ARA_SHOES: readonly AraOpt[] = ${JSON.stringify(opts('shoes'))};
export const ARA_PRESETS: ReadonlyArray<{ id: string; name: string; gender: string; style: string; params: Record<string, unknown> }> = ${JSON.stringify(presets)};
`;
writeFileSync(path.join(ROOT, 'shared/araCatalog.generated.ts'), out);
console.log(`araCatalog.generated.ts: ${sliders.length} controles, ${presets.length} personagens prontos, ${(out.length / 1024).toFixed(0)} KB`);
