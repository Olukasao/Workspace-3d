import { Unlink } from 'lucide-react';
import { useState } from 'react';
import { descendants, deskOf, indexObjects, isDesk, seatAnchorOf, seatWorld, worldTransform, type CollisionWarning, type KindIndex } from '../../shared/scene';
import type { AssetDefinition, FloorFinish, ObjectKind, OfficeInfo, OpeningStyle, SceneDoc, SceneObject, SessionUser, WallStyle } from '../../shared/types';
import { api, errorText } from '../api';
import { NumberField, dateTime, toast } from '../ui';
import { isLocked, patchObject, reparent, resizeRoom, setTransform, swapAsset } from './ops';
import { useEditor } from './store';

export interface BindingsData {
  seats: Array<{ objectId: string; employeeId: string; employeeName: string | null; department: string | null; state: string; objectState: string }>;
  bindings: Array<{ objectId: string; type: 'device' | 'dashboard' | 'cad_link'; deviceId: string | null; deviceName: string | null; config: { name?: string; url?: string } | null; state: string; objectState: string }>;
  employees: Array<{ id: string; name: string; department: string; extension: string; active: boolean; acceptsTransfers: boolean }>;
  devices: Array<{ id: string; name: string; kind: string; location: string | null; remoteProvider: string | null; active: boolean }>;
}

const KINDS: Array<[ObjectKind, string]> = [['desk', 'Mesa de trabalho (posição fixa)'], ['workstation', 'Posto (computador)'], ['printer', 'Impressora'], ['tv', 'TV'], ['furniture', 'Mobiliário'], ['decor', 'Decoração']];
const deg = (r: number) => Math.round((r * 180) / Math.PI * 10) / 10;
const rad = (d: number) => (d * Math.PI) / 180;
const STATE_TEXT: Record<string, string> = { orphan_object: 'objeto removido do mapa', orphan_employee: 'colaborador inativo ou removido', orphan_device: 'dispositivo removido do inventário' };

export function Inspector({ doc, assets, assetMap, selected, office, user, bindings, savedIds, warnings, reloadBindings, officeId }: {
  doc: SceneDoc; assets: AssetDefinition[]; assetMap: Record<string, AssetDefinition>; selected: string[]; office: OfficeInfo; user: SessionUser; bindings: BindingsData | null; savedIds: Set<string>; warnings: CollisionWarning[]; reloadBindings: () => Promise<void>; officeId: string;
}) {
  const apply = useEditor((s) => s.apply);
  const byId = indexObjects(doc);
  const kindIdx: KindIndex = Object.fromEntries(assets.map((a) => [a.id, { defaultKind: a.defaultKind, category: a.category }]));
  const o = selected.length === 1 ? byId.get(selected[0]) : undefined;
  const orphans = [...(bindings?.seats.filter((s) => s.state !== 'ok').map((s) => ({ key: `seat:${s.objectId}`, objectId: s.objectId, text: `Mesa ${s.objectId} → ${s.employeeName ?? s.employeeId}`, why: STATE_TEXT[s.state], kind: 'seat' as const })) ?? []),
    ...(bindings?.bindings.filter((b) => b.state !== 'ok').map((b) => ({ key: `${b.type}:${b.objectId}`, objectId: b.objectId, text: `${b.type === 'device' ? 'Dispositivo' : b.type === 'dashboard' ? 'Painel' : 'Link CAD'} de ${b.objectId}${b.deviceName ? ` (${b.deviceName})` : ''}`, why: STATE_TEXT[b.state], kind: b.type })) ?? [])];

  const unlink = async (kind: 'seat' | 'device' | 'dashboard' | 'cad_link', objectId: string) => {
    try {
      if (kind === 'seat') await api.put(`/api/admin/offices/${officeId}/seats/${objectId}`, { employeeId: null });
      else await api.put(`/api/admin/offices/${officeId}/bindings/${objectId}`, { type: kind, remove: true });
      await reloadBindings();
      toast('Vínculo removido.');
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <>
      <div className="side-head">
        <h2>{o ? o.name : selected.length > 1 ? `${selected.length} objetos selecionados` : 'Inspetor'}</h2>
        <p className="muted">
          {office.building.name} · {office.floor.name} · {office.publishedRevision ? `publicada: revisão ${office.publishedRevision.number} (${dateTime(office.publishedRevision.publishedAt)})` : 'ainda não publicada'}
        </p>
      </div>
      <div className="side-body">
        {!o && selected.length === 0 && <p className="muted">Selecione um objeto na cena ou na lista. Use o catálogo à esquerda para inserir mobiliário, equipamentos e salas.</p>}
        {selected.length > 1 && <p className="muted">Arraste qualquer um dos selecionados para mover o conjunto. Use agrupar para mantê-los juntos.</p>}
        {o && <ObjectProps o={o} doc={doc} assets={assets} assetMap={assetMap} apply={apply} />}
        {o && warnings.some((w) => w.a === o.id || w.b === o.id) && (
          <div className="notice warn">
            Sobrepõe {warnings.filter((w) => w.a === o.id || w.b === o.id).map((w) => byId.get(w.a === o.id ? w.b : w.a)?.name).join(', ')}. É só um aviso: confira se a sobreposição é intencional.
          </div>
        )}
        {o && (isDesk(o, kindIdx) || ['workstation', 'printer', 'tv', 'room'].includes(o.kind)) && (
          <Bindings
            key={o.id}
            o={o}
            doc={doc}
            kindIdx={kindIdx}
            saved={savedIds.has(o.id)}
            bindings={bindings}
            officeId={officeId}
            reload={reloadBindings}
            user={user}
            onLockDesk={(deskId) => apply((objs) => patchObject(objs, deskId, { locked: true }))}
          />
        )}
        {orphans.length > 0 && (
          <div className="stack">
            <hr className="sep" />
            <h3>Vínculos órfãos ({orphans.length})</h3>
            {orphans.map((x) => (
              <div key={x.key} className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 12.5 }}>{x.text}</div>
                  <div className="muted">{x.why}</div>
                </div>
                <button className="btn small" onClick={() => void unlink(x.kind, x.objectId)}><Unlink size={12} /> Remover</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ObjectProps({ o, doc, assets, assetMap, apply }: { o: SceneObject; doc: SceneDoc; assets: AssetDefinition[]; assetMap: Record<string, AssetDefinition>; apply: ReturnType<typeof useEditor.getState>['apply'] }) {
  const locked = isLocked(doc.objects, o.id);
  const byId = indexObjects(doc);
  const parent = o.parentId ? byId.get(o.parentId) : undefined;
  const asset = o.assetId ? assetMap[o.assetId] : undefined;
  const wt = worldTransform(byId, o.id);
  const set = (patch: Partial<SceneObject>) => apply((objs) => patchObject(objs, o.id, patch));
  const setT = (t: Partial<SceneObject['t']>) => apply((objs) => setTransform(objs, o.id, t));
  const sameFamily = asset ? assets.filter((a) => a.defaultKind === asset.defaultKind || a.category === asset.category) : [];
  return (
    <div className="stack">
      <label className="field"><span>Nome</span><input className="input" value={o.name} maxLength={80} disabled={locked} onChange={(e) => set({ name: e.target.value })} /></label>
      {asset && (
        <>
          <div className="grid2">
            <label className="field"><span>Tipo funcional</span>
              <select className="input" value={o.kind} disabled={locked} onChange={(e) => set({ kind: e.target.value as ObjectKind })}>
                {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="field"><span>Modelo visual</span>
              <select className="input" value={o.assetId} disabled={locked} onChange={(e) => apply((objs) => swapAsset(objs, o.id, assetMap[e.target.value]))} aria-describedby="swap-hint">
                {sameFamily.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          </div>
          <p className="muted" id="swap-hint">Trocar o modelo mantém o ID <span className="mono">{o.id}</span>: vínculos e integrações continuam valendo.</p>
        </>
      )}
      {!asset && o.assetId && <div className="notice warn">O modelo "{o.assetId}" não está no catálogo: a cena mostra um substituto.</div>}

      {o.kind !== 'room' && (
        <div className="grid3">
          <NumberField label="X" suffix="m" value={o.t.x} disabled={locked} onChange={(x) => setT({ x })} />
          <NumberField label={parent?.kind === 'wall' ? 'Altura' : 'Y'} suffix="m" value={o.t.y} min={0} max={10} disabled={locked || o.kind === 'wall'} onChange={(y) => setT({ y })} />
          <NumberField label="Z" suffix="m" value={o.t.z} disabled={locked || parent?.kind === 'wall'} onChange={(z) => setT({ z })} />
        </div>
      )}
      {o.kind === 'room' && (
        <div className="grid2">
          <NumberField label="Centro X" suffix="m" value={o.t.x} disabled={locked} onChange={(x) => setT({ x })} />
          <NumberField label="Centro Z" suffix="m" value={o.t.z} disabled={locked} onChange={(z) => setT({ z })} />
        </div>
      )}
      {o.kind !== 'room' && o.kind !== 'opening' && (
        <NumberField label="Rotação" suffix="graus" step={15} value={deg(o.t.rotY)} disabled={locked} onChange={(d) => setT({ rotY: rad(d) })} />
      )}
      <p className="muted">
        No mundo: {wt.x.toFixed(2)}; {wt.y.toFixed(2)}; {wt.z.toFixed(2)} m{parent ? ` · relativo a "${parent.name}"` : ''}
      </p>
      {parent && o.kind !== 'opening' && parent.kind !== 'wall' && (
        <button className="btn small" disabled={locked} onClick={() => apply((objs) => reparent(objs, o.id, null, { y: asset?.mount === 'surface' ? 0 : o.t.y + worldTransform(byId, parent.id).y }) ?? objs)}>
          Soltar de "{parent.name}" (deixa de acompanhá-lo)
        </button>
      )}

      {o.room && (
        <>
          <div className="grid2">
            <NumberField label="Largura" suffix="m" min={1} max={100} value={o.room.w} disabled={locked} onChange={(w) => apply((objs) => resizeRoom(objs, o.id, w, o.room!.d))} />
            <NumberField label="Profundidade" suffix="m" min={1} max={100} value={o.room.d} disabled={locked} onChange={(d) => apply((objs) => resizeRoom(objs, o.id, o.room!.w, d))} />
          </div>
          <div className="grid2">
            <label className="field"><span>Setor</span><input className="input" value={o.room.sector ?? ''} disabled={locked} onChange={(e) => set({ room: { ...o.room!, sector: e.target.value } })} /></label>
            <NumberField label="Capacidade" step={1} min={0} max={500} value={o.room.capacity ?? 0} disabled={locked} onChange={(c) => set({ room: { ...o.room!, capacity: Math.round(c) } })} />
          </div>
          <label className="field"><span>Piso</span>
            <select className="input" value={o.room.floor} disabled={locked} onChange={(e) => set({ room: { ...o.room!, floor: e.target.value as FloorFinish } })}>
              <option value="carpet">Carpete</option><option value="wood">Madeira</option><option value="tile">Cerâmica</option><option value="concrete">Concreto</option><option value="plain">Liso</option>
            </select>
          </label>
        </>
      )}
      {o.wall && (
        <>
          <div className="grid3">
            <NumberField label="Comprimento" suffix="m" min={0.2} max={100} value={o.wall.length} disabled={locked || !!o.wall.side} onChange={(length) => set({ wall: { ...o.wall!, length } })} />
            <NumberField label="Altura" suffix="m" min={0.3} max={6} value={o.wall.height} disabled={locked} onChange={(height) => set({ wall: { ...o.wall!, height } })} />
            <NumberField label="Espessura" suffix="m" min={0.03} max={0.6} step={0.01} value={o.wall.thickness} disabled={locked} onChange={(thickness) => set({ wall: { ...o.wall!, thickness } })} />
          </div>
          <label className="field"><span>Estilo</span>
            <select className="input" value={o.wall.style} disabled={locked} onChange={(e) => set({ wall: { ...o.wall!, style: e.target.value as WallStyle } })}>
              <option value="solid">Alvenaria</option><option value="glass">Divisória de vidro</option><option value="partition">Divisória</option>
            </select>
          </label>
          {o.wall.side && <p className="muted">Parede da sala "{parent?.name}": o comprimento acompanha o tamanho da sala.</p>}
        </>
      )}
      {o.opening && (
        <>
          <div className="grid2">
            <NumberField label="Largura" suffix="m" min={0.3} max={10} value={o.opening.width} disabled={locked} onChange={(width) => set({ opening: { ...o.opening!, width } })} />
            <NumberField label="Altura do vão" suffix="m" min={0.3} max={5} value={o.opening.height} disabled={locked} onChange={(height) => set({ opening: { ...o.opening!, height } })} />
          </div>
          <label className="field"><span>Tipo</span>
            <select className="input" value={o.opening.style} disabled={locked} onChange={(e) => set({ opening: { ...o.opening!, style: e.target.value as OpeningStyle } })}>
              <option value="door">Porta</option><option value="glassDoor">Porta de vidro</option><option value="window">Janela</option>
            </select>
          </label>
        </>
      )}
      {(o.kind === 'decor' || o.kind === 'furniture') && (
        <label className="field"><span>Material</span><input className="input" value={o.material ?? ''} maxLength={60} disabled={locked} onChange={(e) => set({ material: e.target.value })} /></label>
      )}
      <label className="check"><input type="checkbox" checked={!!o.locked} onChange={(e) => set({ locked: e.target.checked })} /> Bloqueado (não move nem é removido)</label>
      {o.groupId && <p className="muted">Faz parte de um grupo: selecionar um membro seleciona todos.</p>}
      {asset && <p className="muted">Modelo: {asset.width}×{asset.depth}×{asset.height} m · {asset.license} · {asset.author}</p>}
    </div>
  );
}

function Bindings({ o, doc, kindIdx, saved, bindings, officeId, reload, user, onLockDesk }: {
  o: SceneObject; doc: SceneDoc; kindIdx: KindIndex; saved: boolean; bindings: BindingsData | null; officeId: string; reload: () => Promise<void>; user: SessionUser; onLockDesk: (deskId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const byId = indexObjects(doc);
  const desk = deskOf(byId, o.id, kindIdx);
  const isDeskItself = desk?.id === o.id;
  // vínculo da mesa (ou, em mapas antigos, de um computador sobre ela)
  const onDeskIds = desk ? [desk.id, ...descendants(doc, desk.id).filter((d) => d.kind === 'workstation').map((d) => d.id)] : [o.id];
  const seat = bindings?.seats.find((s) => onDeskIds.includes(s.objectId));
  const seatInfo = desk ? seatAnchorOf(byId, desk, kindIdx) : null;
  const seatPos = desk ? seatWorld(byId, desk, kindIdx) : null;
  const assignSeat = (employeeId: string) =>
    void run(async () => {
      await api.put(`/api/admin/offices/${officeId}/seats/${desk?.id ?? o.id}`, { employeeId: employeeId || null });
      // posição fixa: a mesa com colaborador fica travada para não sair do lugar por acidente
      if (employeeId && desk && !desk.locked) onLockDesk(desk.id);
    }, employeeId ? `Colaborador vinculado à ${desk?.name ?? 'mesa'}${desk && !desk.locked ? ' (mesa travada na posição; salve o rascunho)' : ''}.` : 'Mesa marcada como vaga.');
  const device = bindings?.bindings.find((b) => b.objectId === o.id && b.type === 'device');
  const dash = bindings?.bindings.find((b) => b.objectId === o.id && b.type === 'dashboard');
  const cad = bindings?.bindings.find((b) => b.objectId === o.id && b.type === 'cad_link');
  const [dashName, setDashName] = useState(dash?.config?.name ?? '');
  const [dashUrl, setDashUrl] = useState(dash?.config?.url ?? '');
  const [cadName, setCadName] = useState(cad?.config?.name ?? '');
  const [cadUrl, setCadUrl] = useState(cad?.config?.url ?? '');
  void user;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      toast(ok);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const deviceKinds = o.kind === 'printer' ? ['printer'] : o.kind === 'tv' ? ['tv_player', 'pc'] : ['pc'];
  if (!bindings) return null;
  return (
    <div className="stack">
      <hr className="sep" />
      <h3>Vínculos operacionais</h3>
      {!saved ? (
        <div className="notice info">Grave o rascunho para vincular colaborador, dispositivo ou painel a este objeto.</div>
      ) : (
        <>
          <p className="muted">Valem na hora para a versão publicada, pelo ID estável do objeto (não pelo nome nem pelo modelo).</p>
          {(isDeskItself || (o.kind === 'workstation' && !desk)) && (
            <div className="stack" data-testid="desk-binding">
              <label className="field"><span>Colaborador nesta mesa {seat && seat.state !== 'ok' && <span className="chip warn">órfão</span>}</span>
                <select className="input" disabled={busy} value={seat?.employeeId ?? ''} onChange={(e) => assignSeat(e.target.value)} aria-label="Colaborador nesta mesa">
                  <option value="">— mesa vaga —</option>
                  {seat && !bindings.employees.some((e) => e.id === seat.employeeId && e.active) && <option value={seat.employeeId}>{seat.employeeName ?? seat.employeeId} (inativo)</option>}
                  {bindings.employees.filter((e) => e.active).map((e) => {
                    const elsewhere = bindings.seats.find((s) => s.employeeId === e.id && !onDeskIds.includes(s.objectId));
                    return <option key={e.id} value={e.id}>{e.name} — {e.department}{elsewhere ? ' (sai da mesa atual)' : ''}</option>;
                  })}
                </select>
              </label>
              {seatPos && seatInfo && (
                <div className="notice info">
                  <b>Posição fixa:</b> {seatPos.x.toFixed(2).replace('.', ',')}; {seatPos.z.toFixed(2).replace('.', ',')} m · assento {seatInfo.source === 'chair' ? `na cadeira "${byId.get(seatInfo.chairId!)?.name}"` : seatInfo.source === 'manual' ? 'definido manualmente' : 'à frente da mesa (sem cadeira vinculada)'}.
                  {' '}Cada colaborador ocupa uma mesa por andar: vincular aqui tira a pessoa da mesa anterior.
                  {desk && !desk.locked && seat && <> <button className="btn small" onClick={() => onLockDesk(desk.id)}>Travar a mesa nesta posição</button></>}
                  {desk?.locked && <> Mesa travada.</>}
                </div>
              )}
            </div>
          )}
          {o.kind === 'workstation' && desk && (
            <div className="notice info">
              Este computador está sobre <b>{desk.name}</b> e mostra quem senta nela{seat?.employeeName ? ` (${seat.employeeName})` : ' (mesa vaga)'}. O colaborador é vinculado na própria mesa.
              {' '}<button className="btn small" onClick={() => useEditor.getState().select([desk.id])}>Selecionar a mesa</button>
            </div>
          )}
          {o.kind !== 'room' && !isDeskItself && (
            <label className="field"><span>Dispositivo gerenciado {device && device.state !== 'ok' && <span className="chip warn">órfão</span>}</span>
              <select className="input" disabled={busy} value={device?.deviceId ?? ''} onChange={(e) => void run(() => api.put(`/api/admin/offices/${officeId}/bindings/${o.id}`, e.target.value ? { type: 'device', deviceId: e.target.value } : { type: 'device', remove: true }), 'Dispositivo atualizado.')}>
                <option value="">— nenhum —</option>
                {device && device.state !== 'ok' && <option value={device.deviceId ?? ''}>{device.deviceName ?? device.deviceId} (removido)</option>}
                {bindings.devices.filter((d) => d.active && deviceKinds.includes(d.kind)).map((d) => <option key={d.id} value={d.id}>{d.name}{d.location ? ` — ${d.location}` : ''}</option>)}
              </select>
            </label>
          )}
          {o.kind === 'tv' && (
            <div className="stack">
              <div className="grid2">
                <label className="field"><span>Painel</span><input className="input" value={dashName} onChange={(e) => setDashName(e.target.value)} placeholder="Nome do painel" /></label>
                <label className="field"><span>Endereço</span><input className="input" value={dashUrl} onChange={(e) => setDashUrl(e.target.value)} placeholder="/demo/… ou https://host-autorizado" /></label>
              </div>
              <div className="row">
                <button className="btn small" disabled={busy || !dashName || !dashUrl} onClick={() => void run(() => api.put(`/api/admin/offices/${officeId}/bindings/${o.id}`, { type: 'dashboard', name: dashName, url: dashUrl }), 'Painel associado.')}>Salvar painel</button>
                {dash && <button className="btn small" disabled={busy} onClick={() => void run(() => api.put(`/api/admin/offices/${officeId}/bindings/${o.id}`, { type: 'dashboard', remove: true }), 'Painel removido.')}>Remover</button>}
              </div>
            </div>
          )}
          {o.kind === 'room' && (
            <div className="stack">
              <p className="muted">Link de projeto CAD (Autodesk — integração a confirmar; só hosts em CAD_ALLOWED_HOSTS).</p>
              <div className="grid2">
                <label className="field"><span>Nome</span><input className="input" value={cadName} onChange={(e) => setCadName(e.target.value)} /></label>
                <label className="field"><span>Endereço https</span><input className="input" value={cadUrl} onChange={(e) => setCadUrl(e.target.value)} /></label>
              </div>
              <button className="btn small" disabled={busy || !cadName || !cadUrl} onClick={() => void run(() => api.put(`/api/admin/offices/${officeId}/bindings/${o.id}`, { type: 'cad_link', name: cadName, url: cadUrl }), 'Link associado.')}>Salvar link</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
