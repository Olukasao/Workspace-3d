/**
 * Personagem personalizado do estilo Ara 3D Gen: parâmetros que o editor controla, lista do que vale no escritório
 * e normalização ESTRITA (usada no servidor, que nunca confia no cliente, e no editor).
 *
 * O Ara tem muito mais opções (armas, biquíni, fantasias, veículos, tatuagens, chapéus...). Aqui só entra o que faz sentido
 * num escritório: roupas de trabalho e casuais discretas, cabelo, rosto, corpo e cores. O resto é fixado pelo servidor.
 * As listas de ids estão em shared/araCatalog.generated.ts (gerado a partir dos dados do Ara).
 */
import type { HumanParams } from '../vendor/ara3d/src/core/params';
import { ARA_EYEBROWS, ARA_EYELASHES, ARA_EYES, ARA_HAIR, ARA_SKINS, ARA_SLIDERS } from './araCatalog.generated';

export type AraParams = Pick<
  HumanParams,
  | 'gender' | 'age' | 'muscle' | 'weight' | 'height' | 'proportions' | 'african' | 'asian' | 'caucasian' | 'breastSize' | 'breastFirmness' | 'modifiers'
  | 'skin' | 'skinTint' | 'eyes' | 'eyebrows' | 'eyelashes' | 'hair' | 'hairTint' | 'hairColor' | 'facialHair' | 'beardColor' | 'earrings' | 'earringMetal'
  | 'outfit' | 'top' | 'jacket' | 'bottom' | 'accessories' | 'garmentStyles' | 'shoes' | 'outfitTint'
>;

/** Só adultos: 18 anos na escala de idade do MakeHuman. */
export const ARA_MIN_AGE = 0.34375;

export const ARA_FACIAL_HAIR = ['none', 'stubble', 'mustache', 'mustache_stubble', 'goatee', 'short_beard', 'full_beard'] as const;
export const ARA_EARRINGS = ['none', 'studs', 'pearl_drops', 'small_hoops', 'big_hoops'] as const;
export const ARA_PROCEDURAL_HAIR = ['buzz', 'mohawk', 'cornrows', 'box_braids'] as const;
const NO_LOGO_OUTFITS = ['male_casualsuit01', 'male_casualsuit03', 'male_casualsuit05', 'male_elegantsuit01', 'female_elegantsuit01']; // as outras trazem o logotipo do MakeHuman estampado

/** Conjuntos prontos e peças soltas permitidos, com os padrões de tecido que fazem sentido em cada um. */
export const ARA_OFFICE = {
  outfits: ['none', ...NO_LOGO_OUTFITS, 'set_suit_tie', 'set_pantsuit'] as readonly string[],
  tops: ['none', 'camp_shirt', 'silk_blouse', 'oversized_tee', 'suit_shirt_tie', 'uniform_shirt', 'uniform_shirt_long', 'peplum_top', 'lace_top', 'ankara_gown'] as readonly string[],
  jackets: ['none', 'suit_jacket', 'overcoat'] as readonly string[],
  bottoms: ['none', 'suit_trousers', 'trousers', 'baggy_jeans', 'uniform_trousers', 'pencil_skirt_midi', 'pencil_skirt_maxi'] as readonly string[],
  shoes: ['shoes01', 'shoes02', 'shoes03', 'shoes04', 'shoes05', 'shoes06', 'heels', 'sneakers', 'loafers', 'oxfords'] as readonly string[],
  accessories: ['watch', 'watch_gold', 'watch_silver', 'fine_pendant', 'gold_necklace', 'pearl_necklace', 'gold_ring', 'bangles', 'belt'] as readonly string[],
  /** padrões de tecido permitidos por peça (também vale para o id do conjunto, que colore o paletó e a calça) */
  patterns: {
    set_suit_tie: ['suiting', 'solid', 'linen'], set_pantsuit: ['suiting', 'solid', 'linen'],
    camp_shirt: ['tropical', 'solid', 'linen'], silk_blouse: ['satin', 'solid'], oversized_tee: ['jersey'], suit_shirt_tie: ['solid', 'striped'],
    uniform_shirt: ['solid'], uniform_shirt_long: ['solid'], peplum_top: ['ankara_web', 'ankara_floral', 'ankara', 'lace', 'solid'], lace_top: ['lace', 'damask', 'ankara', 'solid'],
    ankara_gown: ['ankara_floral', 'ankara_web', 'ankara', 'lace', 'solid'], suit_jacket: ['linen', 'suiting', 'solid'], overcoat: ['suiting', 'solid', 'linen'],
    suit_trousers: ['linen', 'suiting', 'solid'], trousers: ['solid'], baggy_jeans: ['denim', 'solid'], uniform_trousers: ['solid'],
    pencil_skirt_midi: ['ankara_web', 'ankara_floral', 'ankara', 'lace', 'solid'], pencil_skirt_maxi: ['lace', 'ankara_floral', 'ankara_web', 'ankara', 'solid'],
    heels: ['nappa', 'patent', 'leather'], sneakers: ['nappa', 'workwear'], loafers: ['patent', 'nappa'], oxfords: ['nappa', 'patent'],
    watch: ['solid'], watch_gold: ['solid'], watch_silver: ['solid'], fine_pendant: ['solid'], gold_necklace: ['solid'], pearl_necklace: ['solid'], gold_ring: ['solid'], bangles: ['solid'], belt: ['leather'],
  } as Record<string, readonly string[]>,
};

/** Controles do corpo que não entram no escritório (aparecem no catálogo do Ara, mas ficam de fora). */
const HIDDEN_SLIDERS = new Set(ARA_SLIDERS.filter((s) => /pregnan/i.test(s.id) || /^Pregnancy/i.test(s.label)).map((s) => s.id));
export const ARA_EDITOR_SLIDERS = ARA_SLIDERS.filter((s) => !HIDDEN_SLIDERS.has(s.id));
const SLIDER_BY_ID = new Map(ARA_SLIDERS.map((s) => [s.id, s]));

export const ARA_DEFAULT_PARAMS: AraParams = {
  gender: 1, age: 0.5, muscle: 0.5, weight: 0.5, height: 0.5, proportions: 0.7, african: 0.1, asian: 0.1, caucasian: 0.8, breastSize: 0.5, breastFirmness: 0.5, modifiers: {},
  skin: 'auto', skinTint: '#ffffff', eyes: 'brownlight', eyebrows: 'eyebrow001', eyelashes: 'eyelashes01', hair: 'short02', hairTint: '#ffffff', hairColor: '#2a1e16',
  facialHair: 'none', beardColor: '#241a13', earrings: 'none', earringMetal: 'gold', outfit: 'set_suit_tie', top: 'none', jacket: 'none', bottom: 'none', accessories: [], garmentStyles: {}, shoes: 'oxfords', outfitTint: '#ffffff',
};

export const ARA_PARAM_KEYS = Object.keys(ARA_DEFAULT_PARAMS) as Array<keyof AraParams>;
const HEX = /^#[0-9a-fA-F]{6}$/;
const ids = (list: ReadonlyArray<{ id: string }>) => list.map((o) => o.id);
const HAIR_IDS = [...ids(ARA_HAIR), ...ARA_PROCEDURAL_HAIR];
const SKIN_IDS = ['auto', ...ids(ARA_SKINS)];

/**
 * Valida e normaliza parâmetros vindos do cliente. Devolve os parâmetros limpos (só campos conhecidos, números dentro da faixa)
 * e a lista de erros. Com erros, quem chama deve recusar (422) em vez de salvar.
 */
export function normalizeAraParams(raw: unknown): { params: AraParams; errors: string[] } {
  const errors: string[] = [];
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  if (!src) return { params: { ...ARA_DEFAULT_PARAMS }, errors: ['Parâmetros do personagem ausentes.'] };
  const out = { ...ARA_DEFAULT_PARAMS, modifiers: {}, accessories: [], garmentStyles: {} } as AraParams;
  const extra = Object.keys(src).filter((k) => !(ARA_PARAM_KEYS as string[]).includes(k));
  if (extra.length) errors.push(`Campos desconhecidos: ${extra.slice(0, 5).join(', ')}.`);

  const num = (k: keyof AraParams, lo: number, hi: number) => {
    const v = src[k];
    if (v === undefined) return;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) errors.push(`${String(k)} deve ser um número de ${lo} a ${hi}.`);
    else (out as Record<string, unknown>)[k] = v;
  };
  for (const k of ['gender', 'muscle', 'weight', 'height', 'proportions', 'african', 'asian', 'caucasian', 'breastSize', 'breastFirmness'] as const) num(k, 0, 1);
  num('age', ARA_MIN_AGE, 1);
  const pick = (k: keyof AraParams, allowed: readonly string[], label: string) => {
    const v = src[k];
    if (v === undefined) return;
    if (typeof v !== 'string' || !allowed.includes(v)) errors.push(`${label} fora da lista permitida.`);
    else (out as Record<string, unknown>)[k] = v;
  };
  pick('skin', SKIN_IDS, 'Pele');
  pick('eyes', ids(ARA_EYES), 'Cor dos olhos');
  pick('eyebrows', ids(ARA_EYEBROWS), 'Sobrancelhas');
  pick('eyelashes', ids(ARA_EYELASHES), 'Cílios');
  pick('hair', HAIR_IDS, 'Cabelo');
  pick('facialHair', ARA_FACIAL_HAIR, 'Barba');
  pick('earrings', ARA_EARRINGS, 'Brincos');
  pick('earringMetal', ['gold', 'silver'], 'Metal dos brincos');
  pick('outfit', ARA_OFFICE.outfits, 'Roupa');
  pick('top', ARA_OFFICE.tops, 'Parte de cima');
  pick('jacket', ARA_OFFICE.jackets, 'Paletó ou casaco');
  pick('bottom', ARA_OFFICE.bottoms, 'Parte de baixo');
  pick('shoes', ARA_OFFICE.shoes, 'Calçado');
  for (const k of ['skinTint', 'hairTint', 'hairColor', 'beardColor', 'outfitTint'] as const) {
    const v = src[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !HEX.test(v)) errors.push(`${k} deve ser uma cor no formato #rrggbb.`);
    else out[k] = v;
  }
  if (src.accessories !== undefined) {
    const a = src.accessories;
    if (!Array.isArray(a) || a.length > 8 || a.some((x) => typeof x !== 'string' || !ARA_OFFICE.accessories.includes(x))) errors.push('Acessórios fora da lista permitida.');
    else out.accessories = [...new Set(a as string[])];
  }
  if (src.modifiers !== undefined) {
    const m = src.modifiers;
    if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).length > ARA_SLIDERS.length) errors.push('Controles do corpo inválidos.');
    else
      for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
        const s = SLIDER_BY_ID.get(k);
        if (!s || HIDDEN_SLIDERS.has(k)) errors.push(`Controle do corpo "${k.slice(0, 40)}" não existe.`);
        else if (typeof v !== 'number' || !Number.isFinite(v) || v < (s.bipolar ? -1 : 0) || v > 1) errors.push(`Controle "${k}" fora da faixa.`);
        else if (v !== 0) out.modifiers[k] = v;
      }
  }
  if (src.garmentStyles !== undefined) {
    const g = src.garmentStyles;
    if (!g || typeof g !== 'object' || Array.isArray(g) || Object.keys(g).length > 40) errors.push('Estilos das peças inválidos.');
    else
      for (const [piece, style] of Object.entries(g as Record<string, unknown>)) {
        const allowed = ARA_OFFICE.patterns[piece];
        if (!allowed) {
          errors.push(`Peça "${piece.slice(0, 30)}" fora da lista permitida.`);
          continue;
        }
        if (!style || typeof style !== 'object' || Array.isArray(style) || Object.keys(style).some((k) => !['pattern', 'color', 'color2'].includes(k))) {
          errors.push(`Estilo de "${piece}" inválido.`);
          continue;
        }
        const s = style as Record<string, unknown>;
        if (s.pattern !== undefined && (typeof s.pattern !== 'string' || !allowed.includes(s.pattern))) errors.push(`Padrão de "${piece}" não permitido.`);
        else if ((s.color !== undefined && (typeof s.color !== 'string' || !HEX.test(s.color))) || (s.color2 !== undefined && (typeof s.color2 !== 'string' || !HEX.test(s.color2)))) errors.push(`Cor de "${piece}" inválida.`);
        else out.garmentStyles[piece] = { ...(s.pattern ? { pattern: s.pattern as string } : {}), ...(s.color ? { color: s.color as string } : {}), ...(s.color2 ? { color2: s.color2 as string } : {}) };
      }
  }
  // sempre vestido: sem conjunto, a parte de cima e a de baixo são obrigatórias; com conjunto, as peças soltas não valem
  if (errors.length === 0) {
    if (out.outfit === 'none' && (out.top === 'none' || out.bottom === 'none')) errors.push('Sem conjunto pronto, escolha a parte de cima e a de baixo.');
    if (out.outfit !== 'none' && (out.top !== 'none' || out.bottom !== 'none')) errors.push('Com conjunto pronto, a parte de cima e a de baixo ficam em "nenhuma".');
    if (out.outfit.startsWith('male_') || out.outfit.startsWith('female_')) {
      const male = out.outfit.startsWith('male_');
      if ((male && out.gender < 0.3) || (!male && out.gender > 0.7)) errors.push('Esta roupa não serve para o corpo escolhido.');
    }
  }
  return { params: out, errors };
}

/**
 * Parâmetros completos (campos fixos incluídos) para o gerador do Ara. `base` é o DEFAULT_PARAMS do próprio Ara
 * (quem chama é o servidor ou o worker do navegador, que já carregam o gerador). Mesmo resultado nos dois lugares.
 * `faceShapes: false` não exporta morph targets (pré-visualização); `true` exporta expressões e visemas (modelo final).
 */
export function toHumanParams(base: HumanParams, p: AraParams, opts: { detail: 'low' | 'medium' | 'high'; faceShapes: boolean; name?: string }): HumanParams {
  return {
    ...base,
    ...p,
    name: opts.name ?? 'avatar', seed: 1, tattoos: [], tattooInk: '#1c2128', underwear: true, hat: 'none', detail: opts.detail, rig: 'game', faceBones: true, restPose: 'A', animations: false,
    weapon: 'none', carry: 'none', vehicle: 'none', expression: 'neutral', faceShapes: opts.faceShapes, speechShapes: opts.faceShapes, teeth: 'teeth_base', tongue: true,
  };
}

/** Idade do MakeHuman (0..1) ↔ anos (a escala não é linear: 18 anos = 0,34375; 25 = 0,5; 90 = 1). */
export function ageToYears(a: number): number {
  if (a < 0.1875) return 1 + (a / 0.1875) * 10;
  if (a < 0.5) return 11 + ((a - 0.1875) / 0.3125) * 14;
  return 25 + ((a - 0.5) / 0.5) * 65;
}
export function yearsToAge(y: number): number {
  if (y < 11) return ((y - 1) / 10) * 0.1875;
  if (y < 25) return 0.1875 + ((y - 11) / 14) * 0.3125;
  return 0.5 + ((y - 25) / 65) * 0.5;
}
