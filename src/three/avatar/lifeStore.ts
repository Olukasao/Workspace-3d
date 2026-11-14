/**
 * Vida autônoma no 3D: quando existe uma simulação (versão estática de demonstração), ela escreve aqui, a cada quadro, onde cada
 * colaborador está e o que faz. O avatar lê esta tabela dentro do próprio useFrame (sem passar pelo React). Vazia = comportamento
 * normal: todo mundo fica sentado no assento fixo da própria mesa.
 */
import type { AvatarActivity } from './rig';

export interface LifePose {
  x: number;
  z: number;
  rotY: number;
  mode: 'sit' | 'stand';
  activity: AvatarActivity;
  /** m/s; > 0 = caminhando */
  speed: number;
  speaking: boolean | null;
}

export const lifePoses = new Map<string, LifePose>();
