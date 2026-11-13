/**
 * Avatar 2D em camadas (pixel art, 32x32): corpo, olhos, cabelo, parte de cima, parte de baixo e calçado vêm do pacote
 * "Customizable Character Pack" (Ordinary Bumblebee, CC0) em public/assets/char-layers; óculos e headset são desenhados por código.
 * Para acrescentar uma peça: aumente o número de peças da lista aqui e acrescente a linha na folha de sprites.
 * A configuração é guardada por colaborador (avatar_choices, estilo "sprite2d") e sincronizada em tempo real.
 * As cores de roupa e calçado não são usadas por este pacote (as peças já têm cor), mas os campos continuam por compatibilidade.
 */
import { LPC_BODIES, LPC_CLOTH_COLORS, LPC_EXTRAS, LPC_EXTRA_CATS, LPC_EYE_COLORS, LPC_HAIR_COLORS, LPC_METAL_COLORS, LPC_PARTS, LPC_SKINS } from './avatarLpc.generated';

export interface Opt2D { id: string; name: string }
export type Look2D = 'lpc' | 'chibi';

export const SKIN2D = [
  { id: 'pele-1', name: 'Morena clara', hex: '#c98040' }, { id: 'pele-2', name: 'Clara', hex: '#efc7a5' }, { id: 'pele-3', name: 'Bege', hex: '#e8bf8d' },
  { id: 'pele-4', name: 'Morena', hex: '#ad6c3d' }, { id: 'pele-5', name: 'Muito clara', hex: '#f6d5b3' },
] as const;
/** Peças do pacote de personagens em camadas (Ordinary Bumblebee, CC0): a ordem dos ids é a ordem das linhas nas folhas. */
const seq = (prefix: string, n: number, label: string): readonly Opt2D[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${label} ${i + 1}` }));
export const HAIR2D: readonly Opt2D[] = [{ id: 'bald', name: 'Careca' }, ...seq('h', 5, 'Cabelo')];
export const SHIRT2D: readonly Opt2D[] = seq('t', 29, 'Parte de cima');
export const PANTS2D: readonly Opt2D[] = seq('b', 14, 'Parte de baixo');
export const SHOES2D: readonly Opt2D[] = seq('s', 10, 'Calçado');
export const FACIAL2D: readonly Opt2D[] = [{ id: 'none', name: 'Sem barba' }];

export const PALETTE2D = {
  hair: ['#3e2723', '#a33c1a', '#ebcc66', '#2e2725', '#8a8a8a'],
  shirt: ['#ffffff'],
  pants: ['#26324a'],
  shoes: ['#1a1410'],
} as const;

export interface Avatar2DConfig {
  v: 1;
  style: 'sprite2d';
  skin: string;
  hair: string;
  hairColor: string;
  shirt: string;
  shirtColor: string;
  pants: string;
  pantsColor: string;
  shoes: string;
  shoesColor: string;
  facial: string;
  glasses: boolean;
  headsetAlways: boolean;
  /** Estilo de arte: 'lpc' (Universal LPC, padrão) ou 'chibi'. Sem o campo = 'chibi' (aparências antigas). */
  look?: Look2D;
  /** Só no estilo LPC. */
  bodyType?: 'male' | 'female';
  eyeColor?: string;
  /** Cabeça (id de LPC_EXTRAS.head); sem o campo vale a cabeça padrão do tipo de corpo. */
  head?: string;
  /** Peças opcionais por categoria (chapéu, expressão, sobrancelhas, nariz, pescoço, luvas e pulseiras, meias, macacão); a cor só vale para peças que têm cor própria. */
  extras?: Record<string, { id: string; color?: string }>;
}
export const LPC_EXTRA_LIST = LPC_EXTRA_CATS.filter((c) => c !== 'head');
export const isSprite2D = (c: unknown): c is Avatar2DConfig => !!c && typeof c === 'object' && (c as { style?: unknown }).style === 'sprite2d';

const HEX = /^#[0-9a-fA-F]{6}$/;
const KEYS = ['v', 'style', 'skin', 'hair', 'hairColor', 'shirt', 'shirtColor', 'pants', 'pantsColor', 'shoes', 'shoesColor', 'facial', 'glasses', 'headsetAlways', 'look', 'bodyType', 'eyeColor', 'head', 'extras'];

const ids = (cat: keyof typeof LPC_PARTS, none?: string) => [...(none ? [none] : []), ...LPC_PARTS[cat].map((p) => p.id)];
export const LPC_HAIR_IDS = ids('hair', 'none');
export const LPC_TORSO_IDS = ids('torso');
export const LPC_LEGS_IDS = ids('legs');
export const LPC_SHOES_IDS = ids('shoes');
export const LPC_BEARD_IDS = ids('beard', 'none');

export function validateAvatar2D(input: unknown): string[] {
  const c = input as Record<string, unknown>;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['Configuração ausente.'];
  const e: string[] = [];
  if (c.v !== 1) e.push('Versão não suportada.');
  if (c.style !== 'sprite2d') e.push('Estilo inválido.');
  if (c.look !== undefined && c.look !== 'lpc' && c.look !== 'chibi') e.push('Estilo de arte inválido.');
  if (c.look === 'lpc') {
    const inList = (k: string, list: readonly string[], label: string) => {
      if (typeof c[k] !== 'string' || !list.includes(c[k] as string)) e.push(`${label} fora da lista.`);
    };
    inList('bodyType', LPC_BODIES, 'Tipo de corpo');
    inList('skin', LPC_SKINS, 'Pele');
    inList('hair', LPC_HAIR_IDS, 'Cabelo');
    inList('hairColor', LPC_HAIR_COLORS, 'Cor do cabelo');
    inList('shirt', LPC_TORSO_IDS, 'Parte de cima');
    inList('shirtColor', LPC_CLOTH_COLORS, 'Cor da parte de cima');
    inList('pants', LPC_LEGS_IDS, 'Parte de baixo');
    inList('pantsColor', LPC_CLOTH_COLORS, 'Cor da parte de baixo');
    inList('shoes', LPC_SHOES_IDS, 'Calçado');
    inList('shoesColor', LPC_CLOTH_COLORS, 'Cor do calçado');
    inList('facial', LPC_BEARD_IDS, 'Barba');
    inList('eyeColor', LPC_EYE_COLORS, 'Cor dos olhos');
    if (c.head !== undefined) inList('head', LPC_EXTRAS.head.map((p) => p.id), 'Cabeça');
    if (c.extras !== undefined) {
      const ex = c.extras as Record<string, { id?: unknown; color?: unknown }>;
      if (!ex || typeof ex !== 'object' || Array.isArray(ex)) e.push('extras inválido.');
      else
        for (const [cat, v] of Object.entries(ex)) {
          const list = (LPC_EXTRA_LIST as readonly string[]).includes(cat) ? LPC_EXTRAS[cat as keyof typeof LPC_EXTRAS] : null;
          const part = list?.find((p) => p.id === v?.id);
          if (!list) e.push(`Categoria desconhecida: ${cat}.`);
          else if (!part) e.push(`Peça de ${cat} fora da lista.`);
          else if (v.color !== undefined) {
            const ok = part.variants ? part.variants.includes(v.color as string) : part.recolor === 'metal' ? (LPC_METAL_COLORS as readonly string[]).includes(v.color as string) : part.recolor === 'cloth' ? (LPC_CLOTH_COLORS as readonly string[]).includes(v.color as string) : false;
            if (!ok) e.push(`Cor de ${cat} fora da lista.`);
          }
        }
    }
    for (const k of ['glasses', 'headsetAlways']) if (typeof c[k] !== 'boolean') e.push(`${k} deve ser verdadeiro ou falso.`);
    const extra = Object.keys(c).filter((k) => !KEYS.includes(k));
    if (extra.length) e.push(`Campos desconhecidos: ${extra.join(', ')}.`);
    return e;
  }
  if (c.bodyType !== undefined || c.eyeColor !== undefined) e.push('bodyType e eyeColor só existem no estilo LPC.');
  const pick = (k: string, list: readonly { id: string }[], label: string) => {
    if (typeof c[k] !== 'string' || !list.some((o) => o.id === c[k])) e.push(`${label} fora da lista.`);
  };
  pick('skin', SKIN2D, 'Pele');
  pick('hair', HAIR2D, 'Cabelo');
  pick('shirt', SHIRT2D, 'Parte de cima');
  pick('pants', PANTS2D, 'Parte de baixo');
  pick('shoes', SHOES2D, 'Calçado');
  pick('facial', FACIAL2D, 'Barba');
  for (const k of ['hairColor', 'shirtColor', 'pantsColor', 'shoesColor']) if (typeof c[k] !== 'string' || !HEX.test(c[k] as string)) e.push(`${k} deve ser uma cor #rrggbb.`);
  for (const k of ['glasses', 'headsetAlways']) if (typeof c[k] !== 'boolean') e.push(`${k} deve ser verdadeiro ou falso.`);
  const extra = Object.keys(c).filter((k) => !KEYS.includes(k));
  if (extra.length) e.push(`Campos desconhecidos: ${extra.join(', ')}.`);
  return e;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

/** Aparência padrão determinística por pessoa, no estilo LPC (o gênero não é deduzido do nome: o tipo de corpo vem do sorteio). */
export function defaultAvatar2D(seed: string): Avatar2DConfig {
  const h = hash(seed);
  const pick = <T,>(a: readonly T[], shift: number) => a[(h >>> shift) % a.length];
  return {
    v: 1, style: 'sprite2d', look: 'lpc', bodyType: pick(LPC_BODIES, 1), skin: pick(LPC_SKINS, 2),
    hair: pick(LPC_HAIR_IDS.slice(1), 4), hairColor: pick(['dark_brown', 'black', 'chestnut', 'light_brown', 'blonde', 'ginger', 'dark_gray', 'raven', 'sandy', 'gray'], 6), shirt: pick(LPC_TORSO_IDS, 8), shirtColor: pick(['blue', 'navy', 'red', 'teal', 'forest', 'green', 'white', 'gray', 'maroon', 'purple', 'sky', 'yellow', 'orange', 'bluegray'], 10),
    pants: pick(LPC_LEGS_IDS, 12), pantsColor: pick(['navy', 'charcoal', 'black', 'gray', 'brown', 'forest'], 14), shoes: pick(LPC_SHOES_IDS, 16), shoesColor: pick(['black', 'brown', 'leather', 'charcoal'], 18),
    facial: 'none', eyeColor: pick(LPC_EYE_COLORS, 20), glasses: (h >>> 22) % 4 === 0, headsetAlways: false,
  };
}
