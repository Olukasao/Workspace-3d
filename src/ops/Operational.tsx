import { Armchair, Building2, Monitor, Pencil, Printer, RefreshCw, Search, Table2, Tv } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type ReactNode } from 'react';
import { indexObjects, worldTransform } from '../../shared/scene';
import type { ActionId, AssetDefinition, OperationalObject, OperationalView, SceneObject, SessionUser } from '../../shared/types';
import { api, errorText } from '../api';
import { STATUS_COLOR, STATUS_LABEL } from '../avatar/PresenceDemo';
import { useLive } from '../live';
import { OfficeAvatars, type Seat } from '../three/avatar/Avatar';
import { Scene3D, type FocusRequest } from '../three/Scene3D';
import { ActionChip, dateTime } from '../ui';
import { ChatDialog, DashboardDialog, PrintDialog, RemoteDialog, TransferDialog } from './dialogs';

type Filter = 'all' | 'workstation' | 'printer' | 'tv' | 'room';
const FILTERS: Array<[Filter, string]> = [['all', 'Tudo'], ['workstation', 'Mesas e postos'], ['printer', 'Impressoras'], ['tv', 'TVs'], ['room', 'Salas']];
const ICON: Record<string, ReactNode> = { desk: <Table2 size={15} />, workstation: <Monitor size={15} />, printer: <Printer size={15} />, tv: <Tv size={15} />, room: <Building2 size={15} />, furniture: <Armchair size={15} />, decor: <Armchair size={15} /> };
const KIND_LABEL: Record<string, string> = { desk: 'Mesa', workstation: 'Posto', printer: 'Impressora', tv: 'TV', room: 'Sala', furniture: 'Mobiliário', decor: 'Decoração' };
const PRESENCE: Record<string, [string, string]> = { available: ['ok', 'Disponível'], busy: ['bad', 'Ocupado'], away: ['warn', 'Ausente'], offline: ['neutral', 'Desconectado'], unknown: ['neutral', 'Presença indisponível'] };

export type OpenDialog = { action: ActionId; objectId: string } | null;

export function Operational({ officeId, user, onEdit }: { officeId: string; user: SessionUser; onEdit: (objectId: string) => void }) {
  const [data, setData] = useState<OperationalView | null>(null);
  const [assets, setAssets] = useState<Record<string, AssetDefinition>>({});
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<'iso' | 'plan'>('iso');
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const people = useLive((s) => s.people);
  const presenceVisible = useLive((s) => s.presenceVisible);
  const resyncNonce = useLive((s) => s.resyncNonce);

  const load = useCallback(async () => {
    try {
      const [v, a] = await Promise.all([api.get<OperationalView>(`/api/offices/${officeId}/operational`), api.get<{ assets: AssetDefinition[] }>('/api/assets')]);
      setData(v);
      setAssets(Object.fromEntries(a.assets.map((x) => [x.id, x])));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [officeId]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  // troca de mesa, publicação ou diretório: recarrega a visão (o avatar vai para a nova mesa, sem duplicar)
  useEffect(() => {
    if (resyncNonce) void load();
  }, [resyncNonce, load]);
  const byId = useMemo(() => (data?.doc ? indexObjects(data.doc) : new Map<string, SceneObject>()), [data]);
  // assento fixo de cada colaborador = mesa vinculada (uma por pessoa)
  const seats = useMemo(() => {
    const out: Record<string, Seat> = {};
    for (const o of Object.values(data?.objects ?? {})) if (o.kind === 'desk' && o.seat?.state === 'occupied' && o.seat.employee && o.seatPosition) out[o.seat.employee.id] = o.seatPosition;
    return out;
  }, [data]);
  const onlineWithoutDesk = Object.values(people).filter((p) => p.status !== 'offline' && !seats[p.employeeId]);
  const roomName = (id: string | null) => (id ? byId.get(id)?.name ?? '' : '');
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // lista equivalente à cena: busca por pessoa, setor, equipamento, ramal ou nome do objeto
  const entries = useMemo(() => {
    if (!data?.doc) return [];
    const list = Object.values(data.objects).filter((o) => o.kind === 'room' || o.kind === 'desk' || o.kind === 'workstation' || o.kind === 'printer' || o.kind === 'tv' || (q && (o.kind === 'decor' || o.kind === 'furniture')));
    return list
      .filter((o) => filter === 'all' || o.kind === filter || (filter === 'workstation' && o.kind === 'desk'))
      .filter((o) => {
        if (!q) return true;
        const room = byId.get(o.objectId);
        const text = [o.name, KIND_LABEL[o.kind], o.seat?.employee?.name, o.seat?.employee?.department, o.seat?.employee?.extension, o.device?.name, o.dashboard?.name, room?.room?.sector, roomName(o.roomId)].filter(Boolean).join(' ');
        return norm(text).includes(norm(q));
      })
      .sort((a, b) => (a.kind === 'room' ? 0 : 1) - (b.kind === 'room' ? 0 : 1) || roomName(a.roomId).localeCompare(roomName(b.roomId)) || a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q, filter, byId]);

  const actionable = useMemo(() => new Set(Object.values(data?.objects ?? {}).filter((o) => Object.values(o.actions).some((a) => a.state === 'available')).map((o) => o.objectId)), [data]);

  const select = useCallback(
    (id: string | null, fly = true) => {
      setSelected(id);
      if (!id || !data?.doc || !fly) return;
      const o = byId.get(id);
      if (!o) return;
      const wt = worldTransform(byId, id);
      setFocus({ x: wt.x, z: wt.z, radius: o.room ? Math.max(o.room.w, o.room.d) / 2 + 1 : 3.2, nonce: Date.now() });
    },
    [data, byId],
  );

  const onListKey = (e: RKeyboardEvent) => {
    if (!entries.length) return;
    let i = focusIdx;
    if (e.key === 'ArrowDown') i = Math.min(entries.length - 1, i + 1);
    else if (e.key === 'ArrowUp') i = Math.max(0, i - 1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = entries.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
      select(entries[i].objectId);
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    setFocusIdx(i);
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  if (error && !data) return <div className="page"><div className="notice bad" role="alert">{error} <button className="btn small" onClick={() => void load()}>Tentar de novo</button></div></div>;
  if (!data) return <div className="loading">Carregando o escritório…</div>;

  const sel = selected ? data.objects[selected] : null;
  const problems = data.integrations.filter((i) => i.state === 'unavailable');
  const selSet = new Set(selected ? [selected] : []);

  return (
    <div className={`workspace${sel ? '' : ' no-right'}`}>
      <aside className="side" aria-label="Busca e lista do escritório">
        <div className="side-head">
          <div className="row">
            <Search size={15} className="muted" aria-hidden />
            <input className="input" type="search" placeholder="Pessoa, setor, ramal ou equipamento" value={q} onChange={(e) => { setQ(e.target.value); setFocusIdx(0); }} aria-label="Buscar no escritório" />
          </div>
          <div className="filters" role="group" aria-label="Filtrar por tipo">
            {FILTERS.map(([f, l]) => <button key={f} aria-pressed={filter === f} onClick={() => { setFilter(f); setFocusIdx(0); }}>{l}</button>)}
          </div>
          <p className="muted">
            {data.revision ? <>Revisão publicada nº {data.revision.number} · {dateTime(data.revision.publishedAt)}</> : 'Nenhuma revisão publicada.'}
            {' '}<button className="btn small ghost" onClick={() => void load()} aria-label="Atualizar"><RefreshCw size={12} /></button>
          </p>
        </div>
        <div className="side-body">
          {problems.length > 0 && (
            <div className="notice bad" role="status">
              {problems.map((p) => p.label).join(', ')}: indisponível no momento. O mapa e as demais funções continuam funcionando.
            </div>
          )}
          <div className="objlist" role="listbox" aria-label="Objetos do escritório" tabIndex={0} ref={listRef} onKeyDown={onListKey} aria-activedescendant={entries[focusIdx] ? `opt-${entries[focusIdx].objectId}` : undefined}>
            {entries.length === 0 && <p className="muted">Nada encontrado para “{q}”.</p>}
            {entries.map((o, i) => (
              <div
                key={o.objectId}
                id={`opt-${o.objectId}`}
                data-idx={i}
                role="option"
                aria-selected={selected === o.objectId}
                className={i === focusIdx ? 'focused' : ''}
                onClick={() => { setFocusIdx(i); select(o.objectId); }}
                onMouseEnter={() => setHovered(o.objectId)}
                onMouseLeave={() => setHovered(null)}
              >
                <span className="ico">{ICON[o.kind]}</span>
                <span className="txt">
                  <b>{o.name}</b>
                  <small>{subtitle(o, roomName(o.roomId))}</small>
                </span>
                {(o.kind === 'workstation' || o.kind === 'desk') && o.seat && <SeatDot o={o} />}
              </div>
            ))}
          </div>
          {presenceVisible && onlineWithoutDesk.length > 0 && (
            <div className="stack" data-testid="online-sem-mesa">
              <h3>Online sem mesa</h3>
              {onlineWithoutDesk.map((p) => (
                <div key={p.employeeId} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{p.name}</span>
                  <span className="chip neutral live"><span className="presence-dot" style={{ background: STATUS_COLOR[p.status] }} /> {STATUS_LABEL[p.status]}</span>
                </div>
              ))}
            </div>
          )}
          <p className="muted">Use ↑ ↓ para percorrer e Enter para abrir. Azul na cena = objeto com ações disponíveis.</p>
        </div>
      </aside>
      <section className="stage" aria-label="Mapa do escritório">
        <div className="stage-bar">
          <div className="toolgroup" role="group" aria-label="Vista">
            <button className="btn small" aria-pressed={view === 'plan'} onClick={() => setView('plan')}>Planta</button>
            <button className="btn small" aria-pressed={view === 'iso'} onClick={() => setView('iso')}>3D</button>
          </div>
          <div className="spacer" />
          <span className="status-pill">{data.office.name}</span>
        </div>
        {data.doc ? (
          <Scene3D
            doc={data.doc}
            assets={assets}
            view={view}
            selected={selSet}
            hovered={hovered}
            actionable={actionable}
            interactive={(o) => o.kind !== 'wall' && o.kind !== 'opening'}
            onClickObject={(id) => select(id, false)}
            onHover={setHovered}
            onMissed={() => setSelected(null)}
            focus={focus}
            seatMarkers={sel?.seatPosition ? [{ ...sel.seatPosition, label: sel.seat?.employee ? `Assento de ${sel.seat.employee.name}` : `Assento da ${sel.seatPosition.deskName} (vaga)` }] : undefined}
            instancing={!new URLSearchParams(location.search).has('semInstancias')}
          >
            {presenceVisible && <OfficeAvatars people={people} seats={seats} />}
          </Scene3D>
        ) : (
          <div className="loading"><div className="notice info">O administrador ainda não publicou o mapa deste andar.</div></div>
        )}
        <div className="stage-hint">Clique em um objeto para ver opções · arraste para girar · roda do mouse aproxima</div>
      </section>
      {sel && (
        <aside className="side right" aria-label="Detalhes do objeto">
          <ContextPanel o={sel} data={data} user={user} roomName={roomName} byId={byId} onAction={(action) => setDialog({ action, objectId: sel.objectId })} onSelect={select} onEdit={onEdit} onFocus={() => select(sel.objectId)} />
        </aside>
      )}
      {dialog?.action === 'chat' && <ChatDialog officeId={officeId} object={data.objects[dialog.objectId]} onClose={() => setDialog(null)} />}
      {dialog?.action === 'remote' && <RemoteDialog officeId={officeId} object={data.objects[dialog.objectId]} user={user} onClose={() => setDialog(null)} />}
      {dialog?.action === 'transfer' && <TransferDialog officeId={officeId} object={data.objects[dialog.objectId]} onClose={() => setDialog(null)} onDone={() => void load()} />}
      {(dialog?.action === 'print' || dialog?.action === 'printQueue') && <PrintDialog officeId={officeId} object={data.objects[dialog.objectId]} onClose={() => setDialog(null)} />}
      {(dialog?.action === 'dashboard' || dialog?.action === 'cad') && <DashboardDialog officeId={officeId} object={data.objects[dialog.objectId]} kind={dialog.action} onClose={() => setDialog(null)} />}
    </div>
  );
}

function subtitle(o: OperationalObject, room: string): string {
  if (o.kind === 'workstation' || o.kind === 'desk') {
    if (o.seat?.state === 'occupied') return `${o.seat.employee!.name} · ${o.seat.employee!.department} · ramal ${o.seat.employee!.extension}`;
    if (o.seat?.state === 'orphan') return `Vínculo órfão · ${room}`;
    return `Mesa vaga · ${room}`;
  }
  if (o.kind === 'room') return 'Sala';
  return [KIND_LABEL[o.kind], o.device?.name, room].filter(Boolean).join(' · ');
}

function SeatDot({ o }: { o: OperationalObject }) {
  const live = useLive((s) => (o.seat?.employee ? s.people[o.seat.employee.id] : undefined));
  if (o.seat?.state === 'vacant') return <span className="chip neutral">Vaga</span>;
  if (live) return <span className="chip neutral live" data-live={live.status}><span className="presence-dot" style={{ background: STATUS_COLOR[live.status] }} /> {STATUS_LABEL[live.status]}</span>;
  if (o.seat?.state === 'orphan') return <span className="chip warn">Órfão</span>;
  if (!o.presence) return <span className="chip info">Ocupada</span>;
  const [cls, label] = PRESENCE[o.presence.state];
  return <span className={`chip ${cls}`}>{label}</span>;
}

const ACTION_LABEL: Record<ActionId, string> = { chat: 'Abrir chat', remote: 'Solicitar acesso remoto', transfer: 'Transferir atendimento', print: 'Imprimir documento', printQueue: 'Enviar para a fila da impressora', dashboard: 'Abrir painel', cad: 'Abrir projeto CAD' };

function ContextPanel({ o, data, user, roomName, byId, onAction, onSelect, onEdit, onFocus }: {
  o: OperationalObject; data: OperationalView; user: SessionUser; roomName: (id: string | null) => string; byId: Map<string, SceneObject>; onAction: (a: ActionId) => void; onSelect: (id: string) => void; onEdit: (id: string) => void; onFocus: () => void;
}) {
  const scene = byId.get(o.objectId);
  const rows: Array<[string, ReactNode]> = [];
  if (o.kind === 'workstation' || o.kind === 'desk') {
    if (o.seat?.state === 'occupied') {
      rows.push(['Colaborador', o.seat.employee!.name], ['Setor', o.seat.employee!.department], ['Ramal', o.seat.employee!.extension]);
      if (o.presence) {
        const [cls, label] = PRESENCE[o.presence.state];
        rows.push(['Presença', <span key="p" className="row"><span className={`chip ${cls}`}>{label}</span>{o.presence.mode === 'demo' && <span className="chip demo">demo</span>}</span>]);
      }
    } else if (o.seat?.state === 'orphan') rows.push(['Ocupação', <span key="o" className="chip warn">Vínculo órfão</span>], ['Situação', o.seat.note]);
    else rows.push(['Ocupação', <span key="v" className="chip neutral">Mesa vaga</span>]);
  }
  if (o.seatPosition) rows.push(['Posição fixa', `${o.seatPosition.deskName} · ${o.seatPosition.x.toFixed(2).replace('.', ',')}; ${o.seatPosition.z.toFixed(2).replace('.', ',')} m`]);
  if (o.device) rows.push(['Equipamento', o.device.state === 'linked' ? `${o.device.name}${o.device.location ? ` — ${o.device.location}` : ''}` : o.device.state === 'orphan' ? <span key="d" className="chip warn">Dispositivo removido</span> : 'Nenhum vinculado']);
  if (o.kind === 'printer') rows.push(['Localização', roomName(o.roomId) || '—'], ['Estado', <span key="s" className="muted">Não informado pelo conector</span>]);
  if (o.kind === 'tv') rows.push(['Sala', roomName(o.roomId) || '—'], ['Painel', o.dashboard?.name ?? 'Nenhum associado']);
  const inRoom = o.kind === 'room' ? Object.values(data.objects).filter((x) => x.roomId === o.objectId && x.kind !== 'room') : [];
  if (o.kind === 'room' && scene?.room) {
    rows.push(['Setor', scene.room.sector || '—'], ['Capacidade', `${scene.room.capacity ?? '—'} pessoas`], ['Medidas', `${scene.room.w} × ${scene.room.d} m`], ['Recursos', `${inRoom.filter((x) => ['workstation', 'printer', 'tv'].includes(x.kind)).length} equipamentos · ${inRoom.length} objetos`]);
  }
  if ((o.kind === 'decor' || o.kind === 'furniture') && scene) {
    const wt = worldTransform(byId, o.objectId);
    rows.push(['Material', scene.material || '—'], ['Posição', `${wt.x.toFixed(2)}; ${wt.z.toFixed(2)} m${wt.y > 0.01 ? ` · ${wt.y.toFixed(2)} m de altura` : ''}`], ['Sala', roomName(o.roomId) || '—']);
  }
  const actions = Object.entries(o.actions) as Array<[ActionId, NonNullable<OperationalObject['actions'][ActionId]>]>;
  // impressão: um único botão abre o fluxo; o envio direto aparece dentro dele quando disponível
  const visible = actions.filter(([id]) => id !== 'printQueue');
  return (
    <>
      <div className="side-head">
        <div className="ctx-head">
          <span className="ico">{ICON[o.kind]}</span>
          <div>
            <h2>{o.name}</h2>
            <p className="muted">{KIND_LABEL[o.kind]}{o.roomId && o.kind !== 'room' ? ` · ${roomName(o.roomId)}` : ''}</p>
          </div>
        </div>
      </div>
      <div className="side-body">
        <dl className="kv">
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {visible.length > 0 && (
          <div className="stack">
            <h3>Ações</h3>
            {visible.map(([id, st]) => (
              <div className="action" key={id}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <button className={`btn${st.state === 'available' ? ' primary' : ''}`} disabled={st.state !== 'available'} onClick={() => onAction(id)} data-action={id}>
                    {ACTION_LABEL[id]}
                  </button>
                  <span className="row">
                    {st.state === 'available' && st.mode === 'demo' && <span className="chip demo">demo</span>}
                    <ActionChip state={st.state} />
                  </span>
                </div>
                {st.reason && <span className="why">{st.reason}</span>}
              </div>
            ))}
          </div>
        )}
        {o.kind === 'room' && (
          <div className="stack">
            <button className="btn" onClick={onFocus}>Focar câmera na sala</button>
            <h3>Recursos da sala</h3>
            <div className="objlist">
              {inRoom.filter((x) => x.kind !== 'decor' && x.kind !== 'furniture').concat(inRoom.filter((x) => x.kind === 'decor' || x.kind === 'furniture')).slice(0, 40).map((x) => (
                <div role="option" aria-selected={false} key={x.objectId} tabIndex={0} onClick={() => onSelect(x.objectId)} onKeyDown={(e) => e.key === 'Enter' && onSelect(x.objectId)}>
                  <span className="ico">{ICON[x.kind]}</span>
                  <span className="txt"><b>{x.name}</b><small>{subtitle(x, '')}</small></span>
                </div>
              ))}
            </div>
          </div>
        )}
        {(o.kind === 'decor' || o.kind === 'furniture') && (user.role === 'admin' ? <button className="btn" onClick={() => onEdit(o.objectId)}><Pencil size={14} /> Editar no modo administrador</button> : <p className="muted">Decoração é editada pelo administrador.</p>)}
        {data.integrations.some((i) => i.mode === 'demo') && <div className="notice demo">Modo demonstração: chat, presença, transferência, acesso remoto e fila de impressão são simulados com dados fictícios.</div>}
        <DemoLegend />
      </div>
    </>
  );
}

const DemoLegend = () => (
  <p className="muted" style={{ marginTop: 'auto' }}>
    Estados: <ActionChip state="available" /> <ActionChip state="not_configured" /> <ActionChip state="forbidden" /> <ActionChip state="unavailable" />
  </p>
);

