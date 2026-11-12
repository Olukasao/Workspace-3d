/**
 * Catálogo de avatares (fonte de verdade para validação no servidor e para o editor "Meu avatar").
 * Os arquivos de cada peça existem por base (male/female) em public/assets/avatars/<base>/<id>.glb — ver manifest.json.
 * A configuração guarda só IDs do catálogo e cores da paleta permitida, com versão de catálogo.
 */
export const AVATAR_CATALOG_VERSION = 1;

export type AvatarBase = 'male' | 'female';
export type AvatarSlot = 'top' | 'bottom' | 'shoes' | 'hair' | 'beard' | 'glasses' | 'headset';
export const AVATAR_SLOTS: readonly AvatarSlot[] = ['top', 'bottom', 'shoes', 'hair', 'beard', 'glasses', 'headset'];

export interface ColorOption {
  id: string;
  name: string;
  hex: string;
}

export interface CatalogItem {
  id: string;
  slot: AvatarSlot;
  name: string;
  bases: AvatarBase[];
  /** paleta permitida (null = sem cor ajustável) */
  palette: keyof typeof PALETTES | null;
  defaultColor?: string;
  style?: 'casual' | 'corporate';
}

export interface AvatarConfig {
  v: number;
  base: AvatarBase;
  skin: string;
  face: string;
  hair: string;
  hairColor: string;
  beard: string;
  top: string;
  topColor: string;
  bottom: string;
  bottomColor: string;
  shoes: string;
  shoesColor: string;
  glasses: string;
  /** modelo do headset; aparece automaticamente durante atendimentos */
  headset: string;
  /** usar o headset também fora de atendimento */
  headsetAlways: boolean;
}

export const PALETTES = {
  hair: [
    { id: 'preto', name: 'Preto', hex: '#1d1814' },
    { id: 'castanho-escuro', name: 'Castanho-escuro', hex: '#3d2b1f' },
    { id: 'castanho', name: 'Castanho', hex: '#6e4b2f' },
    { id: 'loiro', name: 'Loiro', hex: '#b9955c' },
    { id: 'ruivo', name: 'Ruivo', hex: '#8e3e20' },
    { id: 'grisalho', name: 'Grisalho', hex: '#a2a19c' },
  ],
  top: [
    { id: 'branco', name: 'Branco', hex: '#f1f1ee' },
    { id: 'cinza', name: 'Cinza', hex: '#9aa0a6' },
    { id: 'grafite', name: 'Grafite', hex: '#3d424a' },
    { id: 'marinho', name: 'Azul-marinho', hex: '#22304f' },
    { id: 'azul', name: 'Azul', hex: '#3a68aa' },
    { id: 'verde', name: 'Verde-oliva', hex: '#56704f' },
    { id: 'vinho', name: 'Vinho', hex: '#6d2536' },
    { id: 'bege', name: 'Bege', hex: '#cbb99b' },
  ],
  bottom: [
    { id: 'jeans', name: 'Jeans', hex: '#3d5679' },
    { id: 'preto', name: 'Preto', hex: '#24272c' },
    { id: 'cinza', name: 'Cinza', hex: '#6d727a' },
    { id: 'bege', name: 'Bege', hex: '#b9a688' },
    { id: 'marinho', name: 'Azul-marinho', hex: '#212c46' },
  ],
  shoes: [
    { id: 'preto', name: 'Preto', hex: '#202124' },
    { id: 'marrom', name: 'Marrom', hex: '#5c3b27' },
    { id: 'branco', name: 'Branco', hex: '#e9e9e7' },
    { id: 'cinza', name: 'Cinza', hex: '#7c8087' },
  ],
} satisfies Record<string, ColorOption[]>;

export const SKIN_TONES = [
  { id: 'pele-1', name: 'Tom 1' },
  { id: 'pele-2', name: 'Tom 2' },
  { id: 'pele-3', name: 'Tom 3' },
  { id: 'pele-4', name: 'Tom 4' },
  { id: 'pele-5', name: 'Tom 5' },
];

export const FACES = [
  { id: 'rosto-1', name: 'Rosto 1', morph: null },
  { id: 'rosto-2', name: 'Rosto 2', morph: 'face_rosto-2' },
  { id: 'rosto-3', name: 'Rosto 3', morph: 'face_rosto-3' },
  { id: 'rosto-4', name: 'Rosto 4', morph: 'face_rosto-4' },
];

const M: AvatarBase[] = ['male'];
const F: AvatarBase[] = ['female'];
const MF: AvatarBase[] = ['male', 'female'];

/** Peças disponíveis (todas modeladas a partir de assets CC0 do MakeHuman/MPFB2 — ver manifest.json). */
export const AVATAR_CATALOG: CatalogItem[] = [
  // parte de cima — camisetas/blusas com o logotipo do projeto MakeHuman estampado ficaram fora do catálogo (ver docs/avatars.md)
  { id: 'top.male_casualsuit03', slot: 'top', name: 'Camisa listrada', bases: MF, palette: 'top', defaultColor: 'azul', style: 'casual' },
  { id: 'top.male_casualsuit05', slot: 'top', name: 'Jaqueta com capuz', bases: MF, palette: 'top', defaultColor: 'verde', style: 'casual' },
  { id: 'top.male_elegantsuit01', slot: 'top', name: 'Paletó com gravata', bases: M, palette: 'top', defaultColor: 'grafite', style: 'corporate' },
  { id: 'top.toigo_male_suit_tie_and_jacket', slot: 'top', name: 'Terno com gravata estampada', bases: M, palette: 'top', defaultColor: 'marinho', style: 'corporate' },
  { id: 'top.toigo_male_suit_3', slot: 'top', name: 'Terno com gravata vermelha', bases: M, palette: 'top', defaultColor: 'grafite', style: 'corporate' },
  { id: 'top.female_elegantsuit01', slot: 'top', name: 'Camisa social listrada', bases: F, palette: 'top', defaultColor: 'branco', style: 'corporate' },
  { id: 'top.toigo_female_suit', slot: 'top', name: 'Tailleur', bases: F, palette: 'top', defaultColor: 'marinho', style: 'corporate' },
  { id: 'top.toigo_female_suit_2', slot: 'top', name: 'Blazer com lenço', bases: F, palette: 'top', defaultColor: 'grafite', style: 'corporate' },
  // parte de baixo
  { id: 'bottom.male_casualsuit02', slot: 'bottom', name: 'Jeans claro', bases: MF, palette: 'bottom', defaultColor: 'jeans', style: 'casual' },
  { id: 'bottom.male_casualsuit03', slot: 'bottom', name: 'Jeans escuro', bases: M, palette: 'bottom', defaultColor: 'jeans', style: 'casual' },
  { id: 'bottom.male_casualsuit04', slot: 'bottom', name: 'Jeans cinza', bases: M, palette: 'bottom', defaultColor: 'cinza', style: 'casual' },
  { id: 'bottom.male_casualsuit05', slot: 'bottom', name: 'Jeans reto', bases: M, palette: 'bottom', defaultColor: 'jeans', style: 'casual' },
  { id: 'bottom.male_casualsuit06', slot: 'bottom', name: 'Jeans preto', bases: M, palette: 'bottom', defaultColor: 'preto', style: 'casual' },
  { id: 'bottom.male_elegantsuit01', slot: 'bottom', name: 'Calça social', bases: M, palette: 'bottom', defaultColor: 'preto', style: 'corporate' },
  { id: 'bottom.toigo_male_suit_tie_and_jacket', slot: 'bottom', name: 'Calça do terno', bases: M, palette: 'bottom', defaultColor: 'marinho', style: 'corporate' },
  { id: 'bottom.toigo_male_suit_3', slot: 'bottom', name: 'Calça risca de giz', bases: M, palette: 'bottom', defaultColor: 'cinza', style: 'corporate' },
  { id: 'bottom.female_casualsuit01', slot: 'bottom', name: 'Jeans', bases: F, palette: 'bottom', defaultColor: 'jeans', style: 'casual' },
  { id: 'bottom.female_sportsuit01', slot: 'bottom', name: 'Legging', bases: F, palette: 'bottom', defaultColor: 'preto', style: 'casual' },
  { id: 'bottom.female_elegantsuit01', slot: 'bottom', name: 'Saia lápis', bases: F, palette: 'bottom', defaultColor: 'preto', style: 'corporate' },
  { id: 'bottom.toigo_female_suit', slot: 'bottom', name: 'Saia do tailleur', bases: F, palette: 'bottom', defaultColor: 'marinho', style: 'corporate' },
  { id: 'bottom.toigo_female_suit_2', slot: 'bottom', name: 'Calça social', bases: F, palette: 'bottom', defaultColor: 'preto', style: 'corporate' },
  // calçados (ajustados aos dois corpos)
  { id: 'shoes.shoes01', slot: 'shoes', name: 'Sapato social', bases: MF, palette: 'shoes', defaultColor: 'preto' },
  { id: 'shoes.shoes02', slot: 'shoes', name: 'Sapato casual', bases: MF, palette: 'shoes', defaultColor: 'marrom' },
  { id: 'shoes.shoes03', slot: 'shoes', name: 'Bota curta', bases: MF, palette: 'shoes', defaultColor: 'marrom' },
  { id: 'shoes.shoes04', slot: 'shoes', name: 'Mocassim', bases: MF, palette: 'shoes', defaultColor: 'marrom' },
  { id: 'shoes.shoes05', slot: 'shoes', name: 'Sapato baixo', bases: MF, palette: 'shoes', defaultColor: 'preto' },
  { id: 'shoes.shoes06', slot: 'shoes', name: 'Oxford', bases: MF, palette: 'shoes', defaultColor: 'preto' },
  // cabelos
  { id: 'hair.short01', slot: 'hair', name: 'Curto cacheado', bases: MF, palette: 'hair', defaultColor: 'preto' },
  { id: 'hair.short02', slot: 'hair', name: 'Curto clássico', bases: MF, palette: 'hair', defaultColor: 'castanho-escuro' },
  { id: 'hair.short03', slot: 'hair', name: 'Curto com franja lateral', bases: MF, palette: 'hair', defaultColor: 'castanho-escuro' },
  { id: 'hair.short04', slot: 'hair', name: 'Curto penteado para trás', bases: MF, palette: 'hair', defaultColor: 'preto' },
  { id: 'hair.bob01', slot: 'hair', name: 'Chanel assimétrico', bases: MF, palette: 'hair', defaultColor: 'castanho' },
  { id: 'hair.bob02', slot: 'hair', name: 'Chanel com franja', bases: MF, palette: 'hair', defaultColor: 'castanho' },
  { id: 'hair.ponytail01', slot: 'hair', name: 'Rabo de cavalo', bases: MF, palette: 'hair', defaultColor: 'castanho' },
  { id: 'hair.long01', slot: 'hair', name: 'Longo', bases: MF, palette: 'hair', defaultColor: 'castanho-escuro' },
  { id: 'hair.braid01', slot: 'hair', name: 'Trança lateral', bases: MF, palette: 'hair', defaultColor: 'preto' },
  { id: 'hair.afro01', slot: 'hair', name: 'Afro curto', bases: MF, palette: 'hair', defaultColor: 'preto' },
  // barba (só na base masculina; usa a cor do cabelo)
  { id: 'beard.wdg_scruffy_beard', slot: 'beard', name: 'Barba cheia', bases: M, palette: 'hair' },
  { id: 'beard.grinsegold_beard_sigmund_wip', slot: 'beard', name: 'Cavanhaque', bases: M, palette: 'hair' },
  // óculos
  { id: 'glasses.spamrakuen_tbm_glasses_frames_01', slot: 'glasses', name: 'Armação grossa', bases: MF, palette: null },
  { id: 'glasses.kwnet_at_optical_glasses', slot: 'glasses', name: 'Armação fina', bases: MF, palette: null },
  { id: 'glasses.spamrakuen_sagerfrogs_glasses_01', slot: 'glasses', name: 'Armação arredondada', bases: MF, palette: null },
  // headset (equipado automaticamente em atendimento)
  { id: 'headset.office', slot: 'headset', name: 'Headset de atendimento', bases: MF, palette: null },
];

const BY_ID = new Map(AVATAR_CATALOG.map((i) => [i.id, i]));
export const itemFor = (id: string) => BY_ID.get(id);
const colorsOf = (palette: CatalogItem['palette']) => (palette ? PALETTES[palette].map((c) => c.id) : []);
export const colorHex = (palette: keyof typeof PALETTES, id: string) => PALETTES[palette].find((c) => c.id === id)?.hex;

/** Peça padrão do slot para a base (usada quando a escolha não é compatível). */
export const SLOT_DEFAULTS: Record<AvatarBase, Partial<Record<AvatarSlot, string>>> = {
  male: { top: 'top.male_casualsuit03', bottom: 'bottom.male_casualsuit02', shoes: 'shoes.shoes02', hair: 'hair.short02', beard: 'none', glasses: 'none', headset: 'headset.office' },
  female: { top: 'top.male_casualsuit03', bottom: 'bottom.female_casualsuit01', shoes: 'shoes.shoes05', hair: 'hair.ponytail01', beard: 'none', glasses: 'none', headset: 'headset.office' },
};

/** Looks completos: pelo menos um casual e um corporativo por base. */
export const LOOKS: Array<{ id: string; name: string; base: AvatarBase; style: 'casual' | 'corporate'; config: Omit<AvatarConfig, 'v' | 'skin' | 'face' | 'headsetAlways'> }> = [
  { id: 'm-casual', name: 'Casual', base: 'male', style: 'casual', config: { base: 'male', hair: 'hair.short02', hairColor: 'castanho-escuro', beard: 'none', top: 'top.male_casualsuit03', topColor: 'azul', bottom: 'bottom.male_casualsuit02', bottomColor: 'jeans', shoes: 'shoes.shoes02', shoesColor: 'marrom', glasses: 'none', headset: 'headset.office' } },
  { id: 'm-casual-2', name: 'Casual com jaqueta', base: 'male', style: 'casual', config: { base: 'male', hair: 'hair.short01', hairColor: 'preto', beard: 'beard.wdg_scruffy_beard', top: 'top.male_casualsuit05', topColor: 'verde', bottom: 'bottom.male_casualsuit06', bottomColor: 'preto', shoes: 'shoes.shoes03', shoesColor: 'marrom', glasses: 'none', headset: 'headset.office' } },
  { id: 'm-corp', name: 'Corporativo', base: 'male', style: 'corporate', config: { base: 'male', hair: 'hair.short03', hairColor: 'castanho-escuro', beard: 'none', top: 'top.toigo_male_suit_tie_and_jacket', topColor: 'marinho', bottom: 'bottom.toigo_male_suit_tie_and_jacket', bottomColor: 'marinho', shoes: 'shoes.shoes01', shoesColor: 'preto', glasses: 'glasses.spamrakuen_tbm_glasses_frames_01', headset: 'headset.office' } },
  { id: 'm-corp-2', name: 'Paletó com gravata', base: 'male', style: 'corporate', config: { base: 'male', hair: 'hair.short04', hairColor: 'grisalho', beard: 'beard.grinsegold_beard_sigmund_wip', top: 'top.male_elegantsuit01', topColor: 'grafite', bottom: 'bottom.male_elegantsuit01', bottomColor: 'preto', shoes: 'shoes.shoes06', shoesColor: 'preto', glasses: 'none', headset: 'headset.office' } },
  { id: 'f-casual', name: 'Casual', base: 'female', style: 'casual', config: { base: 'female', hair: 'hair.ponytail01', hairColor: 'castanho', beard: 'none', top: 'top.male_casualsuit03', topColor: 'branco', bottom: 'bottom.female_casualsuit01', bottomColor: 'jeans', shoes: 'shoes.shoes05', shoesColor: 'preto', glasses: 'none', headset: 'headset.office' } },
  { id: 'f-casual-2', name: 'Casual com jaqueta', base: 'female', style: 'casual', config: { base: 'female', hair: 'hair.bob02', hairColor: 'preto', beard: 'none', top: 'top.male_casualsuit05', topColor: 'vinho', bottom: 'bottom.female_sportsuit01', bottomColor: 'preto', shoes: 'shoes.shoes02', shoesColor: 'cinza', glasses: 'glasses.spamrakuen_sagerfrogs_glasses_01', headset: 'headset.office' } },
  { id: 'f-corp', name: 'Corporativo', base: 'female', style: 'corporate', config: { base: 'female', hair: 'hair.bob01', hairColor: 'castanho-escuro', beard: 'none', top: 'top.toigo_female_suit', topColor: 'marinho', bottom: 'bottom.toigo_female_suit', bottomColor: 'marinho', shoes: 'shoes.shoes01', shoesColor: 'preto', glasses: 'none', headset: 'headset.office' } },
  { id: 'f-corp-2', name: 'Blazer e calça', base: 'female', style: 'corporate', config: { base: 'female', hair: 'hair.long01', hairColor: 'loiro', beard: 'none', top: 'top.toigo_female_suit_2', topColor: 'grafite', bottom: 'bottom.toigo_female_suit_2', bottomColor: 'preto', shoes: 'shoes.shoes06', shoesColor: 'preto', glasses: 'glasses.kwnet_at_optical_glasses', headset: 'headset.office' } },
];

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

/** Aparência padrão determinística por pessoa (colegas que ainda não personalizaram). */
export function defaultAvatar(seed: string): AvatarConfig {
  const h = hash(seed);
  const looks = LOOKS;
  const look = looks[h % looks.length];
  return { v: AVATAR_CATALOG_VERSION, skin: SKIN_TONES[(h >>> 4) % SKIN_TONES.length].id, face: FACES[(h >>> 8) % FACES.length].id, headsetAlways: false, ...look.config };
}

/**
 * Troca o corpo-base preservando o que for compatível; slots incompatíveis recebem a peça padrão da nova base.
 * Cores continuam se a nova peça usa a mesma paleta; senão vai a cor padrão da peça.
 */
export function switchBase(cfg: AvatarConfig, base: AvatarBase): AvatarConfig {
  const out: AvatarConfig = { ...cfg, base };
  for (const slot of AVATAR_SLOTS) {
    const id = (cfg as unknown as Record<string, string>)[slot];
    if (id === 'none') continue;
    const item = itemFor(id);
    if (item && item.bases.includes(base)) continue;
    const def = SLOT_DEFAULTS[base][slot] ?? 'none';
    (out as unknown as Record<string, string>)[slot] = def;
    const colorKey = `${slot}Color`;
    const defItem = itemFor(def);
    if (colorKey in out && defItem?.palette && !colorsOf(defItem.palette).includes((out as unknown as Record<string, string>)[colorKey])) {
      (out as unknown as Record<string, string>)[colorKey] = defItem.defaultColor ?? PALETTES[defItem.palette][0].id;
    }
  }
  return out;
}

/** Validação (servidor e cliente): só IDs do catálogo, compatíveis com a base, e cores da paleta da peça. */
export function validateAvatar(input: unknown): string[] {
  const c = input as AvatarConfig;
  const errors: string[] = [];
  if (!c || typeof c !== 'object') return ['Configuração ausente.'];
  if (c.v !== AVATAR_CATALOG_VERSION) errors.push(`Versão de catálogo ${String(c.v)} não suportada (atual: ${AVATAR_CATALOG_VERSION}).`);
  if (c.base !== 'male' && c.base !== 'female') errors.push('Corpo-base inválido.');
  if (!SKIN_TONES.some((s) => s.id === c.skin)) errors.push('Tom de pele fora do catálogo.');
  if (!FACES.some((f) => f.id === c.face)) errors.push('Rosto fora do catálogo.');
  if (typeof c.headsetAlways !== 'boolean') errors.push('headsetAlways deve ser verdadeiro ou falso.');
  const allowedNone: AvatarSlot[] = ['beard', 'glasses'];
  for (const slot of AVATAR_SLOTS) {
    const id = (c as unknown as Record<string, unknown>)[slot];
    if (typeof id !== 'string') {
      errors.push(`Slot ${slot} ausente.`);
      continue;
    }
    if (id === 'none') {
      if (!allowedNone.includes(slot)) errors.push(`O slot ${slot} não pode ficar vazio.`);
      continue;
    }
    const item = itemFor(id);
    if (!item || item.slot !== slot) errors.push(`Peça "${id}" não existe no slot ${slot}.`);
    else if (!item.bases.includes(c.base)) errors.push(`Peça "${item.name}" não é compatível com este corpo-base.`);
  }
  const colorSlots: Array<[AvatarSlot, keyof AvatarConfig]> = [['hair', 'hairColor'], ['top', 'topColor'], ['bottom', 'bottomColor'], ['shoes', 'shoesColor']];
  for (const [slot, key] of colorSlots) {
    const item = itemFor((c as unknown as Record<string, string>)[slot]);
    const color = c[key];
    if (item?.palette && (typeof color !== 'string' || !colorsOf(item.palette).includes(color))) errors.push(`Cor "${String(color)}" não permitida para ${item.name}.`);
  }
  const extra = Object.keys(c).filter((k) => !['v', 'base', 'skin', 'face', 'hair', 'hairColor', 'beard', 'top', 'topColor', 'bottom', 'bottomColor', 'shoes', 'shoesColor', 'glasses', 'headset', 'headsetAlways'].includes(k));
  if (extra.length) errors.push(`Campos desconhecidos: ${extra.join(', ')}.`);
  return errors;
}

/** Cor (hex) que o renderizador aplica a um slot. A barba usa a cor do cabelo. */
export function slotColorHex(cfg: AvatarConfig, slot: AvatarSlot): string | undefined {
  const item = itemFor((cfg as unknown as Record<string, string>)[slot]);
  if (!item?.palette) return undefined;
  const key = slot === 'beard' ? 'hairColor' : `${slot}Color`;
  return colorHex(item.palette, (cfg as unknown as Record<string, string>)[key]);
}
