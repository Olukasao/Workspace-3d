/**
 * Modo do ambiente virtual (global por empresa, escolhido só pelo administrador).
 *  - '3d': escritório tridimensional (padrão, o ambiente original do produto);
 *  - '2d': escritório 2D em pixel art (vista de cima em 3/4), com Phaser.
 * Só um motor gráfico fica ativo por vez em cada navegador: ao trocar, o anterior é desmontado e descarregado.
 */
export const WORKSPACE_MODES = ['3d', '2d'] as const;
export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];
export const DEFAULT_WORKSPACE_MODE: WorkspaceMode = '3d';
export const isWorkspaceMode = (v: unknown): v is WorkspaceMode => WORKSPACE_MODES.includes(v as WorkspaceMode);
export const WORKSPACE_MODE_LABEL: Record<WorkspaceMode, string> = { '3d': '3D: escritório tridimensional', '2d': '2D: escritório em pixel art' };

/** Estado do modo enviado a todos (snapshot e evento `mode`). `version` cresce a cada troca: eventos atrasados são ignorados. */
export interface WorkspaceState {
  mode: WorkspaceMode;
  version: number;
}
