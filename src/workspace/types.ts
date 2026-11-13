import type { SessionUser } from '../../shared/types';

/** Telas que usam motor gráfico: mudam conforme o modo (3D: cena Three.js; 2D: cena Phaser). As demais não dependem do modo. */
export type EnginePage = 'ops' | 'editor' | 'avatar';
export const ENGINE_PAGES: readonly string[] = ['ops', 'editor', 'avatar'];

export interface ModeProps {
  page: EnginePage;
  officeId: string | null;
  user: SessionUser;
  /** muda quando o mapa 3D precisa recarregar (o editor 3D publicou) */
  opsKey: number;
  onEdit: (objectId: string) => void;
  onOfficeChanged: () => void;
  /** o ambiente montou e está pronto: some a tela de transição */
  onReady: () => void;
}
