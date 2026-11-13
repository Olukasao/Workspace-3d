/**
 * Registro dos motores gráficos (Three.js no 3D, Phaser no 2D) e diagnóstico do que está ativo.
 * Regra do produto: só UM motor ativo por sessão. Este módulo não importa three nem phaser (fica no pacote principal).
 * `window.__workspace.report()` serve aos testes no navegador e à conferência pelo DevTools.
 */
import { liveHandlerCount } from '../live';
import type { WorkspaceMode } from '../../shared/workspace';

export type EngineName = 'three' | 'phaser';
const MODE_ENGINE: Record<WorkspaceMode, EngineName> = { '3d': 'three', '2d': 'phaser' };
export const engineOf = (m: WorkspaceMode) => MODE_ENGINE[m];

const active = new Map<EngineName, number>(); // quantas instâncias de cada motor estão montadas
const counters = { starts: { three: 0, phaser: 0 }, stops: { three: 0, phaser: 0 } };
const extra: { phaserGames?: () => number } = {};

/** Um motor começou a rodar (montou). Devolve a função que registra a saída; chame-a ao desmontar. */
export function engineStarted(name: EngineName): () => void {
  active.set(name, (active.get(name) ?? 0) + 1);
  counters.starts[name]++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    active.set(name, Math.max(0, (active.get(name) ?? 1) - 1));
    counters.stops[name]++;
  };
}
export const registerPhaserCounter = (fn: () => number) => {
  extra.phaserGames = fn;
};

export function workspaceReport() {
  const canvases = [...document.querySelectorAll('canvas')].map((c) => c.closest('[data-engine]')?.getAttribute('data-engine') ?? 'outro');
  const w = window as unknown as { __office3d?: unknown };
  return {
    activeEngines: [...active.entries()].filter(([, n]) => n > 0).map(([k]) => k),
    instances: Object.fromEntries(active),
    ...counters,
    canvases,
    phaserGames: extra.phaserGames?.() ?? 0,
    threeDiagnostics: w.__office3d !== undefined, // o gancho de diagnóstico do 3D (some quando o 3D sai)
    liveHandlers2d: liveHandlerCount(),
  };
}

if (typeof window !== 'undefined') (window as unknown as { __workspace?: unknown }).__workspace = { report: workspaceReport };
