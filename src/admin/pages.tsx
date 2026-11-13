import type { AvatarStyle } from '../../shared/avatarAra';
import { useCallback, useEffect, useState } from 'react';
import type { AuditEntry, IntegrationStatus } from '../../shared/types';
import { api, errorText } from '../api';
import { dateTime, toast } from '../ui';

const RESULT_CLASS: Record<string, string> = { completed: 'ok', registered: 'ok', launch_ready: 'ok', dialog_opened: 'info', queued: 'info', sent: 'info', conflict: 'warn', rejected: 'warn', failed: 'bad', down: 'bad', up: 'ok', removed: 'neutral' };

export function AuditPage() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api.get<{ entries: AuditEntry[] }>('/api/admin/audit?limit=150').then((r) => setRows(r.entries), (e) => setErr(errorText(e))), []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <main className="page">
      <div className="page-inner">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2>Trilha de auditoria</h2>
            <p className="muted">Ator, alvo, horário, resultado, modo (demonstração ou real) e identificador de correlação de cada ação. Conteúdo de documentos e senhas nunca é registrado.</p>
          </div>
          <button className="btn" onClick={() => void load()}>Atualizar</button>
        </div>
        {err && <div className="notice bad">{err}</div>}
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="table">
            <thead><tr><th>Quando</th><th>Ator</th><th>Ação</th><th>Alvo</th><th>Resultado</th><th>Modo</th><th>Correlação</th></tr></thead>
            <tbody>
              {rows?.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{dateTime(r.createdAt)}</td>
                  <td>{r.actorName}<br /><span className="muted">{r.actorRole}</span></td>
                  <td className="mono">{r.action}</td>
                  <td>{r.targetType} <span className="mono">{r.targetId}</span>{r.objectId && r.objectId !== r.targetId ? <><br /><span className="muted">objeto {r.objectId}</span></> : null}</td>
                  <td><span className={`chip ${RESULT_CLASS[r.result] ?? 'neutral'}`}>{r.result}</span></td>
                  <td>{r.mode === 'demo' ? <span className="chip demo">demo</span> : <span className="chip info">real</span>}</td>
                  <td className="mono">{r.correlationId.slice(0, 13)}</td>
                </tr>
              ))}
              {rows?.length === 0 && <tr><td colSpan={7} className="muted">Nenhum registro ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

const STATE: Record<IntegrationStatus['state'], [string, string]> = { ok: ['ok', 'Disponível'], not_configured: ['neutral', 'Não configurado'], unavailable: ['bad', 'Indisponível'] };

/** Opção do administrador: estilo dos avatares da empresa. A troca vale ao vivo para quem está com o escritório aberto. */
function AvatarStyleCard() {
  const [info, setInfo] = useState<{ style: AvatarStyle; options: Array<{ id: AvatarStyle; label: string }> } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<{ style: AvatarStyle; options: Array<{ id: AvatarStyle; label: string }> }>('/api/admin/avatar-style').then(setInfo, (e) => toast(errorText(e)));
  }, []);
  const choose = async (style: AvatarStyle) => {
    if (!info || info.style === style) return;
    setBusy(true);
    try {
      setInfo(await api.put<{ style: AvatarStyle; options: Array<{ id: AvatarStyle; label: string }> }>('/api/admin/avatar-style', { style }));
      toast('Estilo dos avatares trocado. Quem está com o escritório aberto já vê a mudança.');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card" data-testid="avatar-style-card">
      <h3>Estilo dos avatares</h3>
      <p className="muted">Vale para a empresa toda. Trocar não apaga nada: cada pessoa guarda a escolha que fez em cada estilo e volta a ela se o estilo anterior for reativado.</p>
      <div className="tabs" role="radiogroup" aria-label="Estilo dos avatares">
        {info?.options.map((o) => (
          <button key={o.id} role="radio" aria-checked={info.style === o.id} aria-pressed={info.style === o.id} disabled={busy} data-avatar-style={o.id} onClick={() => void choose(o.id)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

export function IntegrationsPage({ demoMode }: { demoMode: boolean }) {
  const [list, setList] = useState<IntegrationStatus[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ integrations: IntegrationStatus[] }>('/api/integrations/status').then((r) => setList(r.integrations), (e) => setErr(errorText(e)));
  }, []);
  const toggle = async (id: string, down: boolean) => {
    try {
      const r = await api.post<{ integrations: IntegrationStatus[] }>('/api/demo/outage', { service: id, down });
      setList(r.integrations);
      toast(down ? 'Falha simulada ativada. Veja o modo Operação.' : 'Serviço restabelecido.');
    } catch (e) {
      toast(errorText(e));
    }
  };
  return (
    <main className="page">
      <div className="page-inner">
        <div>
          <h2>Integrações</h2>
          <p className="muted">Estado de cada conector visto pelo servidor. Variáveis e endpoints em <span className="mono">docs/integrations.md</span>; segredos ficam só no servidor.</p>
        </div>
        {err && <div className="notice bad">{err}</div>}
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead><tr><th>Serviço</th><th>Modo</th><th>Estado</th><th>Detalhe</th>{demoMode && <th>Teste</th>}</tr></thead>
            <tbody>
              {list?.map((i) => (
                <tr key={i.id}>
                  <td><b>{i.label}</b></td>
                  <td>{i.mode === 'demo' ? <span className="chip demo">demonstração</span> : <span className="chip info">real</span>}</td>
                  <td><span className={`chip ${STATE[i.state][0]}`}>{STATE[i.state][1]}</span></td>
                  <td className="muted">{i.detail}</td>
                  {demoMode && <td>{i.id !== 'cad' && <button className="btn small" onClick={() => void toggle(i.id, i.state !== 'unavailable')} data-outage={i.id}>{i.state === 'unavailable' ? 'Restabelecer' : 'Simular falha'}</button>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AvatarStyleCard />
        {demoMode && <div className="notice demo">“Simular falha” existe só no modo demonstração: serve para conferir que o mapa e a edição continuam funcionando quando um provedor cai.</div>}
      </div>
    </main>
  );
}

interface ManifestModel { slug: string; name: string; file: string; originalTitle: string; author: string; license: string; licenseUrl: string; sourceUrl: string; changes: string[]; origin: string }
interface ManifestTexture { slug: string; name: string; originalTitle: string; author: string; license: string; sourceUrl: string }

type AvatarMeta = { author?: string; license?: string; pack?: string };
interface AvatarManifestCredits { bases: Record<string, { items: Array<{ source: string; meta: AvatarMeta }>; skins: Array<{ source: string; meta: AvatarMeta }>; parts: Record<string, { source: string; meta: AvatarMeta }> }> }
interface AvatarCredit { author: string; license: string; pack: string; items: string[] }
/** Autores dos avatares agrupados por autor, licença e pacote (lista por arquivo em public/assets/avatars/CREDITS.md). */
function avatarCredits(m: AvatarManifestCredits): AvatarCredit[] {
  const by = new Map<string, AvatarCredit>();
  const add = (meta: AvatarMeta, what: string) => {
    const k = [meta.author, meta.license, meta.pack].join('|');
    const c = by.get(k) ?? { author: meta.author || '—', license: /^cc0/i.test(meta.license ?? '') ? 'CC0 1.0' : meta.license || '—', pack: meta.pack || '—', items: [] };
    if (!c.items.includes(what)) c.items.push(what);
    by.set(k, c);
  };
  for (const b of Object.values(m.bases)) {
    for (const p of Object.values(b.parts)) add(p.meta, p.source);
    for (const s of b.skins) add(s.meta, s.source);
    for (const i of b.items) add(i.meta, i.source);
  }
  return [...by.values()];
}

export function CreditsPage() {
  const [m, setM] = useState<{ models: ManifestModel[]; textures: ManifestTexture[] } | null>(null);
  const [av, setAv] = useState<AvatarCredit[] | null>(null);
  const [ara, setAra] = useState<{ commit: string; count: number } | null>(null);
  useEffect(() => {
    fetch('/assets/manifest.json').then((r) => r.json()).then(setM, () => setM({ models: [], textures: [] }));
    fetch('/assets/avatars-ara/manifest.json').then((r) => r.json()).then((x: { generator: { commit: string }; characters: unknown[] }) => setAra({ commit: x.generator.commit, count: x.characters.length }), () => setAra(null));
    fetch('/assets/avatars/manifest.json').then((r) => r.json()).then((x: AvatarManifestCredits) => setAv(avatarCredits(x)), () => setAv([]));
  }, []);
  return (
    <main className="page">
      <div className="page-inner">
        <div>
          <h2>Créditos e licenças</h2>
          <p className="muted">Modelos e texturas distribuídos com o produto. Os itens CC-BY 3.0 exigem atribuição e indicação de alterações (abaixo). Lista completa também em <span className="mono">public/assets/CREDITS.md</span>.</p>
        </div>
        <div className="card">
          <p>O editor 3D reaproveita código do projeto <b>FigureBox Planner</b> (repositório privado <span className="mono">Olukasao/FigureBox_Planner</span>, commit <span className="mono">f478167</span>), do mesmo autor. Bibliotecas: React, Three.js, React Three Fiber, drei, glTF Transform, Express (licença MIT).</p>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="table">
            <thead><tr><th>No produto</th><th>Original</th><th>Autor</th><th>Licença</th><th>Alterações</th></tr></thead>
            <tbody>
              {m?.models.map((x) => (
                <tr key={x.slug}>
                  <td>{x.name}</td>
                  <td>{x.sourceUrl ? <a href={x.sourceUrl} target="_blank" rel="noopener noreferrer">{x.originalTitle}</a> : x.originalTitle}</td>
                  <td>{x.author}</td>
                  <td>{x.licenseUrl ? <a href={x.licenseUrl} target="_blank" rel="noopener noreferrer">{x.license}</a> : x.license}</td>
                  <td className="muted">{x.changes.join('; ') || '—'}</td>
                </tr>
              ))}
              {m?.textures.map((x) => (
                <tr key={x.slug}>
                  <td>{x.name} (textura)</td>
                  <td><a href={x.sourceUrl} target="_blank" rel="noopener noreferrer">{x.originalTitle}</a></td>
                  <td>{x.author}</td>
                  <td>{x.license}</td>
                  <td className="muted">mapa de cor reduzido para 512 px (WebP)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3>Avatares: estilo Ara 3D Gen (padrão)</h3>
          <p className="muted">{ara ? `${ara.count} personagens` : 'Personagens'} gerados com o <a href="https://github.com/olatunde85/3d-gen" target="_blank" rel="noopener noreferrer">Ara 3D Gen</a> (código MIT{ara ? `, commit ${ara.commit.slice(0, 7)}` : ''}). Corpos, rostos, cabelos, roupas e sapatos vêm dos dados do MakeHuman, CC0 1.0. Os personagens exportados podem ser usados sem atribuição. A animação é procedural, do próprio Office 3D. Lista por arquivo em <span className="mono">public/assets/avatars-ara/CREDITS.md</span>.</p>
          <h3>Avatares: estilo MakeHuman (desativado, escolhível pelo administrador)</h3>
          <p className="muted">Corpos, roupas, cabelos, peles e acessórios da comunidade <a href="https://www.makehumancommunity.org" target="_blank" rel="noopener noreferrer">MakeHuman</a> (CC0 1.0), preparados no Blender com o MPFB2 (ferramenta GPL-3.0, usada só na construção e não distribuída). O headset é geometria original do projeto. Lista por arquivo, com as alterações, em <span className="mono">public/assets/avatars/CREDITS.md</span>.</p>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="table">
            <thead><tr><th>Autor</th><th>Licença</th><th>Pacote</th><th>Itens</th></tr></thead>
            <tbody>
              {av?.map((x) => (
                <tr key={x.author + x.pack}>
                  <td>{x.author}</td>
                  <td>{x.license}</td>
                  <td className="mono">{x.pack}</td>
                  <td className="muted">{x.items.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
