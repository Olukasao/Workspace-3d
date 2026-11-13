/**
 * Clique numa TV do escritório 2D: mostra o que está na tela dela (aviso do dia, equipe do atendimento ou um painel) e leva à área
 * de acesso remoto para gerenciar o dispositivo que a alimenta.
 */
import { useMemo } from 'react';
import { useLive } from '../../../live';
import { Dialog } from '../../../ui';
import type { TvContent } from './net2d';
import { teamOf } from './team';

export function TvDialog({ content, onlineIds, onRemote, onClose }: { content: TvContent | undefined; onlineIds: string[]; onRemote: () => void; onClose: () => void }) {
  const people = useLive((s) => s.people);
  const team = useMemo(() => teamOf(onlineIds, people), [onlineIds, people]);
  return (
    <Dialog
      title={content?.title ?? 'TV'}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onRemote} data-testid="tv-open-remote">Gerenciar o dispositivo (acesso remoto)</button>
          <button className="btn primary" onClick={onClose} data-testid="tv-view-close">Fechar</button>
        </>
      }
    >
      {!content && <div className="notice info" data-testid="tv-empty-content">Esta TV ainda não tem conteúdo na tela. O administrador define o aviso, a equipe ou o painel no editor do escritório.</div>}
      {content?.kind === 'notice' && (
        <div className="tv-notice" data-testid="tv-notice">
          {content.body.split('\n').map((l, i) => <p key={i}>{l}</p>)}
        </div>
      )}
      {content?.kind === 'queue' && (
        <div data-testid="tv-queue">
          <div className="tv-counts">
            <div><b data-testid="tv-count-free">{team.free.length}</b><span>Disponíveis</span></div>
            <div><b data-testid="tv-count-call">{team.call.length}</b><span>Em atendimento</span></div>
            <div><b data-testid="tv-count-away">{team.away.length}</b><span>Ausentes</span></div>
          </div>
          {([['Em atendimento', team.call], ['Disponíveis', team.free], ['Ausentes', team.away]] as const).map(([label, names]) => names.length > 0 && <p key={label}><b>{label}:</b> {names.join(', ')}</p>)}
          <p className="muted">Quem está com o Workspace aberto e aparece no mapa. A fila de espera do sistema de atendimento aparece aqui quando esse vínculo existir.</p>
        </div>
      )}
      {content?.kind === 'dashboard' && content.url && (
        <>
          <iframe className="preview" style={{ height: 420 }} src={content.url} title={content.title} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" data-testid="tv-dashboard" />
          {/^https:/.test(content.url) && <a className="btn" href={content.url} target="_blank" rel="noopener noreferrer">Abrir em nova aba</a>}
        </>
      )}
      {content?.body && content.kind !== 'notice' && <p className="muted">{content.body}</p>}
    </Dialog>
  );
}
