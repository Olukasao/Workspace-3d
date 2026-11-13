/**
 * "Meu avatar": personalização com preview 3D giratório (em pé ou sentado na estação).
 * Alterações em edição ficam só neste preview; "Salvar" grava no servidor (com versão) e os colegas autorizados
 * veem a nova aparência na hora — inclusive se você estiver em atendimento. "Cancelar" volta ao que está salvo.
 */
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { RotateCcw, Save } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { validateForStyle, type AnyAvatarConfig, type AvatarStyle } from '../../shared/avatarAra';
import { AVATAR_CATALOG, FACES, LOOKS, PALETTES, SKIN_TONES, switchBase, type AvatarBase, type AvatarConfig, type AvatarSlot } from '../../shared/avatarCatalog';
import type { SessionUser } from '../../shared/types';
import { api, ApiError, errorText } from '../api';
import { Avatar } from '../three/avatar/Avatar';
import { type PoseState } from '../three/avatar/rig';
import { Station } from './Station';
import { toast } from '../ui';

const SKIN_SWATCH: Record<string, string> = { 'pele-1': '#e8c4a8', 'pele-2': '#d9b08c', 'pele-3': '#c99a76', 'pele-4': '#7a4b30', 'pele-5': '#5a3624' };

function MakeHumanEditor({ user }: { user: SessionUser }) {
  const [saved, setSaved] = useState<{ config: AnyAvatarConfig; version: number; saved: boolean; style: AvatarStyle } | null>(null);
  const [draftAny, setDraft] = useState<AnyAvatarConfig | null>(null);
  const [pose, setPose] = useState<'stand' | 'sit'>('stand');
  const [preview, setPreview] = useState<'idle' | 'typing' | 'call'>('idle');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () =>
    api.get<{ config: AnyAvatarConfig; version: number; saved: boolean; style: AvatarStyle }>('/api/avatar/me').then(
      (r) => {
        setSaved(r);
        setDraft(r.config);
      },
      (e) => setErr(errorText(e)),
    );
  useEffect(() => {
    void load();
  }, []);

  const dirty = useMemo(() => !!draftAny && !!saved && JSON.stringify(draftAny) !== JSON.stringify(saved.config), [draftAny, saved]);
  const errors = draftAny && saved ? validateForStyle(saved.style, draftAny) : [];
  if (err && !draftAny) return <div className="page"><div className="notice warn">{err}</div></div>;
  if (!draftAny || !saved) return <div className="loading">Carregando seu avatar…</div>;
  // este editor só roda no estilo MakeHuman: a aparência é sempre uma AvatarConfig
  const draft = draftAny as AvatarConfig;

  const set = (patch: Partial<AvatarConfig>) => setDraft({ ...draft, ...patch });
  const items = (slot: AvatarSlot) => AVATAR_CATALOG.filter((i) => i.slot === slot && i.bases.includes(draft.base));
  const posed: PoseState = { mode: pose, activity: pose === 'sit' ? preview : 'idle', speaking: preview === 'call' ? null : null };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.put<{ version: number; config: AnyAvatarConfig }>('/api/avatar/me', { config: draftAny, baseVersion: saved.version });
      setSaved({ config: r.config, version: r.version, saved: true, style: saved.style });
      setDraft(r.config);
      toast('Avatar salvo. Seus colegas já veem a nova aparência.');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'avatar_conflict') setErr('Seu avatar foi salvo em outra aba ou dispositivo. Clique em "Cancelar" para carregar a versão atual.');
      else setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const Choice = ({ slot, allowNone }: { slot: AvatarSlot; allowNone?: boolean }) => (
    <div className="choice-grid" role="radiogroup" aria-label={slot}>
      {allowNone && <button className="btn small" aria-pressed={(draft as unknown as Record<string, string>)[slot] === 'none'} onClick={() => set({ [slot]: 'none' } as Partial<AvatarConfig>)}>Nenhum</button>}
      {items(slot).map((i) => (
        <button key={i.id} className="btn small" aria-pressed={(draft as unknown as Record<string, string>)[slot] === i.id} data-item={i.id} onClick={() => set({ [slot]: i.id, ...(i.palette && slot !== 'beard' ? { [`${slot}Color`]: i.defaultColor ?? PALETTES[i.palette][0].id } : {}) } as Partial<AvatarConfig>)}>
          {i.name}
        </button>
      ))}
    </div>
  );
  const Colors = ({ palette, field }: { palette: keyof typeof PALETTES; field: keyof AvatarConfig }) => (
    <div className="swatches" role="radiogroup" aria-label={`Cor (${field})`}>
      {PALETTES[palette].map((c) => (
        <button key={c.id} className="swatch" style={{ background: c.hex }} title={c.name} aria-label={c.name} aria-pressed={draft[field] === c.id} data-color={`${field}:${c.id}`} onClick={() => set({ [field]: c.id } as Partial<AvatarConfig>)} />
      ))}
    </div>
  );

  return (
    <div className="avatar-editor">
      <section className="avatar-stage" aria-label="Pré-visualização do avatar">
        <Canvas shadows camera={{ position: [1.6, 1.5, 2.6], fov: 30 }} gl={{ antialias: true }}>
          <ambientLight intensity={0.45} />
          <hemisphereLight args={['#ffffff', '#cfd5dd', 0.8]} />
          <directionalLight position={[2.5, 4, 3]} intensity={2} castShadow shadow-mapSize={[1024, 1024]} />
          <Environment resolution={64}>
            <Lightformer form="rect" intensity={2} position={[0, 4, 2]} scale={[6, 4, 1]} />
          </Environment>
          {pose === 'sit' && <Station />}
          <Avatar seat={{ x: 0, z: 0, rotY: 0 }} config={draftAny} pose={posed} label={user.name} fixedLod={0} />
          <ContactShadows position={[0, 0.001, 0]} opacity={0.35} scale={4} blur={2.4} far={2} />
          <OrbitControls target={[0, pose === 'sit' ? 0.85 : 1.0, pose === 'sit' ? 0.2 : 0]} autoRotate autoRotateSpeed={0.9} enablePan={false} minDistance={1.4} maxDistance={4.5} maxPolarAngle={Math.PI / 1.9} />
        </Canvas>
        <div className="stage-bar">
          <div className="toolgroup" role="group" aria-label="Pose">
            <button className="btn small" aria-pressed={pose === 'stand'} onClick={() => setPose('stand')}>Em pé</button>
            <button className="btn small" aria-pressed={pose === 'sit'} onClick={() => setPose('sit')}>Sentado na estação</button>
          </div>
          {pose === 'sit' && (
            <div className="toolgroup" role="group" aria-label="Atividade (só no preview)">
              <button className="btn small" aria-pressed={preview === 'idle'} onClick={() => setPreview('idle')}>Trabalhando</button>
              <button className="btn small" aria-pressed={preview === 'typing'} onClick={() => setPreview('typing')}>Digitando</button>
              <button className="btn small" aria-pressed={preview === 'call'} onClick={() => setPreview('call')}>Em atendimento</button>
            </div>
          )}
          <div className="spacer" />
          <span className="status-pill">{dirty ? 'Alterações só neste preview' : saved.saved ? `Salvo (versão ${saved.version})` : 'Aparência padrão (ainda não salva)'}</span>
        </div>
      </section>
      <aside className="side right" aria-label="Personalizar avatar">
        <div className="side-head">
          <h2>Meu avatar</h2>
          <p className="muted">Só você edita o seu avatar. Depois de salvar, ele aparece para os colegas na sua mesa.</p>
          <div className="row">
            <button className="btn primary" disabled={!dirty || busy || errors.length > 0} onClick={() => void save()} data-testid="avatar-save"><Save size={14} /> {busy ? 'Salvando…' : 'Salvar'}</button>
            <button className="btn" disabled={busy} onClick={() => { setErr(null); void load(); }} data-testid="avatar-cancel"><RotateCcw size={14} /> Cancelar</button>
          </div>
          {err && <div className="notice bad" role="alert">{err}</div>}
          {errors.length > 0 && <div className="notice warn">{errors.join(' ')}</div>}
        </div>
        <div className="side-body">
          <div className="stack">
            <h3>Corpo-base</h3>
            <div className="tabs">
              {(['male', 'female'] as AvatarBase[]).map((b) => (
                <button key={b} aria-pressed={draft.base === b} data-base={b} onClick={() => setDraft(switchBase(draft, b))}>{b === 'male' ? 'Masculino' : 'Feminino'}</button>
              ))}
            </div>
            <p className="muted">Ao trocar, as peças compatíveis continuam; as outras viram peças padrão.</p>
          </div>
          <div className="stack">
            <h3>Looks prontos</h3>
            <div className="choice-grid">
              {LOOKS.filter((l) => l.base === draft.base).map((l) => (
                <button key={l.id} className="btn small" data-look={l.id} onClick={() => setDraft({ ...draft, ...l.config })}>{l.name} <span className="muted">· {l.style === 'casual' ? 'casual' : 'corporativo'}</span></button>
              ))}
            </div>
          </div>
          <div className="stack">
            <h3>Pele e rosto</h3>
            <div className="swatches" role="radiogroup" aria-label="Tom de pele">
              {SKIN_TONES.map((s) => <button key={s.id} className="swatch" style={{ background: SKIN_SWATCH[s.id] }} title={s.name} aria-label={s.name} aria-pressed={draft.skin === s.id} onClick={() => set({ skin: s.id })} />)}
            </div>
            <div className="choice-grid">
              {FACES.map((f) => <button key={f.id} className="btn small" aria-pressed={draft.face === f.id} onClick={() => set({ face: f.id })}>{f.name}</button>)}
            </div>
          </div>
          <div className="stack">
            <h3>Cabelo</h3>
            <Choice slot="hair" />
            <Colors palette="hair" field="hairColor" />
            {draft.base === 'male' && (
              <>
                <h3>Barba</h3>
                <Choice slot="beard" allowNone />
              </>
            )}
          </div>
          <div className="stack">
            <h3>Parte de cima</h3>
            <Choice slot="top" />
            <Colors palette="top" field="topColor" />
          </div>
          <div className="stack">
            <h3>Parte de baixo</h3>
            <Choice slot="bottom" />
            <Colors palette="bottom" field="bottomColor" />
          </div>
          <div className="stack">
            <h3>Calçado</h3>
            <Choice slot="shoes" />
            <Colors palette="shoes" field="shoesColor" />
          </div>
          <div className="stack">
            <h3>Acessórios</h3>
            <Choice slot="glasses" allowNone />
            <label className="check"><input type="checkbox" checked={draft.headsetAlways} onChange={(e) => set({ headsetAlways: e.target.checked })} /> Usar o headset sempre (ele entra sozinho durante atendimentos)</label>
          </div>
        </div>
      </aside>
    </div>
  );
}

const AraEditor = lazy(() => import('./ara/AraEditor').then((m) => ({ default: m.AraEditor })));

/** "Meu avatar": o editor depende do estilo de avatar que o administrador escolheu para a empresa. */
export function AvatarEditor({ user }: { user: SessionUser }) {
  const [style, setStyle] = useState<AvatarStyle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ style: AvatarStyle }>('/api/avatar/me').then((r) => setStyle(r.style), (e) => setErr(errorText(e)));
  }, []);
  if (err) return <div className="page"><div className="notice warn">{err}</div></div>;
  if (!style) return <div className="loading">Carregando seu avatar…</div>;
  if (style === 'ara3d')
    return (
      <Suspense fallback={<div className="loading">Carregando o editor de avatar…</div>}>
        <AraEditor user={user} />
      </Suspense>
    );
  return <MakeHumanEditor user={user} />;
}
