/**
 * Editor 2D → TV selecionada: o que ela mostra na tela do mapa. Aviso do dia (texto), equipe do atendimento (ao vivo, a partir da
 * presença) ou painel (endereço validado no servidor). Vale na hora, sem publicar o layout, e chega ao mapa de todos.
 */
import { useEffect, useState } from 'react';
import { api, errorText } from '../../../api';
import type { TvContent } from './net2d';

type Kind = '' | TvContent['kind'];

export function TvContentForm({ officeId, objectId, current, onSaved, onError }: { officeId: string; objectId: string; current: TvContent | undefined; onSaved: (c: TvContent | null) => void; onError: (text: string) => void }) {
  const [kind, setKind] = useState<Kind>(current?.kind ?? '');
  const [title, setTitle] = useState(current?.title ?? '');
  const [body, setBody] = useState(current?.body ?? '');
  const [url, setUrl] = useState(current?.url ?? '');
  const [busy, setBusy] = useState(false);

  // outra TV selecionada (ou conteúdo mudou em outro lugar): recomeça do que está salvo
  useEffect(() => {
    setKind(current?.kind ?? '');
    setTitle(current?.title ?? '');
    setBody(current?.body ?? '');
    setUrl(current?.url ?? '');
  }, [objectId, current?.kind, current?.title, current?.body, current?.url]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/api/admin/office2d/${officeId}/objects/${objectId}/tv-content`, kind ? { kind, title, body, url: kind === 'dashboard' ? url : undefined } : { kind: null });
      onSaved(kind ? { objectId, kind, title: title.trim(), body: body.trim(), url: kind === 'dashboard' ? url : undefined } : null);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" data-testid="tv-content-form">
      <label className="muted">O que a TV mostra
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} data-testid="tv-kind">
          <option value="">— nada —</option>
          <option value="notice">Aviso do dia</option>
          <option value="queue">Equipe do atendimento (ao vivo)</option>
          <option value="dashboard">Painel</option>
        </select>
      </label>
      {kind && (
        <label className="muted">Título
          <input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} data-testid="tv-title" />
        </label>
      )}
      {(kind === 'notice' || kind === 'queue') && (
        <label className="muted">{kind === 'notice' ? 'Texto do aviso' : 'Observação (opcional)'}
          <textarea className="input" rows={3} value={body} maxLength={500} onChange={(e) => setBody(e.target.value)} data-testid="tv-body" />
        </label>
      )}
      {kind === 'dashboard' && (
        <label className="muted">Endereço do painel (https de host autorizado)
          <input className="input" value={url} maxLength={300} onChange={(e) => setUrl(e.target.value)} data-testid="tv-url" />
        </label>
      )}
      <button className="btn small primary" disabled={busy || (!!kind && !title.trim())} onClick={() => void save()} data-testid="tv-save">{busy ? 'Salvando…' : 'Salvar conteúdo da TV'}</button>
    </div>
  );
}
