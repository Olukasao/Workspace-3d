import { useFrame, useThree } from '@react-three/fiber';
import { AlignStartVertical, Copy, Group as GroupIcon, Lock, Redo2, RotateCw, Save, Send, Trash2, Undo2, Ungroup, Unlock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collisionWarnings, deskOf, indexObjects, seatWorld, type AssetIndex, type KindIndex } from '../../shared/scene';
import type { AssetDefinition, OfficeInfo, SceneDoc, SessionUser } from '../../shared/types';
import { api, ApiError, errorText } from '../api';
import { Scene3D, type FocusRequest } from '../three/Scene3D';
import { Dialog, dateTime, toast } from '../ui';
import { Catalog, UploadDialog } from './Catalog';
import { DragController, type DragStart } from './DragController';
import { DrawController, WallHandles, type DrawOptions, type Tool } from './DrawController';
import { DEFAULT_WALL } from './ops';
import { Inspector, type BindingsData } from './Inspector';
import { addAsset, addOpening, addWall, createRoom, duplicateObjects, groupObjects, isLocked, moveBy, patchObject, removeObjects, rotateBy, snapObjects, ungroupObjects } from './ops';
import { isDirty, useEditor } from './store';

interface DraftResponse {
  office: OfficeInfo;
  doc: SceneDoc;
  version: number;
  updatedAt: number;
}

/** Acompanha o alvo da câmera: é onde os objetos novos entram. */
function ViewCenter({ target }: { target: React.MutableRefObject<{ x: number; z: number }> }) {
  const controls = useThree((s) => s.controls) as unknown as { target?: { x: number; z: number } } | null;
  useFrame(() => {
    if (controls?.target) target.current = { x: controls.target.x, z: controls.target.z };
  });
  return null;
}

export function Editor({ officeId, user, onOfficeChanged }: { officeId: string; user: SessionUser; onOfficeChanged: () => void }) {
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selected);
  const version = useEditor((s) => s.version);
  const dirty = useEditor(isDirty);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const [office, setOffice] = useState<OfficeInfo | null>(null);
  const [assets, setAssets] = useState<AssetDefinition[]>([]);
  const [bindings, setBindings] = useState<BindingsData | null>(null);
  const [view, setView] = useState<'iso' | 'plan'>('iso');
  const [snap, setSnap] = useState(0.05);
  const [hovered, setHovered] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [conflict, setConflict] = useState<{ updatedBy: string | null; updatedAt: number } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [tool, setToolState] = useState<Tool>('select');
  const [drawOpts, setDrawOpts] = useState<Omit<DrawOptions, 'grid'>>({ floor: 'carpet', withWalls: false, wall: DEFAULT_WALL });
  const [clearOpen, setClearOpen] = useState(false);
  const setTool = useCallback((t: Tool) => {
    setToolState(t);
    if (t !== 'select') useEditor.getState().select([]);
    // desenhar é mais fácil na planta; dá para voltar ao 3D a qualquer momento
    if (t === 'floor' || t === 'wall') setView('plan');
  }, []);
  const center = useRef({ x: 0, z: 0 });
  const dragStart = useRef<DragStart | null>(null);
  const register = useCallback((fn: DragStart) => {
    dragStart.current = fn;
  }, []);

  const assetMap = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a])), [assets]);

  const loadDraft = useCallback(async () => {
    const d = await api.get<DraftResponse>(`/api/offices/${officeId}/draft`);
    useEditor.getState().load(officeId, d.doc, d.version);
    setOffice(d.office);
  }, [officeId]);
  const loadBindings = useCallback(async () => {
    const [b, dir, dev] = await Promise.all([
      api.get<Pick<BindingsData, 'seats' | 'bindings'>>(`/api/admin/offices/${officeId}/bindings`),
      api.get<{ employees: BindingsData['employees'] }>('/api/admin/directory'),
      api.get<{ devices: BindingsData['devices'] }>('/api/admin/devices'),
    ]);
    setBindings({ ...b, employees: dir.employees, devices: dev.devices });
  }, [officeId]);
  const loadAssets = useCallback(async () => setAssets((await api.get<{ assets: AssetDefinition[] }>('/api/assets')).assets), []);

  useEffect(() => {
    // mantém o rascunho local se já estiver carregado (voltar da operação não perde alterações não salvas)
    const st = useEditor.getState();
    Promise.all([st.officeId === officeId && st.doc ? api.get<DraftResponse>(`/api/offices/${officeId}/draft`).then((d) => setOffice(d.office)) : loadDraft(), loadAssets(), loadBindings()]).catch((e) => setError(errorText(e)));
  }, [officeId, loadDraft, loadAssets, loadBindings]);

  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (isDirty(useEditor.getState())) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, []);

  const warnings = useMemo(() => {
    if (!doc || !assets.length) return [];
    return collisionWarnings(doc, assetMap as unknown as AssetIndex);
  }, [doc, assetMap, assets.length]);
  const warningIds = useMemo(() => new Set(warnings.flatMap((w) => [w.a, w.b])), [warnings]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const apply = useEditor((s) => s.apply);

  // ---------- comandos ----------
  const cmd = {
    addAsset: (a: AssetDefinition) => {
      if (!doc) return;
      const [objs, id] = addAsset(doc.objects, doc.floorId, a, assetMap, { at: center.current, selectedId: selected[0] ?? null });
      apply(() => objs, [id]);
    },
    room: () => {
      if (!doc) return;
      const [objs, id] = createRoom(doc.objects, doc.floorId, center.current);
      apply(() => objs, [id]);
    },
    wall: () => {
      if (!doc) return;
      const [objs, id] = addWall(doc.objects, doc.floorId, center.current);
      apply(() => objs, [id]);
    },
    opening: (style: 'door' | 'glassDoor' | 'window') => {
      if (!doc) return;
      const sel = doc.objects.find((o) => o.id === selected[0]);
      const wallId = sel?.kind === 'wall' ? sel.id : sel?.kind === 'opening' ? sel.parentId : null;
      if (!wallId) return toast('Selecione uma parede para inserir a porta ou janela.');
      const out = addOpening(doc.objects, doc.floorId, wallId, style);
      if (!out) return toast('Não há trecho livre nesta parede para o vão.');
      apply(() => out[0], [out[1]]);
    },
    remove: () => {
      if (!doc || !selected.length) return;
      const [objs, removed] = removeObjects(doc.objects, selected);
      if (!removed.length) return toast('Os objetos selecionados estão bloqueados.');
      apply(() => objs, []);
      const locked = selected.filter((id) => !removed.includes(id));
      toast(`${removed.length} objeto(s) removido(s)${locked.length ? `; ${locked.length} bloqueado(s) ficaram` : ''}. Ctrl+Z desfaz.`);
    },
    duplicate: () => {
      if (!doc || !selected.length) return;
      const [objs, ids] = duplicateObjects(doc.objects, selected);
      apply(() => objs, ids);
    },
    rotate: (deg: number) => doc && selected.length && apply((o) => rotateBy(o, selected, (deg * Math.PI) / 180)),
    nudge: (dx: number, dz: number) => doc && selected.length && apply((o) => moveBy(o, selected, dx, dz)),
    lift: (dy: number) =>
      doc &&
      selected.length &&
      apply((objs) => objs.map((o) => (selected.includes(o.id) && !isLocked(objs, o.id) && o.kind !== 'room' && o.kind !== 'wall' ? { ...o, t: { ...o.t, y: Math.max(0, Math.round((o.t.y + dy) * 1000) / 1000) } } : o))),
    group: () => {
      if (!doc) return;
      const [objs, gid] = groupObjects(doc.objects, selected);
      if (!gid) return toast('Selecione dois ou mais objetos (Shift + clique) para agrupar.');
      apply(() => objs);
    },
    ungroup: () => doc && apply((o) => ungroupObjects(o, selected)),
    lock: (v: boolean) => doc && apply((objs) => selected.reduce((acc, id) => patchObject(acc, id, { locked: v }), objs)),
    align: () => doc && selected.length && apply((o) => snapObjects(o, selected, snap || 0.05)),
  };

  const save = async (): Promise<number | null> => {
    const st = useEditor.getState();
    if (!st.doc) return null;
    setBusy('save');
    try {
      const out = await api.put<{ version: number }>(`/api/offices/${officeId}/draft`, { doc: st.doc, baseVersion: st.version });
      st.markSaved(out.version, st.doc);
      toast(`Rascunho gravado (versão ${out.version}).`);
      await loadBindings();
      return out.version;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'draft_conflict') setConflict({ updatedBy: (e.body.updatedBy as string) ?? null, updatedAt: Number(e.body.updatedAt) || 0 });
      else if (e instanceof ApiError && e.code === 'invalid_scene') setError(`${e.message} ${((e.body.details as string[]) ?? []).slice(0, 4).join(' ')}`);
      else setError(errorText(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const publish = async (note: string) => {
    let v: number | null = useEditor.getState().version;
    if (isDirty(useEditor.getState())) v = await save();
    if (v === null) return;
    setBusy('publish');
    try {
      const out = await api.post<{ number: number }>(`/api/offices/${officeId}/publish`, { baseVersion: v, note });
      toast(`Revisão ${out.number} publicada. Operadores já veem esta versão.`);
      setPublishOpen(false);
      const d = await api.get<DraftResponse>(`/api/offices/${officeId}/draft`);
      setOffice(d.office);
      onOfficeChanged();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'draft_conflict') setConflict({ updatedBy: (e.body.updatedBy as string) ?? null, updatedAt: Number(e.body.updatedAt) || 0 });
      else setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  // ---------- teclado ----------
  const cmdRef = useRef(cmd);
  cmdRef.current = cmd;
  const toolRef = useRef(setTool);
  toolRef.current = setTool;
  const toolActive = useRef(false);
  toolActive.current = tool !== 'select';
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (document.querySelector('.overlay')) return;
      const c = cmdRef.current;
      const st = useEditor.getState();
      if (toolActive.current && (e.key === 'Escape' || e.key === 'Enter')) return;
      const mod = e.ctrlKey || e.metaKey;
      const step = snap || 0.05;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) st.undo();
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) st.redo();
      else if (mod && e.key.toLowerCase() === 'd') c.duplicate();
      else if (mod && e.key.toLowerCase() === 's') void saveRef.current();
      else if (mod && e.key.toLowerCase() === 'g') (e.shiftKey ? c.ungroup : c.group)();
      else if (!mod && (e.key === 'v' || e.key === 'V')) toolRef.current('select');
      else if (!mod && (e.key === 'f' || e.key === 'F')) toolRef.current('floor');
      else if (!mod && (e.key === 'w' || e.key === 'W')) toolRef.current('wall');
      else if (!mod && (e.key === 'p' || e.key === 'P')) toolRef.current('door');
      else if (!mod && (e.key === 'j' || e.key === 'J')) toolRef.current('window');
      else if (e.key === 'Delete' || e.key === 'Backspace') c.remove();
      else if (e.key === 'r' || e.key === 'R') c.rotate(e.shiftKey ? -15 : 15);
      else if (e.key === 'ArrowLeft') c.nudge(-step, 0);
      else if (e.key === 'ArrowRight') c.nudge(step, 0);
      else if (e.key === 'ArrowUp') c.nudge(0, -step);
      else if (e.key === 'ArrowDown') c.nudge(0, step);
      else if (e.key === 'PageUp') c.lift(0.05);
      else if (e.key === 'PageDown') c.lift(-0.05);
      else if (e.key === 'Escape') st.select([]);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snap]);

  if (error && !doc) return <div className="page"><div className="notice bad">{error}</div></div>;
  if (!doc || !office) return <div className="loading">Carregando o rascunho…</div>;

  const byId = indexObjects(doc);
  const sel = selected.map((id) => byId.get(id)).filter(Boolean);
  const anyLocked = sel.some((o) => o!.locked);
  // assento fixo da mesa selecionada (ou da mesa sob o objeto selecionado)
  const kindIdx: KindIndex = Object.fromEntries(assets.map((a) => [a.id, { defaultKind: a.defaultKind, category: a.category }]));
  const selDesk = selected.length === 1 ? deskOf(byId, selected[0], kindIdx) : null;
  const occupant = selDesk ? bindings?.seats.find((x) => x.objectId === selDesk.id)?.employeeName : null;
  const seatMarkers = selDesk ? [{ ...seatWorld(byId, selDesk, kindIdx), label: occupant ? `Assento de ${occupant}` : `Assento da ${selDesk.name} (vaga)` }] : undefined;
  const savedIds = new Set((JSON.parse(useEditor.getState().savedJson || '{"objects":[]}') as SceneDoc).objects.map((o) => o.id));

  return (
    <div className="workspace">
      <aside className="side" aria-label="Catálogo e estrutura">
        <Catalog
          assets={assets}
          doc={doc}
          onAdd={cmd.addAsset}
          tool={tool}
          setTool={setTool}
          drawOpts={drawOpts}
          setDrawOpts={setDrawOpts}
          onClearPlan={() => setClearOpen(true)}
          onUpload={() => setUploadOpen(true)}
          onSelectObject={(id) => {
            useEditor.getState().select([id]);
            const o = byId.get(id);
            // o enquadramento acompanha o tamanho: paredes e pisos longos precisam ter as pontas visíveis (puxadores)
            if (o) setFocus({ x: o.t.x, z: o.t.z, radius: o.wall ? o.wall.length / 2 + 1.5 : o.room ? Math.max(o.room.w, o.room.d) / 2 + 1.5 : 3, nonce: Date.now() });
          }}
          selected={selectedSet}
        />
      </aside>
      <section className="stage" aria-label="Cena do editor">
        <div className="stage-bar">
          <div className="toolgroup" role="group" aria-label="Vista">
            <button className="btn small" aria-pressed={view === 'plan'} onClick={() => setView('plan')}>Planta</button>
            <button className="btn small" aria-pressed={view === 'iso'} onClick={() => setView('iso')}>3D</button>
          </div>
          <div className="toolgroup" role="group" aria-label="Histórico">
            <button className="btn icon" onClick={() => useEditor.getState().undo()} disabled={!canUndo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer"><Undo2 size={16} /></button>
            <button className="btn icon" onClick={() => useEditor.getState().redo()} disabled={!canRedo} title="Refazer (Ctrl+Y)" aria-label="Refazer"><Redo2 size={16} /></button>
          </div>
          <div className="toolgroup" role="group" aria-label="Objeto">
            <button className="btn icon" onClick={() => cmd.rotate(15)} disabled={!sel.length} title="Girar 15° (R; Shift+R volta)" aria-label="Girar"><RotateCw size={16} /></button>
            <button className="btn icon" onClick={cmd.duplicate} disabled={!sel.length} title="Duplicar (Ctrl+D)" aria-label="Duplicar"><Copy size={16} /></button>
            <button className="btn icon" onClick={cmd.group} disabled={sel.length < 2} title="Agrupar (Ctrl+G)" aria-label="Agrupar"><GroupIcon size={16} /></button>
            <button className="btn icon" onClick={cmd.ungroup} disabled={!sel.some((o) => o!.groupId)} title="Desagrupar (Ctrl+Shift+G)" aria-label="Desagrupar"><Ungroup size={16} /></button>
            <button className="btn icon" onClick={() => cmd.lock(!anyLocked)} disabled={!sel.length} title={anyLocked ? 'Desbloquear' : 'Bloquear'} aria-label={anyLocked ? 'Desbloquear' : 'Bloquear'}>{anyLocked ? <Unlock size={16} /> : <Lock size={16} />}</button>
            <button className="btn icon" onClick={cmd.align} disabled={!sel.length} title="Alinhar à grade" aria-label="Alinhar à grade"><AlignStartVertical size={16} /></button>
            <button className="btn icon danger" onClick={cmd.remove} disabled={!sel.length} title="Remover (Delete)" aria-label="Remover"><Trash2 size={16} /></button>
          </div>
          <div className="toolgroup" role="group" aria-label="Grade">
            <label className="muted" style={{ padding: '0 4px' }} htmlFor="snap">Grade</label>
            <select id="snap" className="input" value={snap} onChange={(e) => setSnap(Number(e.target.value))}>
              <option value={0}>livre</option>
              <option value={0.05}>5 cm</option>
              <option value={0.1}>10 cm</option>
              <option value={0.25}>25 cm</option>
              <option value={0.5}>50 cm</option>
            </select>
          </div>
          <div className="spacer" />
          {warnings.length > 0 && <span className="status-pill" title="Sobreposições são avisos: podem ser legítimas (cadeira sob a mesa).">⚠ {warnings.length} sobreposição(ões)</span>}
          <span className="status-pill" data-testid="draft-status">
            Rascunho v{version} · {dirty ? <b style={{ color: 'var(--amber)' }}>alterações não salvas</b> : 'salvo'}
          </span>
          <div className="toolgroup">
            <button className="btn" onClick={() => void save()} disabled={!dirty || busy !== null}><Save size={15} /> {busy === 'save' ? 'Gravando…' : 'Salvar'}</button>
            <button className="btn primary" onClick={() => setPublishOpen(true)} disabled={busy !== null}><Send size={15} /> Publicar</button>
          </div>
        </div>
        <Scene3D
          doc={doc}
          assets={assetMap}
          view={view}
          selected={selectedSet}
          hovered={hovered}
          warnings={warningIds}
          interactive={() => tool === 'select'}
          drawing={tool !== 'select'}
          onPointerDownObject={(id, e) => tool === 'select' && dragStart.current?.(id, e)}
          onHover={setHovered}
          onMissed={() => useEditor.getState().select([])}
          focus={focus}
          showGrid={snap >= 0.25 ? snap : 0.5}
          seatMarkers={tool === 'select' ? seatMarkers : undefined}
        >
          <DragController assets={assetMap} snap={snap} register={register} />
          <DrawController tool={tool} options={{ ...drawOpts, grid: snap || 0.05 }} onToolDone={() => setTool('select')} />
          {tool === 'select' && selected.length === 1 && byId.get(selected[0])?.kind === 'wall' && <WallHandles wallId={selected[0]} grid={snap || 0.05} />}
          <ViewCenter target={center} />
        </Scene3D>
        <div className="stage-hint" data-testid="tool-hint">{TOOL_HINT[tool]}</div>
        {error && (
          <div className="notice bad" style={{ position: 'absolute', left: 12, right: 12, bottom: 34 }} role="alert">
            {error} <button className="btn small ghost" onClick={() => setError(null)}>Fechar</button>
          </div>
        )}
      </section>
      <aside className="side right" aria-label="Inspetor">
        <Inspector
          doc={doc}
          assets={assets}
          assetMap={assetMap}
          selected={selected}
          office={office}
          user={user}
          bindings={bindings}
          savedIds={savedIds}
          warnings={warnings}
          reloadBindings={loadBindings}
          officeId={officeId}
        />
      </aside>

      {clearOpen && (
        <Dialog title="Começar com o plano vazio" onClose={() => setClearOpen(false)} footer={
          <>
            <button className="btn" onClick={() => setClearOpen(false)}>Cancelar</button>
            <button className="btn primary" onClick={() => { apply(() => [], []); setClearOpen(false); setTool('floor'); toast('Plano vazio. Desenhe os pisos (F) e as paredes (W). Ctrl+Z desfaz.'); }}>Esvaziar o rascunho</button>
          </>
        }>
          <p>Remove <b>todos</b> os {doc.objects.length} objetos do rascunho (inclusive bloqueados) para você desenhar a estrutura do zero.</p>
          <p className="muted">Nada muda para os operadores até você salvar e publicar. Dá para desfazer com Ctrl+Z. Vínculos de colaboradores e dispositivos dos objetos removidos ficam como órfãos e podem ser refeitos depois.</p>
        </Dialog>
      )}
      {publishOpen && <PublishDialog office={office} dirty={dirty} busy={busy !== null} onClose={() => setPublishOpen(false)} onConfirm={publish} />}
      {uploadOpen && <UploadDialog onClose={() => setUploadOpen(false)} onUploaded={() => void loadAssets()} />}
      {conflict && (
        <Dialog title="Conflito de edição" onClose={() => setConflict(null)} footer={
          <>
            <button className="btn" onClick={() => setConflict(null)}>Continuar editando (sem gravar)</button>
            <button className="btn primary" onClick={() => { setConflict(null); void loadDraft().then(loadBindings); }}>Descartar minhas alterações e recarregar</button>
          </>
        }>
          <div className="notice warn">
            {conflict.updatedBy ?? 'Outra pessoa'} gravou este mapa{conflict.updatedAt ? ` em ${dateTime(conflict.updatedAt)}` : ''}, depois que você o abriu. Suas alterações não foram gravadas para não sobrescrever o trabalho de outra pessoa.
          </div>
          <p className="muted">Para manter as duas versões, anote suas alterações, recarregue e refaça-as sobre a versão atual.</p>
        </Dialog>
      )}
    </div>
  );
}

const TOOL_HINT: Record<Tool, string> = {
  select: 'Arraste para mover · Shift+clique soma à seleção · R gira · PageUp/PageDown altura · setas ajustam · Ctrl+Z desfaz · Esc limpa a seleção',
  floor: 'Piso: clique e arraste um retângulo no chão · encaixa na grade e nos cantos existentes · Alt desliga o encaixe · Esc volta à seleção',
  wall: 'Parede: clique no início e em cada ponto seguinte · encaixa a cada 45°, na grade e nas pontas · Alt = ângulo livre · Enter, Esc ou duplo clique termina',
  door: 'Porta: clique na parede onde ela deve ficar · Esc volta à seleção',
  window: 'Janela: clique na parede onde ela deve ficar · Esc volta à seleção',
  glassDoor: 'Porta de vidro: clique na parede onde ela deve ficar · Esc volta à seleção',
};

function PublishDialog({ office, dirty, busy, onClose, onConfirm }: { office: OfficeInfo; dirty: boolean; busy: boolean; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <Dialog title="Publicar revisão" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy} onClick={() => onConfirm(note)}>{busy ? 'Publicando…' : dirty ? 'Salvar e publicar' : 'Publicar'}</button>
      </>
    }>
      <p>Operadores e visualizadores passam a ver esta versão do mapa. A publicação é atômica: se outra pessoa tiver gravado antes, nada muda.</p>
      <p className="muted">Revisão atual: {office.publishedRevision ? `nº ${office.publishedRevision.number}, de ${dateTime(office.publishedRevision.publishedAt)} por ${office.publishedRevision.publishedBy}` : 'nenhuma'}.</p>
      {dirty && <div className="notice info">Há alterações não salvas: elas serão gravadas antes de publicar.</div>}
      <label className="field">
        <span>Nota da revisão (opcional)</span>
        <input className="input" value={note} maxLength={250} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: novo posto no atendimento" />
      </label>
    </Dialog>
  );
}

