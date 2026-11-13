/**
 * Galeria de personagens do estilo "Ara 3D Gen" para o Office 3D.
 * Este arquivo é a FONTE da galeria (versionada no projeto). Para gerar os GLB brutos, ele é copiado/rodado dentro do
 * clone do Ara 3D Gen (https://github.com/olatunde85/3d-gen, MIT; dados CC0 do MakeHuman) por tools/avatars-ara/build.mjs.
 *
 * Cada personagem é 100% definido por parâmetros do Ara (reproduzível): corpo, etnia, cabelo, roupa, sapato.
 * Sem animações embutidas (o escritório anima por IK procedural) e sem acessórios de mão.
 *
 * Roupas: evitamos as camisetas do pacote de sistema do MakeHuman que trazem o logotipo do projeto estampado
 * (male_casualsuit02/04/06, female_casualsuit01/02, female_sportsuit01) e usamos as peças procedurais do Ara nos casuais.
 */
import { DEFAULT_PARAMS, PRESETS, type HumanParams } from '../src/core/params';

export interface AraEntry {
  id: string;
  name: string;
  gender: 'male' | 'female';
  style: 'corporate' | 'casual';
  params: Partial<HumanParams>;
}

const P = (name: string): Partial<HumanParams> => ({ ...PRESETS[name] });
const none = { carry: 'none', weapon: 'none', accessories: [] as string[] } as const;
const suiting = (c: string, c2: string) => ({ pattern: 'suiting', color: c, color2: c2 }) as const;
const leather = (c: string, c2: string) => ({ pattern: 'nappa', color: c, color2: c2 }) as const;

export const GALLERY: AraEntry[] = [
  { id: 'ara-m1', name: 'Terno e gravata', gender: 'male', style: 'corporate', params: { ...P('The Corporate High-Flier'), ...none, accessories: ['watch_gold'] } },
  { id: 'ara-m2', name: 'Paletó clássico', gender: 'male', style: 'corporate', params: { gender: 1, age: 0.55, muscle: 0.5, weight: 0.5, height: 0.6, african: 0.8, asian: 0.1, caucasian: 0.1, eyes: 'blackbrown', hair: 'short01', hairTint: '#1c1713', outfit: 'male_elegantsuit01', shoes: 'oxfords', facialHair: 'stubble', beardColor: '#16110d', garmentStyles: { oxfords: leather('#2a1a10', '#1a100a') }, ...none } },
  { id: 'ara-m3', name: 'Camisa listrada', gender: 'male', style: 'casual', params: { gender: 1, age: 0.45, muscle: 0.45, weight: 0.45, height: 0.5, african: 0.05, asian: 0.8, caucasian: 0.15, eyes: 'darkbrown', hair: 'short02', hairTint: '#1a1410', outfit: 'male_casualsuit03', shoes: 'shoes03', ...none } },
  { id: 'ara-m4', name: 'Jaqueta casual', gender: 'male', style: 'casual', params: { gender: 1, age: 0.5, muscle: 0.55, weight: 0.55, height: 0.55, african: 0.1, asian: 0.1, caucasian: 0.8, eyes: 'green', hair: 'short03', hairTint: '#6b4a2e', outfit: 'male_casualsuit05', shoes: 'shoes06', facialHair: 'stubble', beardColor: '#3b2a1c', ...none } },
  { id: 'ara-m5', name: 'Camisa azul e jeans', gender: 'male', style: 'casual', params: { gender: 1, age: 0.42, muscle: 0.6, weight: 0.5, height: 0.5, african: 0.9, asian: 0.05, caucasian: 0.05, eyes: 'blackbrown', hair: 'afro01', hairTint: '#120d0a', outfit: 'male_casualsuit01', shoes: 'shoes02', ...none } },
  { id: 'ara-m6', name: 'Terno sênior', gender: 'male', style: 'corporate', params: { gender: 1, age: 0.82, muscle: 0.4, weight: 0.55, height: 0.5, african: 0.1, asian: 0.1, caucasian: 0.8, eyes: 'grey', hair: 'short04', hairTint: '#b9b9b9', outfit: 'male_elegantsuit01', shoes: 'oxfords', facialHair: 'full_beard', beardColor: '#b0b0b0', garmentStyles: { oxfords: leather('#1a1410', '#0f0b08') }, ...none } },
  { id: 'ara-m7', name: 'Camisa e calça', gender: 'male', style: 'casual', params: { gender: 1, age: 0.4, muscle: 0.55, weight: 0.45, height: 0.6, african: 0.3, asian: 0.2, caucasian: 0.5, eyes: 'brown', hair: 'short01', hairTint: '#2a1e16', outfit: 'none', top: 'camp_shirt', bottom: 'trousers', shoes: 'loafers', garmentStyles: { camp_shirt: { pattern: 'linen', color: '#cfd9e6' }, trousers: { pattern: 'solid', color: '#3b4a5c' }, loafers: leather('#5a3a22', '#3a2414') }, ...none } },
  { id: 'ara-m8', name: 'Terno cinza', gender: 'male', style: 'corporate', params: { gender: 1, age: 0.48, muscle: 0.45, weight: 0.5, height: 0.55, african: 0.05, asian: 0.55, caucasian: 0.4, eyes: 'darkbrown', hair: 'short04', hairTint: '#1a1410', outfit: 'set_suit_tie', shoes: 'loafers', garmentStyles: { set_suit_tie: suiting('#6b7280', '#7b8392'), suit_shirt_tie: { pattern: 'solid', color: '#e8edf5', color2: '#1e3a5f' }, loafers: leather('#3a2414', '#24160c') }, ...none } },

  { id: 'ara-f1', name: 'Blusa e saia', gender: 'female', style: 'corporate', params: { gender: 0, age: 0.6, muscle: 0.45, weight: 0.5, height: 0.6, african: 0.8, asian: 0.1, caucasian: 0.1, eyes: 'blackbrown', eyebrows: 'eyebrow001', eyelashes: 'eyelashes03', hair: 'bob02', hairTint: '#1a1410', outfit: 'female_elegantsuit01', shoes: 'heels', garmentStyles: { heels: { pattern: 'patent', color: '#1c1c1f' } }, ...none } },
  { id: 'ara-f2', name: 'Tailleur bege', gender: 'female', style: 'corporate', params: { ...P('The Female Executive'), ...none, accessories: [] } },
  { id: 'ara-f3', name: 'Tailleur marinho', gender: 'female', style: 'corporate', params: { gender: 0, age: 0.45, muscle: 0.4, weight: 0.45, height: 0.5, african: 0.05, asian: 0.1, caucasian: 0.85, eyes: 'blue', eyebrows: 'eyebrow006', eyelashes: 'eyelashes02', hair: 'ponytail01', hairTint: '#8a5a32', outfit: 'set_pantsuit', shoes: 'heels', garmentStyles: { set_pantsuit: suiting('#26324a', '#34425f'), silk_blouse: { pattern: 'satin', color: '#f1ece4' }, heels: { pattern: 'patent', color: '#16161a' } }, ...none } },
  { id: 'ara-f4', name: 'Blusa e calça', gender: 'female', style: 'casual', params: { gender: 0, age: 0.45, muscle: 0.4, weight: 0.5, height: 0.5, african: 0.05, asian: 0.85, caucasian: 0.1, eyes: 'darkbrown', eyebrows: 'eyebrow006', eyelashes: 'eyelashes02', hair: 'long01', hairTint: '#15110e', outfit: 'none', top: 'silk_blouse', bottom: 'trousers', shoes: 'loafers', garmentStyles: { silk_blouse: { pattern: 'satin', color: '#3a8f94' }, trousers: { pattern: 'solid', color: '#2b2f38' }, loafers: leather('#2a1a10', '#1a100a') }, ...none } },
  { id: 'ara-f5', name: 'Camiseta e jeans', gender: 'female', style: 'casual', params: { gender: 0, age: 0.4, muscle: 0.5, weight: 0.45, height: 0.55, african: 0.7, asian: 0.1, caucasian: 0.2, eyes: 'blackbrown', eyebrows: 'eyebrow006', eyelashes: 'eyelashes03', hair: 'braid01', hairTint: '#120d0a', outfit: 'none', top: 'camp_shirt', bottom: 'trousers', shoes: 'sneakers', garmentStyles: { camp_shirt: { pattern: 'linen', color: '#e3c168' }, trousers: { pattern: 'solid', color: '#3a5a8a' } }, ...none } },
  { id: 'ara-f6', name: 'Tailleur cinza', gender: 'female', style: 'corporate', params: { gender: 0, age: 0.5, muscle: 0.4, weight: 0.5, height: 0.55, african: 0.1, asian: 0.1, caucasian: 0.8, eyes: 'brown', eyebrows: 'eyebrow006', eyelashes: 'eyelashes03', hair: 'bob01', hairTint: '#2a1e16', outfit: 'set_pantsuit', shoes: 'heels', garmentStyles: { set_pantsuit: suiting('#6b7280', '#7b8392'), silk_blouse: { pattern: 'satin', color: '#f4f1ea' }, heels: { pattern: 'patent', color: '#2a2a2f' } }, ...none } },
  { id: 'ara-f7', name: 'Executiva sênior', gender: 'female', style: 'corporate', params: { gender: 0, age: 0.78, muscle: 0.35, weight: 0.5, height: 0.45, african: 0.1, asian: 0.2, caucasian: 0.7, eyes: 'grey', eyebrows: 'eyebrow006', eyelashes: 'eyelashes01', hair: 'bob02', hairTint: '#c9c9c9', outfit: 'set_pantsuit', shoes: 'heels', garmentStyles: { set_pantsuit: suiting('#4a5568', '#5a6578'), silk_blouse: { pattern: 'satin', color: '#ffffff' }, heels: { pattern: 'patent', color: '#1c1c1f' } }, ...none } },
  { id: 'ara-f8', name: 'Casual jovem', gender: 'female', style: 'casual', params: { gender: 0, age: 0.38, muscle: 0.4, weight: 0.45, height: 0.5, african: 0.4, asian: 0.1, caucasian: 0.5, eyes: 'brown', eyebrows: 'eyebrow006', eyelashes: 'eyelashes02', hair: 'long01', hairTint: '#3b2a1c', outfit: 'none', top: 'camp_shirt', bottom: 'trousers', shoes: 'sneakers', garmentStyles: { camp_shirt: { pattern: 'linen', color: '#a9c4e0' }, trousers: { pattern: 'solid', color: '#d8cdb8' } }, ...none } },
];

/** Parâmetros completos de saída: sem animações, rig de jogo (nomes Mixamo) com ossos de rosto, pose A. */
export function paramsFor(e: AraEntry, detail: 'low' | 'medium' | 'high' = 'medium'): HumanParams {
  return { ...DEFAULT_PARAMS, ...e.params, name: e.id, seed: 1, detail, rig: 'game', faceBones: true, restPose: 'A', animations: false } as HumanParams;
}
