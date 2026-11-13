/**
 * Gerenciador do ambiente virtual: monta, desmonta e alterna os motores gráficos.
 *  - o modo (2D ou 3D) é global e vem do servidor; o usuário comum não escolhe;
 *  - cada modo é um bloco carregado sob demanda (import dinâmico): o motor que não está em uso não é baixado nem executado;
 *  - na troca, o ambiente antigo é desmontado (efeitos de saída, loops e listeners param), os recursos gráficos dele são
 *    liberados e só então o novo é montado. Eventos atrasados ou repetidos não causam troca (versão do modo).
 *  Em qualquer momento há no máximo um motor ativo (ver `window.__workspace.report()`).
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useLive } from '../live';
import type { WorkspaceMode } from '../../shared/workspace';
import { ENGINE_PAGES, type EnginePage, type ModeProps } from './types';

const Mode3D = lazy(() => import('./modes/mode3d/Mode3D'));
const Mode2D = lazy(() => import('./modes/mode2d/Mode2D'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Libera o que o modo que saiu deixou na memória e na GPU. Só importa o módulo de descarga se aquele motor chegou a ser usado. */
async function disposeMode(mode: WorkspaceMode) {
  if (mode === '3d') (await import('./modes/mode3d/dispose')).disposeThreeWorld();
  else (await import('./modes/mode2d/dispose')).disposePhaserWorld();
}

/** `page` é a tela atual do aplicativo (qualquer uma): só as que usam motor gráfico montam um ambiente. */
export function WorkspaceManager({ page, ...rest }: Omit<ModeProps, 'onReady' | 'page'> & { page: string }) {
  const props = { ...rest, page: page as EnginePage };
  const mode = useLive((s) => s.workspace.mode);
  const known = useLive((s) => s.workspaceKnown);
  const switching = useLive((s) => s.switching);
  const [mounted, setMounted] = useState<WorkspaceMode | null>(known ? mode : null);
  const current = useRef<WorkspaceMode | null>(known ? mode : null);
  const generation = useRef(0);

  // rede de segurança: se o tempo real demorar, pergunta o modo direto ao servidor (o 3D nunca é baixado "por padrão")
  useEffect(() => {
    if (known) return;
    let dead = false;
    const t = setTimeout(() => {
      api.get<{ mode: WorkspaceMode; version: number }>('/api/workspace').then((w) => !dead && useLive.getState().setWorkspace(w), () => undefined);
    }, 2500);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [known]);

  useEffect(() => {
    if (!known) return;
    if (current.current === null) {
      current.current = mode;
      setMounted(mode);
      return;
    }
    if (current.current === mode) return;
    const from = current.current;
    current.current = mode;
    const gen = ++generation.current; // uma troca mais nova invalida a anterior (sem montar o ambiente errado)
    useLive.getState().setSwitching(true);
    setMounted(null); // desmonta o motor atual: loops, listeners e o canvas saem aqui
    void (async () => {
      await sleep(150); // os efeitos de saída rodam e o navegador solta o contexto gráfico
      await disposeMode(from);
      if (gen === generation.current) setMounted(mode);
    })();
  }, [mode, known]);

  const isEnginePage = ENGINE_PAGES.includes(props.page);
  const ready = () => useLive.getState().setSwitching(false);
  // fora das telas com motor não há o que esperar: a transição termina assim que o ambiente novo é o vigente
  useEffect(() => {
    if (switching && mounted === mode && !isEnginePage) ready();
  }, [switching, mounted, mode, isEnginePage]);
  // rede de segurança: a tela de transição nunca fica presa
  useEffect(() => {
    if (!switching) return;
    const t = setTimeout(ready, 20000);
    return () => clearTimeout(t);
  }, [switching]);

  return (
    <>
      {isEnginePage && !mounted && !switching && <div className="loading">Carregando o ambiente…</div>}
      {isEnginePage && mounted && (
        <Suspense fallback={<div className="loading">Carregando o ambiente {mounted === '2d' ? '2D' : '3D'}…</div>}>
          {mounted === '3d' ? <Mode3D {...props} onReady={ready} /> : <Mode2D {...props} onReady={ready} />}
        </Suspense>
      )}
      {switching && (
        <div className="mode-overlay" role="status" aria-live="polite" data-testid="mode-overlay">
          <div className="mode-overlay-box">
            <div className="spinner" aria-hidden />
            <b>O ambiente virtual está mudando para {mode === '2d' ? '2D' : '3D'}.</b>
            <span>Você continua conectado. Só um momento…</span>
          </div>
        </div>
      )}
    </>
  );
}
