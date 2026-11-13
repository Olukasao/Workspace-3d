/**
 * Editor do escritório 2D (administrador): ferramentas, paleta de móveis, estações e publicação.
 * O rascunho é salvo no servidor com versão-base (outro administrador não é sobrescrito sem aviso); "Publicar" envia o
 * layout novo, ao vivo, a todos os conectados no 2D.
 */
import type Phaser from 'phaser';
import { Download, Eraser, Hand, MapPin, MousePointer2, Paintbrush, RotateCw, Save, Send, Square, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ASSET_CATEGORIES, ASSETS, FLOORS, ASSET_BY_ID, type Layout2D } from '../../../../shared/office2d';
import { TvContentForm } from './TvContentForm';
import type { TvContent } from './net2d';
import { api, errorText, type ApiError } from '../../../api';
import { EditorScene, type Tool } from './EditorScene';
import { PhaserHost, createGame } from './PhaserHost';

interface DraftResponse { layout: Layout2D; version: number; publishedVersion: number; isDefault: boolean; seats: Array<{ stationId: string; employeeId: string }> }
interface Dir { id: string; name: string }

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const FLOOR_COLORS = ['#000', '#b98a55', '#3d5a99', '#8b9096', '#d9d4c7', '#c9c9c0', '#7d838c', '#8b3a4a', '#4d8a45'];

export function Editor2DView({ officeId, onReady }: { officeId: string; onReady: () => void }) {
  const [data, setData] = useState<DraftResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string; details?: string[] } | null>(null);
  const [tool, setTool] = useState<Tool>({ kind: 'select' });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [, setRev] = useState(0);
  const [employees, setEmployees] = useState<Dir[]>([]);
  const [seats, setSeats] = useState<Record<string, string>>({});
  const [tvDevices, setTvDevices] = useState<Array<{ id: string; name: string; kind: string; remoteProvider: string | null }>>([]);
  const [tvLinks, setTvLinks] = useState<Record<string, string>>({});
  const [tvContents, setTvContents] = useState<Record<string, TvContent>>({});
  const toolRef = useRef<Tool>(tool);
  toolRef.current = tool;
  const layoutRef = useRef<Layout2D | null>(null);
  const game = useRef<Phaser.Game | null>(null);
  const version = useRef(0);
  const [published, setPublished] = useState(0);
  const scene = () => game.current?.scene.getScene('editor2d') as EditorScene | undefined;

  const loadSeq = useRef(0);
  const load = async () => {
    const my = ++loadSeq.current;
    const r = await api.get<DraftResponse>(`/api/admin/office2d/${officeId}/draft`);
    if (my !== loadSeq.current) return r; // uma leitura mais nova já valeu (o React monta duas vezes em desenvolvimento): não troca o layout sob a cena
    layoutRef.current = clone(r.layout);
    version.current = r.version;
    setPublished(r.publishedVersion);
    setSeats(Object.fromEntries(r.seats.map((s) => [s.stationId, s.employeeId])));
    setData(r);
    setDirty(false);
    return r;
  };

  useEffect(() => {
    let dead = false;
    load().then(
      () => !dead && onReady(),
      (e) => !dead && setErr(errorText(e)),
    );
    api.get<{ employees: Dir[] }>('/api/directory').then((r) => !dead && setEmployees(r.employees), () => undefined);
    api.get<{ content: Record<string, TvContent> }>(`/api/office2d/${officeId}/tv-content`).then((r) => !dead && setTvContents(r.content), () => undefined);
    api.get<{ devices: typeof tvDevices; links: Record<string, string> }>(`/api/admin/office2d/${officeId}/devices`).then((r) => !dead && (setTvDevices(r.devices), setTvLinks(r.links)), () => undefined);
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeId]);

  const bridge = useMemo(
    () => (data && layoutRef.current ? { layout: layoutRef.current, tool: () => toolRef.current, onChange: () => { setDirty(true); setRev((n) => n + 1); }, onSelect: setSel } : null),
    // o objeto de ligação é criado uma vez por carregamento do servidor
    [data],
  );

  if (err) return <div className="page"><div className="notice bad">{err}</div></div>;
  if (!data || !bridge) return <div className="loading">Carregando o editor…</div>;
  const layout = layoutRef.current!;

  const save = async (): Promise<boolean> => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.put<{ version: number }>(`/api/admin/office2d/${officeId}/draft`, { layout, baseVersion: version.current });
      version.current = r.version;
      setDirty(false);
      setMsg({ kind: 'ok', text: 'Rascunho salvo.' });
      return true;
    } catch (e) {
      const details = (e as ApiError).body?.details;
      setMsg({ kind: 'bad', text: errorText(e), details: Array.isArray(details) ? details : undefined });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const r = await api.post<{ version: number }>(`/api/admin/office2d/${officeId}/publish`, { baseVersion: version.current });
      setPublished(r.version);
      setMsg({ kind: 'ok', text: 'Layout publicado: todos no modo 2D já estão vendo.' });
    } catch (e) {
      setMsg({ kind: 'bad', text: errorText(e), details: Array.isArray((e as ApiError).body?.details) ? ((e as ApiError).body.details as string[]) : undefined });
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    const r = await load();
    scene()?.reload(layoutRef.current!);
    setSel(null);
    setMsg({ kind: 'ok', text: r.isDefault ? 'Voltou ao layout padrão.' : 'Alterações descartadas.' });
  };
  /** Vincula (ou desvincula) o dispositivo da TV selecionada; vale na hora, sem publicar o layout (a TV precisa existir no rascunho salvo). */
  const linkTv = async (objectId: string, deviceId: string) => {
    try {
      await api.put(`/api/admin/office2d/${officeId}/objects/${objectId}/device`, { deviceId: deviceId || null });
      setTvLinks((l) => {
        const n = { ...l };
        if (deviceId) n[objectId] = deviceId;
        else delete n[objectId];
        return n;
      });
      setMsg({ kind: 'ok', text: deviceId ? 'Dispositivo da TV vinculado.' : 'Dispositivo da TV desvinculado.' });
    } catch (e) {
      setMsg({ kind: 'bad', text: `${errorText(e)} Se a TV é nova, salve o rascunho antes de vincular.` });
    }
  };
  const assign = async (stationId: string, employeeId: string) => {
    try {
      await api.put(`/api/admin/office2d/${officeId}/seats/${stationId}`, { employeeId: employeeId || null });
      setSeats((s) => {
        const n = Object.fromEntries(Object.entries(s).filter(([k, v]) => k !== stationId && v !== employeeId));
        if (employeeId) n[stationId] = employeeId;
        return n;
      });
    } catch (e) {
      setMsg({ kind: 'bad', text: errorText(e) });
    }
  };
  const selObj = sel ? layout.objects.find((o) => o.id === sel) : null;
  const selStation = selObj ? layout.stations.find((s) => s.objectId === selObj.id) : null;
  const pick = (t: Tool) => setTool(t);
  const isTool = (k: Tool['kind'], extra?: string | number) => tool.kind === k && (extra === undefined || ('asset' in tool ? tool.asset === extra : 'floor' in tool ? tool.floor === extra : true));

  return (
    <div className="office2d editor2d" data-testid="editor2d">
      <aside className="office2d-side editor2d-tools" aria-label="Ferramentas">
        <section>
          <h3>Ferramentas</h3>
          <div className="editor2d-row">
            <button className={`btn small ${isTool('select') ? 'primary' : ''}`} onClick={() => pick({ kind: 'select' })} data-testid="tool-select" title="Selecionar e arrastar móveis"><MousePointer2 size={14} /> Selecionar</button>
            <button className={`btn small ${isTool('pan') ? 'primary' : ''}`} onClick={() => pick({ kind: 'pan' })} title="Mover a vista (ou arraste com o botão direito)"><Hand size={14} /> Vista</button>
            <button className={`btn small ${isTool('wall') ? 'primary' : ''}`} onClick={() => pick({ kind: 'wall' })} data-testid="tool-wall"><Square size={14} /> Parede</button>
            <button className={`btn small ${isTool('erase') ? 'primary' : ''}`} onClick={() => pick({ kind: 'erase' })} data-testid="tool-erase"><Eraser size={14} /> Apagar</button>
            <button className={`btn small ${isTool('spawn') ? 'primary' : ''}`} onClick={() => pick({ kind: 'spawn' })} data-testid="tool-spawn" title="Clique no chão para criar ou remover um ponto de entrada"><MapPin size={14} /> Entrada</button>
          </div>
        </section>
        <section>
          <h3>Piso</h3>
          <div className="editor2d-row">
            {[...FLOORS, { id: 0, name: 'Vazio' }].map((f) => (
              <button key={f.id} className={`btn small ${isTool('floor', f.id) ? 'primary' : ''}`} onClick={() => pick({ kind: 'floor', floor: f.id })} title={f.name} data-testid={`floor-${f.id}`}>
                <span className="editor2d-swatch" style={{ background: FLOOR_COLORS[f.id] }} /> <Paintbrush size={12} />
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>Móveis</h3>
          {ASSET_CATEGORIES.map((c) => (
            <div key={c}>
              <div className="muted editor2d-cat">{c}</div>
              <div className="editor2d-row">
                {ASSETS.filter((a) => a.category === c).map((a) => (
                  <button key={a.id} className={`btn small ${isTool('place', a.id) ? 'primary' : ''}`} onClick={() => pick({ kind: 'place', asset: a.id })} data-testid={`asset-${a.id}`} title={a.name}>
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      </aside>
      <div className="office2d-stage">
        <PhaserHost className="office2d-canvas" make={(parent) => createGame(parent, new EditorScene(bridge))} onGame={(g) => { game.current = g; }} />
        <div className="editor2d-bar">
          <button className="btn small" onClick={() => scene()?.rotate()} disabled={!selObj && tool.kind !== 'place'} title="Girar (R)"><RotateCw size={14} /> Girar</button>
          <button className="btn small danger" onClick={() => sel && scene()?.removeObject(sel)} disabled={!selObj} title="Remover (Delete)" data-testid="delete-selected"><Trash2 size={14} /></button>
          <span className="editor2d-sep" />
          <button className="btn small" onClick={discard} disabled={busy} data-testid="editor-discard"><Undo2 size={14} /> Descartar</button>
          <a className="btn small" href={`/api/admin/office2d/${officeId}/tiled?which=draft`} download><Download size={14} /> Tiled</a>
          <button className="btn small" onClick={() => void save()} disabled={busy || !dirty} data-testid="editor-save"><Save size={14} /> Salvar rascunho</button>
          <button className="btn small primary" onClick={() => void publish()} disabled={busy} data-testid="editor-publish"><Send size={14} /> Publicar</button>
        </div>
        <div className="editor2d-status" role="status">
          {dirty ? 'Alterações não salvas · ' : ''}Publicado: v{published || 'padrão'} · Rascunho: v{version.current}
          {msg && <div className={`notice ${msg.kind === 'ok' ? 'ok' : 'bad'}`} data-testid="editor-msg">{msg.text}{msg.details && <ul>{msg.details.slice(0, 5).map((d) => <li key={d}>{d}</li>)}</ul>}</div>}
        </div>
      </div>
      <aside className="office2d-side" aria-label="Estações">
        <section>
          <h3>Selecionado</h3>
          {selObj ? (
            <>
              <div><b>{ASSET_BY_ID.get(selObj.asset)!.name}</b> <span className="muted">({selObj.x}, {selObj.y})</span></div>
              {selStation ? (
                <label className="muted">Colaborador desta estação
                  <select value={seats[selStation.id] ?? ''} onChange={(e) => void assign(selStation.id, e.target.value)} data-testid="seat-select">
                    <option value="">— livre —</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </label>
              ) : selObj.asset !== 'tv' && selObj.asset !== 'printer' ? <span className="muted">Sem estação.</span> : null}
              {(selObj.asset === 'tv' || selObj.asset === 'printer') && (
                <label className="muted">{selObj.asset === 'tv' ? 'Dispositivo desta TV (padrão da lista de acesso remoto)' : 'Impressora deste ponto (padrão da lista)'}
                  <select value={tvLinks[selObj.id] ?? ''} onChange={(e) => void linkTv(selObj.id, e.target.value)} data-testid="tv-device-select">
                    <option value="">— nenhum —</option>
                    {tvDevices.filter((d) => (selObj.asset === 'printer') === (d.kind === 'printer')).map((d) => <option key={d.id} value={d.id}>{d.name}{d.kind === 'printer' ? '' : d.remoteProvider ? ` · ${d.remoteProvider === 'rustdesk' ? 'RustDesk' : d.remoteProvider === 'anydesk' ? 'AnyDesk' : d.remoteProvider}` : ' · sem acesso remoto'}</option>)}
                  </select>
                </label>
              )}
              {selObj.asset === 'tv' && (
                <TvContentForm
                  officeId={officeId}
                  objectId={selObj.id}
                  current={tvContents[selObj.id]}
                  onSaved={(c) => {
                    setTvContents((m) => {
                      const n = { ...m };
                      if (c) n[selObj.id] = c;
                      else delete n[selObj.id];
                      return n;
                    });
                    setMsg({ kind: 'ok', text: c ? 'Conteúdo da TV salvo: já aparece no mapa de todos.' : 'A TV ficou sem conteúdo.' });
                  }}
                  onError={(text) => setMsg({ kind: 'bad', text: `${text} Se a TV é nova, salve o rascunho antes.` })}
                />
              )}
            </>
          ) : <p className="muted">Clique num móvel para ver os detalhes.</p>}
        </section>
        <section>
          <h3>Estações ({layout.stations.length})</h3>
          <ul className="office2d-people" data-testid="station-list">
            {layout.stations.map((s) => (
              <li key={s.id}>
                <button className="btn ghost small" onClick={() => scene()?.select(s.objectId)}>{s.id}</button>
                <span className="muted">{employees.find((e) => e.id === seats[s.id])?.name ?? 'livre'}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Dicas</h3>
          <ul className="office2d-help">
            <li>Escolha um móvel e clique no mapa; <b>R</b> gira.</li>
            <li>Arraste um móvel selecionado para movê-lo; <b>Delete</b> remove.</li>
            <li>Mesas com computador viram estações automaticamente.</li>
            <li>Salvar guarda o rascunho; <b>Publicar</b> envia a todos ao vivo.</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}
