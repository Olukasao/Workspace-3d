/**
 * Avatar 2D em camadas (pixel art): corpo, cabelo, camiseta, calça, calçado, barba, óculos e headset.
 * Os desenhos são pintados por código no navegador (src/workspace/mode2d/art): para acrescentar uma roupa ou um acessório,
 * basta incluir o id aqui e a função de pintura no registro, sem mexer no motor do personagem.
 * A configuração é guardada por colaborador (avatar_choices, estilo "sprite2d") e sincronizada em tempo real.
 */
export interface Opt2D { id: string; name: string }

export const SKIN2D = [
  { id: 'pele-1', name: 'Clara', hex: '#f6d5bd' }, { id: 'pele-2', name: 'Bege', hex: '#e8b98f' }, { id: 'pele-3', name: 'Morena clara', hex: '#c98f63' },
  { id: 'pele-4', name: 'Morena', hex: '#a46a42' }, { id: 'pele-5', name: 'Escura', hex: '#7a4a2e' }, { id: 'pele-6', name: 'Muito escura', hex: '#5a3622' },
] as const;
export const HAIR2D: readonly Opt2D[] = [
  { id: 'short', name: 'Curto' }, { id: 'side', name: 'Curto com lado' }, { id: 'long', name: 'Longo' }, { id: 'bob', name: 'Chanel' },
  { id: 'ponytail', name: 'Rabo de cavalo' }, { id: 'bun', name: 'Coque' }, { id: 'afro', name: 'Afro' }, { id: 'buzz', name: 'Raspado' }, { id: 'bald', name: 'Careca' },
];
export const SHIRT2D: readonly Opt2D[] = [
  { id: 'tee', name: 'Camiseta' }, { id: 'shirt', name: 'Camisa social' }, { id: 'polo', name: 'Polo' }, { id: 'blazer', name: 'Paletó' }, { id: 'hoodie', name: 'Moletom' },
];
export const PANTS2D: readonly Opt2D[] = [{ id: 'long', name: 'Calça' }, { id: 'shorts', name: 'Bermuda' }, { id: 'skirt', name: 'Saia' }];
export const SHOES2D: readonly Opt2D[] = [{ id: 'sneakers', name: 'Tênis' }, { id: 'formal', name: 'Sapato social' }, { id: 'boots', name: 'Bota' }];
export const FACIAL2D: readonly Opt2D[] = [{ id: 'none', name: 'Sem barba' }, { id: 'mustache', name: 'Bigode' }, { id: 'beard', name: 'Barba' }];

export const PALETTE2D = {
  hair: ['#1a1410', '#3b2a1c', '#6b4a2e', '#a0652a', '#c8a15a', '#d8d8d8', '#b0301f', '#3a5a8a'],
  shirt: ['#ffffff', '#26324a', '#3a5a8a', '#3a8f94', '#5a1f2b', '#c9b597', '#2b2d33', '#e3c168', '#7a4aa0', '#4a8a4a'],
  pants: ['#26324a', '#2b2d33', '#6b7280', '#c9b597', '#3a5a8a', '#5a3622', '#1a1410'],
  shoes: ['#1a1410', '#5a3622', '#f1ece4', '#26324a', '#b0301f'],
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
}
export const isSprite2D = (c: unknown): c is Avatar2DConfig => !!c && typeof c === 'object' && (c as { style?: unknown }).style === 'sprite2d';

const HEX = /^#[0-9a-fA-F]{6}$/;
const KEYS = ['v', 'style', 'skin', 'hair', 'hairColor', 'shirt', 'shirtColor', 'pants', 'pantsColor', 'shoes', 'shoesColor', 'facial', 'glasses', 'headsetAlways'];

export function validateAvatar2D(input: unknown): string[] {
  const c = input as Record<string, unknown>;
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['Configuração ausente.'];
  const e: string[] = [];
  if (c.v !== 1) e.push('Versão não suportada.');
  if (c.style !== 'sprite2d') e.push('Estilo inválido.');
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

/** Aparência padrão determinística por pessoa (o gênero não é deduzido do nome). */
export function defaultAvatar2D(seed: string): Avatar2DConfig {
  const h = hash(seed);
  const pick = <T,>(a: readonly T[], shift: number) => a[(h >>> shift) % a.length];
  const hair = pick(HAIR2D, 3);
  return {
    v: 1, style: 'sprite2d', skin: pick(SKIN2D, 1).id, hair: hair.id, hairColor: pick(PALETTE2D.hair, 5), shirt: pick(SHIRT2D, 7).id, shirtColor: pick(PALETTE2D.shirt, 9),
    pants: pick(PANTS2D, 11).id, pantsColor: pick(PALETTE2D.pants, 13), shoes: pick(SHOES2D, 15).id, shoesColor: pick(PALETTE2D.shoes, 17),
    facial: (h >>> 19) % 5 === 0 ? 'beard' : 'none', glasses: (h >>> 21) % 4 === 0, headsetAlways: false,
  };
}
