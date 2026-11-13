/**
 * Estilo de avatar "Ara 3D Gen" (galeria de personagens prontos) e a escolha do estilo por empresa.
 * O estilo MakeHuman (editor de peças, shared/avatarCatalog.ts) continua no projeto, desativado por padrão.
 * A lista abaixo precisa bater com tools/avatars-ara/gallery.ts (conferido em tests/live.test.ts contra o manifesto distribuído).
 */
import { normalizeAraParams, type AraParams } from './araCustom';
import { AVATAR_CATALOG_VERSION, defaultAvatar, validateAvatar, type AvatarConfig } from './avatarCatalog';

export const AVATAR_STYLES = ['ara3d', 'makehuman'] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];
/** Estilo ativo quando a empresa nunca escolheu. */
export const DEFAULT_AVATAR_STYLE: AvatarStyle = 'ara3d';
export const AVATAR_STYLE_LABEL: Record<AvatarStyle, string> = { ara3d: 'Ara 3D Gen (personagens prontos)', makehuman: 'MakeHuman (editor de peças)' };

export interface AraCharacterInfo { id: string; name: string; gender: 'male' | 'female'; style: 'corporate' | 'casual' }
export const ARA_CHARACTERS: readonly AraCharacterInfo[] = [
  { id: 'ara-m1', name: 'Terno e gravata', gender: 'male', style: 'corporate' },
  { id: 'ara-m2', name: 'Paletó clássico', gender: 'male', style: 'corporate' },
  { id: 'ara-m3', name: 'Camisa listrada', gender: 'male', style: 'casual' },
  { id: 'ara-m4', name: 'Jaqueta casual', gender: 'male', style: 'casual' },
  { id: 'ara-m5', name: 'Camisa azul e jeans', gender: 'male', style: 'casual' },
  { id: 'ara-m6', name: 'Terno sênior', gender: 'male', style: 'corporate' },
  { id: 'ara-m7', name: 'Camisa e calça', gender: 'male', style: 'casual' },
  { id: 'ara-m8', name: 'Terno cinza', gender: 'male', style: 'corporate' },
  { id: 'ara-f1', name: 'Blusa e saia', gender: 'female', style: 'corporate' },
  { id: 'ara-f2', name: 'Tailleur bege', gender: 'female', style: 'corporate' },
  { id: 'ara-f3', name: 'Tailleur marinho', gender: 'female', style: 'corporate' },
  { id: 'ara-f4', name: 'Blusa e calça', gender: 'female', style: 'casual' },
  { id: 'ara-f5', name: 'Camiseta e jeans', gender: 'female', style: 'casual' },
  { id: 'ara-f6', name: 'Tailleur cinza', gender: 'female', style: 'corporate' },
  { id: 'ara-f7', name: 'Executiva sênior', gender: 'female', style: 'corporate' },
  { id: 'ara-f8', name: 'Casual jovem', gender: 'female', style: 'casual' },
];

/** Aparência no estilo Ara 3D Gen, forma 1: um personagem pronto da galeria (padrão de quem ainda não personalizou). */
export interface AraPresetConfig {
  v: typeof AVATAR_CATALOG_VERSION;
  style: 'ara3d';
  character: string;
  headsetAlways: boolean;
}
/**
 * Forma 2: personagem personalizado no editor. `custom` são os parâmetros (a fonte da verdade); `model` é o identificador do
 * modelo 3D que o SERVIDOR gerou a partir deles (o cliente não escolhe: o servidor ignora o que vier e recalcula).
 */
export interface AraCustomConfig {
  v: typeof AVATAR_CATALOG_VERSION;
  style: 'ara3d';
  custom: AraParams;
  model?: string;
  headsetAlways: boolean;
}
export type AraAvatarConfig = AraPresetConfig | AraCustomConfig;
export type AnyAvatarConfig = AvatarConfig | AraAvatarConfig;
export const isAraCustom = (c: unknown): c is AraCustomConfig => isAraConfig(c) && 'custom' in (c as object);
export const isAraPreset = (c: unknown): c is AraPresetConfig => isAraConfig(c) && 'character' in (c as object);
export const isAraConfig = (c: unknown): c is AraAvatarConfig => !!c && typeof c === 'object' && (c as { style?: unknown }).style === 'ara3d';
export const styleOfConfig = (c: AnyAvatarConfig): AvatarStyle => (isAraConfig(c) ? 'ara3d' : 'makehuman');
export const isAvatarStyle = (s: unknown): s is AvatarStyle => AVATAR_STYLES.includes(s as AvatarStyle);

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

/** Personagem padrão determinístico por pessoa (o gênero não é deduzido do nome). */
export function defaultAraAvatar(seed: string): AraPresetConfig {
  return { v: AVATAR_CATALOG_VERSION, style: 'ara3d', character: ARA_CHARACTERS[hash(seed) % ARA_CHARACTERS.length].id, headsetAlways: false };
}

export function validateAraAvatar(input: unknown): string[] {
  const c = input as Record<string, unknown>;
  if (!c || typeof c !== 'object') return ['Configuração ausente.'];
  const errors: string[] = [];
  if (c.v !== AVATAR_CATALOG_VERSION) errors.push(`Versão de catálogo ${String(c.v)} não suportada (atual: ${AVATAR_CATALOG_VERSION}).`);
  if (c.style !== 'ara3d') errors.push('Estilo inválido.');
  if (typeof c.headsetAlways !== 'boolean') errors.push('headsetAlways deve ser verdadeiro ou falso.');
  const custom = 'custom' in c;
  if (custom && 'character' in c) errors.push('Use "character" (personagem pronto) ou "custom" (personalizado), não os dois.');
  else if (custom) {
    errors.push(...normalizeAraParams(c.custom).errors);
    if (c.model !== undefined && (typeof c.model !== 'string' || !/^[a-f0-9]{16}$/.test(c.model))) errors.push('Identificador de modelo inválido.');
  } else if (!ARA_CHARACTERS.some((x) => x.id === c.character)) errors.push('Personagem fora da galeria.');
  const allowed = custom ? ['v', 'style', 'custom', 'model', 'headsetAlways'] : ['v', 'style', 'character', 'headsetAlways'];
  const extra = Object.keys(c).filter((k) => !allowed.includes(k));
  if (extra.length) errors.push(`Campos desconhecidos: ${extra.join(', ')}.`);
  return errors;
}

/** Valida a configuração para o estilo ativo da empresa (uma configuração de outro estilo é recusada). */
export function validateForStyle(style: AvatarStyle, input: unknown): string[] {
  return style === 'ara3d' ? validateAraAvatar(input) : validateAvatar(input);
}

export function defaultForStyle(style: AvatarStyle, seed: string): AnyAvatarConfig {
  return style === 'ara3d' ? defaultAraAvatar(seed) : defaultAvatar(seed);
}
