/**
 * "Meu avatar" no estilo Ara 3D Gen: editor completo, como o do próprio Ara.
 *  - Montar: corpo, idade, etnia, pele, rosto, cabelo, barba, brincos, roupas (com padrão e cor), sapatos e acessórios;
 *  - Detalhado: os controles finos do corpo e do rosto, por grupo;
 *  - ou começar de um dos 16 personagens prontos.
 * A pré-visualização é gerada no navegador (worker com o gerador do Ara) e mostra o que você está montando. Ao salvar, o
 * servidor valida os parâmetros e gera o modelo que os colegas veem. Só você edita o seu avatar.
 */
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { RotateCcw, Save, Shuffle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ARA_EYEBROWS, ARA_EYELASHES, ARA_EYES, ARA_HAIR, ARA_PRESETS, ARA_SKINS } from '../../../shared/araCatalog.generated';
import { ARA_DEFAULT_PARAMS, ARA_EARRINGS, ARA_EDITOR_SLIDERS, ARA_FACIAL_HAIR, ARA_MIN_AGE, ARA_OFFICE, ARA_PROCEDURAL_HAIR, ageToYears, normalizeAraParams, yearsToAge, type AraParams } from '../../../shared/araCustom';
import { CATEGORY_PT, browPt, earringPt, eyesPt, facialHairPt, groupPt, hairPt, lashPt, outfitPt, patternPt, piecePt, skinPt, sliderLabelPt } from '../../../shared/araLabels';
import { isAraCustom, isAraPreset, type AraAvatarConfig, type AraCustomConfig } from '../../../shared/avatarAra';
import type { SessionUser } from '../../../shared/types';
import { api, ApiError, errorText } from '../../api';
import { Avatar } from '../../three/avatar/Avatar';
import { dropPreviewModel, registerPreviewModel } from '../../three/avatar/ara';
import type { PoseState } from '../../three/avatar/rig';
import { toast } from '../../ui';
import { Station } from '../Station';
import { ColorField, FABRIC_COLORS, NATURAL_HAIR, OptionGrid, Slider } from './controls';
import { buildPreview, disposePreview, isSuperseded } from './preview';

interface Me {
  style: 'ara3d';
  config: AraAvatarConfig;
  version: number;
  saved: boolean;
}

const full = (p: Partial<AraParams>): AraParams => ({ ...ARA_DEFAULT_PARAMS, ...p, modifiers: { ...(p.modifiers ?? {}) }, accessories: [...(p.accessories ?? [])], garmentStyles: { ...(p.garmentStyles ?? {}) } });
/** Parâmetros editáveis de uma aparência salva: personalizada, ou o personagem pronto como ponto de partida. */
function paramsOf(c: AraAvatarConfig): AraParams {
  if (isAraCustom(c)) return full(c.custom);
  const preset = isAraPreset(c) ? ARA_PRESETS.find((p) => p.id === c.character) : undefined;
  return full((preset?.params ?? {}) as Partial<AraParams>);
}
const norm = (p: AraParams) => JSON.stringify(normalizeAraParams(p).params);
const CATEGORIES = ['Gender', 'Face', 'Torso', 'Arms and Legs'];
const SET_PIECES: Record<string, string[]> = { set_suit_tie: ['set_suit_tie', 'suit_shirt_tie'], set_pantsuit: ['set_pantsuit', 'silk_blouse'] };

export function AraEditor({ user }: { user: SessionUser }) {
  const [me, setMe] = useState<Me | null>(null);
  const [draft, setDraft] = useState<AraParams>(ARA_DEFAULT_PARAMS);
  const [headset, setHeadset] = useState(false);
  const [shown, setShown] = useState<AraAvatarConfig | null>(null); // o que a prévia 3D desenha agora
  const [building, setBuilding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'montar' | 'detalhado'>('montar');
  const [cat, setCat] = useState('Face');
  const [pose, setPose] = useState<'stand' | 'sit'>('stand');
  const [activity, setActivity] = useState<'idle' | 'typing' | 'call'>('idle');
  const lastBuilt = useRef('');
  const loadSeq = useRef(0); // só a leitura mais recente vale: uma resposta atrasada não pode apagar o que a pessoa já editou
  const previewKeys = useRef<string[]>([]);

  const load = () => {
    const n = ++loadSeq.current;
    return api.get<Me>('/api/avatar/me').then(
      (r) => {
        if (n !== loadSeq.current) return;
        const p = paramsOf(r.config);
        setMe(r);
        setDraft(p);
        setHeadset(r.config.headsetAlways);
        setShown(r.config);
        lastBuilt.current = norm(p);
        setErr(null);
      },
      (e) => n === loadSeq.current && setErr(errorText(e)),
    );
  };
  useEffect(() => {
    void load();
    return () => {
      disposePreview();
      for (const k of previewKeys.current) dropPreviewModel(k);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const check = useMemo(() => normalizeAraParams(draft), [draft]);
  const savedNorm = useMemo(() => (me ? norm(paramsOf(me.config)) : ''), [me]);
  const dirty = !!me && (norm(draft) !== savedNorm || headset !== me.config.headsetAlways);

  // pré-visualização: gera o modelo no navegador (com pausa depois da última mudança) e troca quando ficar pronto
  useEffect(() => {
    if (!me || check.errors.length) return;
    const json = JSON.stringify(check.params);
    if (json === lastBuilt.current) return;
    const t = setTimeout(async () => {
      setBuilding(true);
      try {
        const r = await buildPreview(check.params);
        const key = `preview-${r.id}`;
        registerPreviewModel(key, r.glb);
        previewKeys.current.push(key);
        for (const old of previewKeys.current.splice(0, previewKeys.current.length - 2)) dropPreviewModel(old);
        lastBuilt.current = json;
        setShown({ v: 1, style: 'ara3d', custom: check.params, model: key, headsetAlways: false });
        setErr(null);
        setBuilding(false);
      } catch (e) {
        if (isSuperseded(e)) return; // chegou um pedido mais novo: ele cuida do resto
        setBuilding(false);
        setErr(`Não foi possível gerar a pré-visualização: ${errorText(e)}`);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [me, check]);

  if (err && !me) return <div className="page"><div className="notice warn">{err}</div></div>;
  if (!me || !shown) return <div className="loading">Carregando seu avatar…</div>;

  const set = <K extends keyof AraParams>(k: K, v: AraParams[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setStyle = (piece: string, patch: Partial<{ pattern: string; color: string; color2: string }>) => setDraft((d) => ({ ...d, garmentStyles: { ...d.garmentStyles, [piece]: { ...d.garmentStyles[piece], ...patch } } }));
  const setMod = (id: string, v: number) =>
    setDraft((d) => {
      const m = { ...d.modifiers };
      if (v === 0) delete m[id];
      else m[id] = v;
      return { ...d, modifiers: m };
    });
  const female = draft.gender < 0.5;
  const outfitOptions = ARA_OFFICE.outfits.filter((o) => o !== 'none' && !(o.startsWith('male_') && draft.gender < 0.3) && !(o.startsWith('female_') && draft.gender > 0.7));
  const compatible = (o: string) => !(o.startsWith('male_') && draft.gender < 0.3) && !(o.startsWith('female_') && draft.gender > 0.7);
  const setGender = (g: number) =>
    setDraft((d) => {
      const out = { ...d, gender: g };
      if (d.outfit !== 'none' && d.outfit.startsWith('male_') && g < 0.3) out.outfit = 'set_pantsuit';
      if (d.outfit !== 'none' && d.outfit.startsWith('female_') && g > 0.7) out.outfit = 'set_suit_tie';
      return out;
    });
  const mode = draft.outfit === 'none' ? 'pieces' : 'set';

  const pieceStyle = (piece: string, label: string) => {
    const patterns = ARA_OFFICE.patterns[piece] ?? [];
    const st = draft.garmentStyles[piece] ?? {};
    return (
      <div className="piece-style" data-piece={piece} key={piece}>
        <b>{label}</b>
        {patterns.length > 1 && (
          <label className="slider-row">
            <span className="slider-label">Tecido</span>
            <select value={st.pattern ?? patterns[0]} aria-label={`Tecido: ${label}`} onChange={(e) => setStyle(piece, { pattern: e.target.value })}>
              {patterns.map((p) => <option key={p} value={p}>{patternPt(p)}</option>)}
            </select>
          </label>
        )}
        <ColorField label="Cor" id={`${piece}-color`} value={st.color ?? '#6b7280'} swatches={FABRIC_COLORS} onChange={(c) => setStyle(piece, { color: c })} />
        {['set_suit_tie', 'set_pantsuit', 'suit_shirt_tie'].includes(piece) && <ColorField label={piece === 'suit_shirt_tie' ? 'Cor da gravata' : 'Cor secundária (forro e detalhes)'} id={`${piece}-color2`} value={st.color2 ?? '#3d4048'} swatches={FABRIC_COLORS} onChange={(c) => setStyle(piece, { color2: c })} />}
      </div>
    );
  };

  const pieceSelect = (field: 'top' | 'jacket' | 'bottom', label: string, options: readonly string[]) => (
    <div className="stack" key={field}>
      <h4>{label}</h4>
      <OptionGrid name={field} label={label} value={draft[field]} options={options.map((id) => ({ id, label: piecePt(id) }))} onPick={(id) => set(field, id)} />
      {draft[field] !== 'none' && pieceStyle(draft[field], piecePt(draft[field]))}
    </div>
  );

  const previewConfig: AraAvatarConfig = { ...shown, headsetAlways: headset } as AraAvatarConfig;
  const posed: PoseState = { mode: pose, activity: pose === 'sit' ? activity : 'idle', speaking: null };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const config: Omit<AraCustomConfig, 'model'> = { v: 1, style: 'ara3d', custom: check.params, headsetAlways: headset };
      const r = await api.put<{ version: number; config: AraAvatarConfig }>('/api/avatar/me', { config, baseVersion: me.version });
      const next: Me = { style: 'ara3d', config: r.config, version: r.version, saved: true };
      setMe(next);
      setShown(r.config);
      lastBuilt.current = norm(paramsOf(r.config));
      toast('Avatar salvo. Seus colegas já veem a nova aparência.');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'avatar_conflict') setErr('Seu avatar foi salvo em outra aba ou dispositivo. Clique em "Cancelar" para carregar a versão atual.');
      else setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const slidersOfCat = ARA_EDITOR_SLIDERS.filter((s) => s.category === cat);
  const groups = [...new Set(slidersOfCat.map((s) => s.group))];
  const touched = Object.keys(draft.modifiers).length;

  return (
    <div className="avatar-editor" data-style="ara3d">
      <section className="avatar-stage" aria-label="Pré-visualização do avatar">
        <Canvas shadows camera={{ position: [1.9, 1.35, 4.1], fov: 30 }} gl={{ antialias: true }}>
          <ambientLight intensity={0.45} />
          <hemisphereLight args={['#ffffff', '#cfd5dd', 0.8]} />
          <directionalLight position={[2.5, 4, 3]} intensity={2} castShadow shadow-mapSize={[1024, 1024]} />
          <Environment resolution={64}>
            <Lightformer form="rect" intensity={2} position={[0, 4, 2]} scale={[6, 4, 1]} />
          </Environment>
          {pose === 'sit' && <Station />}
          <Avatar seat={{ x: 0, z: 0, rotY: 0 }} config={previewConfig} pose={posed} label={user.name} fixedLod={0} />
          <ContactShadows position={[0, 0.001, 0]} opacity={0.35} scale={4} blur={2.4} far={2} />
          <OrbitControls target={[0, pose === 'sit' ? 0.8 : 0.88, pose === 'sit' ? 0.2 : 0]} autoRotate autoRotateSpeed={0.9} enablePan={false} minDistance={1.4} maxDistance={6} maxPolarAngle={Math.PI / 1.9} />
        </Canvas>
        <div className="stage-bar">
          <div className="toolgroup" role="group" aria-label="Pose">
            <button className="btn small" aria-pressed={pose === 'stand'} onClick={() => setPose('stand')}>Em pé</button>
            <button className="btn small" aria-pressed={pose === 'sit'} onClick={() => setPose('sit')}>Sentado na estação</button>
          </div>
          {pose === 'sit' && (
            <div className="toolgroup" role="group" aria-label="Atividade (só no preview)">
              <button className="btn small" aria-pressed={activity === 'idle'} onClick={() => setActivity('idle')}>Trabalhando</button>
              <button className="btn small" aria-pressed={activity === 'typing'} onClick={() => setActivity('typing')}>Digitando</button>
              <button className="btn small" aria-pressed={activity === 'call'} onClick={() => setActivity('call')}>Em atendimento</button>
            </div>
          )}
          <div className="spacer" />
          <span className={`preview-status${building ? ' busy' : ''}`} data-testid="preview-status" aria-live="polite">
            {building ? 'Atualizando a prévia…' : dirty ? 'Alterações só neste preview' : me.saved ? `Salvo (versão ${me.version})` : 'Aparência padrão (ainda não salva)'}
          </span>
        </div>
      </section>
      <aside className="side right" aria-label="Personalizar avatar">
        <div className="side-head">
          <h2>Meu avatar</h2>
          <p className="muted">Só você edita o seu avatar. Depois de salvar, ele aparece para os colegas na sua mesa.</p>
          <div className="row">
            <button className="btn primary" disabled={(!dirty && me.saved) || busy || check.errors.length > 0} onClick={() => void save()} data-testid="avatar-save"><Save size={14} /> {busy ? 'Gerando o seu avatar…' : 'Salvar'}</button>
            <button className="btn" disabled={busy} onClick={() => { setErr(null); void load(); }} data-testid="avatar-cancel"><RotateCcw size={14} /> Cancelar</button>
            <button className="btn" disabled={busy} data-testid="avatar-random" onClick={() => { const p = ARA_PRESETS[Math.floor(Math.random() * ARA_PRESETS.length)]; setDraft(full(p.params as Partial<AraParams>)); }}><Shuffle size={14} /> Sortear</button>
          </div>
          {busy && <div className="notice info" role="status">Gerando o modelo 3D no servidor. Leva alguns segundos.</div>}
          {err && <div className="notice bad" role="alert">{err}</div>}
          {check.errors.length > 0 && <div className="notice warn">{check.errors.join(' ')}</div>}
          <div className="tabs" role="tablist" aria-label="Modo de edição">
            <button role="tab" aria-selected={tab === 'montar'} aria-pressed={tab === 'montar'} data-tab="montar" onClick={() => setTab('montar')}>Montar</button>
            <button role="tab" aria-selected={tab === 'detalhado'} aria-pressed={tab === 'detalhado'} data-tab="detalhado" onClick={() => setTab('detalhado')}>Detalhado ({touched})</button>
          </div>
        </div>

        {tab === 'montar' && (
          <div className="side-body">
            <div className="stack">
              <h3>Começar de um personagem pronto</h3>
              <div className="gallery-grid" role="group" aria-label="Personagens prontos">
                {ARA_PRESETS.map((p) => (
                  <button key={p.id} className="gallery-card" data-character={p.id} title={`Usar "${p.name}" como ponto de partida`} onClick={() => setDraft(full(p.params as Partial<AraParams>))}>
                    <img src={`/assets/avatars-ara/thumbs/${p.id}.webp`} alt="" width={90} height={120} loading="lazy" />
                    <span>{p.name}</span>
                    <span className="muted">{p.style === 'casual' ? 'casual' : 'corporativo'}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="stack">
              <h3>Corpo</h3>
              <div className="tabs" role="radiogroup" aria-label="Aparência do corpo">
                <button role="radio" aria-checked={female} aria-pressed={female} data-gender="female" onClick={() => setGender(0)}>Feminino</button>
                <button role="radio" aria-checked={!female} aria-pressed={!female} data-gender="male" onClick={() => setGender(1)}>Masculino</button>
              </div>
              <Slider id="gender" label="Feminino ↔ masculino" value={draft.gender} onChange={setGender} resetTo={undefined} />
              <Slider id="age" label="Idade" min={18} max={90} step={1} value={Math.round(ageToYears(Math.max(draft.age, ARA_MIN_AGE)))} format={(v) => `${v} anos`} onChange={(y) => set('age', Math.max(ARA_MIN_AGE, yearsToAge(y)))} />
              <Slider id="height" label="Altura" value={draft.height} onChange={(v) => set('height', v)} resetTo={0.5} />
              <Slider id="weight" label="Peso" value={draft.weight} onChange={(v) => set('weight', v)} resetTo={0.5} />
              <Slider id="muscle" label="Massa muscular" value={draft.muscle} onChange={(v) => set('muscle', v)} resetTo={0.5} />
              <Slider id="proportions" label="Proporções" value={draft.proportions} onChange={(v) => set('proportions', v)} resetTo={0.7} />
              {draft.gender < 0.8 && (
                <>
                  <Slider id="breastSize" label="Tamanho do busto" value={draft.breastSize} onChange={(v) => set('breastSize', v)} resetTo={0.5} />
                  <Slider id="breastFirmness" label="Firmeza do busto" value={draft.breastFirmness} onChange={(v) => set('breastFirmness', v)} resetTo={0.5} />
                </>
              )}
            </div>

            <div className="stack">
              <h3>Origem e pele</h3>
              <Slider id="african" label="Ascendência africana" value={draft.african} onChange={(v) => set('african', v)} />
              <Slider id="asian" label="Ascendência asiática" value={draft.asian} onChange={(v) => set('asian', v)} />
              <Slider id="caucasian" label="Ascendência europeia" value={draft.caucasian} onChange={(v) => set('caucasian', v)} />
              <p className="muted">As três se combinam proporcionalmente.</p>
              <OptionGrid name="skin" label="Pele" value={draft.skin} onPick={(id) => set('skin', id)} options={[{ id: 'auto', label: 'Automática' }, ...ARA_SKINS.map((s) => ({ id: s.id, label: skinPt(s.id), thumb: s.thumb }))]} />
              <ColorField label="Ajuste do tom da pele" id="skinTint" value={draft.skinTint} onChange={(c) => set('skinTint', c)} swatches={[{ hex: '#ffffff', name: 'Sem ajuste' }, { hex: '#f3d9c4', name: 'Mais claro' }, { hex: '#d9a982', name: 'Mais quente' }, { hex: '#a8795a', name: 'Mais escuro' }]} />
            </div>

            <div className="stack">
              <h3>Olhos, sobrancelhas e cílios</h3>
              <OptionGrid name="eyes" label="Cor dos olhos" value={draft.eyes} onPick={(id) => set('eyes', id)} options={ARA_EYES.map((o) => ({ id: o.id, label: eyesPt(o.id), thumb: o.thumb }))} />
              <OptionGrid name="eyebrows" label="Sobrancelhas" value={draft.eyebrows} onPick={(id) => set('eyebrows', id)} options={ARA_EYEBROWS.map((o) => ({ id: o.id, label: browPt(o.id), thumb: o.thumb }))} />
              <OptionGrid name="eyelashes" label="Cílios" value={draft.eyelashes} onPick={(id) => set('eyelashes', id)} options={ARA_EYELASHES.map((o) => ({ id: o.id, label: lashPt(o.id), thumb: o.thumb }))} />
            </div>

            <div className="stack">
              <h3>Cabelo</h3>
              <OptionGrid name="hair" label="Estilo do cabelo" value={draft.hair} onPick={(id) => set('hair', id)} options={[...ARA_HAIR.map((o) => ({ id: o.id, label: hairPt(o.id), thumb: o.thumb })), ...ARA_PROCEDURAL_HAIR.map((id) => ({ id, label: hairPt(id) }))]} />
              <ColorField label="Cor do cabelo" id="hairColor" value={draft.hairTint === '#ffffff' ? draft.hairColor : draft.hairTint} swatches={NATURAL_HAIR} onChange={(c) => setDraft((d) => ({ ...d, hairTint: c, hairColor: c }))} />
              <h4>Barba e brincos</h4>
              <OptionGrid name="facialHair" label="Barba" value={draft.facialHair} onPick={(id) => set('facialHair', id as AraParams['facialHair'])} options={ARA_FACIAL_HAIR.map((id) => ({ id, label: facialHairPt(id) }))} />
              {draft.facialHair !== 'none' && <ColorField label="Cor da barba" id="beardColor" value={draft.beardColor} swatches={NATURAL_HAIR} onChange={(c) => set('beardColor', c)} />}
              <OptionGrid name="earrings" label="Brincos" value={draft.earrings} onPick={(id) => set('earrings', id as AraParams['earrings'])} options={ARA_EARRINGS.map((id) => ({ id, label: earringPt(id) }))} />
              {draft.earrings !== 'none' && draft.earrings !== 'pearl_drops' && (
                <div className="tabs" role="radiogroup" aria-label="Metal dos brincos">
                  {(['gold', 'silver'] as const).map((m) => <button key={m} role="radio" aria-checked={draft.earringMetal === m} aria-pressed={draft.earringMetal === m} onClick={() => set('earringMetal', m)}>{m === 'gold' ? 'Dourado' : 'Prateado'}</button>)}
                </div>
              )}
            </div>

            <div className="stack">
              <h3>Roupa</h3>
              <div className="tabs" role="radiogroup" aria-label="Como montar a roupa">
                <button role="radio" aria-checked={mode === 'set'} aria-pressed={mode === 'set'} data-outfit-mode="set" onClick={() => mode !== 'set' && setDraft((d) => ({ ...d, outfit: d.gender < 0.5 ? 'set_pantsuit' : 'set_suit_tie', top: 'none', jacket: 'none', bottom: 'none' }))}>Conjunto pronto</button>
                <button role="radio" aria-checked={mode === 'pieces'} aria-pressed={mode === 'pieces'} data-outfit-mode="pieces" onClick={() => mode !== 'pieces' && setDraft((d) => ({ ...d, outfit: 'none', jacket: 'none', top: d.gender < 0.5 ? 'silk_blouse' : 'camp_shirt', bottom: d.gender < 0.5 ? 'pencil_skirt_midi' : 'trousers' }))}>Peças soltas</button>
              </div>
              {mode === 'set' ? (
                <>
                  <OptionGrid name="outfit" label="Conjunto" value={draft.outfit} onPick={(id) => compatible(id) && setDraft((d) => ({ ...d, outfit: id, top: 'none', jacket: 'none', bottom: 'none' }))} options={outfitOptions.map((id) => ({ id, label: outfitPt(id) }))} />
                  {(SET_PIECES[draft.outfit] ?? []).map((piece) => pieceStyle(piece, piece.startsWith('set_') ? 'Paletó e calça' : piecePt(piece)))}
                  {!draft.outfit.startsWith('set_') && <ColorField label="Tom da roupa" id="outfitTint" value={draft.outfitTint} swatches={FABRIC_COLORS} onChange={(c) => set('outfitTint', c)} />}
                </>
              ) : (
                <>
                  {pieceSelect('top', 'Parte de cima', ARA_OFFICE.tops.filter((t) => t !== 'none'))}
                  {pieceSelect('jacket', 'Paletó ou casaco', ARA_OFFICE.jackets)}
                  {pieceSelect('bottom', 'Parte de baixo', ARA_OFFICE.bottoms.filter((t) => t !== 'none'))}
                </>
              )}
            </div>

            <div className="stack">
              <h3>Sapatos e acessórios</h3>
              <OptionGrid name="shoes" label="Calçado" value={draft.shoes} onPick={(id) => set('shoes', id)} options={ARA_OFFICE.shoes.map((id) => ({ id, label: piecePt(id) }))} />
              {ARA_OFFICE.patterns[draft.shoes] && pieceStyle(draft.shoes, piecePt(draft.shoes))}
              <div className="choice-grid" role="group" aria-label="Acessórios">
                {ARA_OFFICE.accessories.map((a) => (
                  <label key={a} className="check"><input type="checkbox" checked={draft.accessories.includes(a)} onChange={(e) => set('accessories', e.target.checked ? [...draft.accessories, a] : draft.accessories.filter((x) => x !== a))} /> {piecePt(a)}</label>
                ))}
              </div>
              <label className="check"><input type="checkbox" checked={headset} onChange={(e) => setHeadset(e.target.checked)} /> Usar o headset sempre (ele entra sozinho durante atendimentos)</label>
            </div>
          </div>
        )}

        {tab === 'detalhado' && (
          <div className="side-body ara-groups" data-tab-panel="detalhado">
            <div className="stack">
              <p className="muted">Controles finos do corpo e do rosto, como no Ara 3D Gen. Cada valor parte do zero (sem ajuste). {touched ? `${touched} ajuste${touched > 1 ? 's' : ''} ativo${touched > 1 ? 's' : ''}.` : ''}</p>
              <div className="row">
                <div className="tabs" role="tablist" aria-label="Categoria">
                  {CATEGORIES.map((c) => <button key={c} role="tab" aria-selected={cat === c} aria-pressed={cat === c} data-category={c} onClick={() => setCat(c)}>{CATEGORY_PT[c]}</button>)}
                </div>
                <button className="btn small" disabled={!touched} data-testid="reset-details" onClick={() => set('modifiers', {})}><RotateCcw size={12} /> Zerar todos</button>
              </div>
            </div>
            {groups.map((g) => {
              const list = slidersOfCat.filter((s) => s.group === g);
              const used = list.filter((s) => draft.modifiers[s.id]).length;
              return (
                <details key={g} data-group={g}>
                  <summary>{groupPt(g)} <span className="count">{used ? `${used} ajuste${used > 1 ? 's' : ''}` : `${list.length} controles`}</span></summary>
                  {list.map((s) => (
                    <Slider key={s.id} id={s.id} label={sliderLabelPt(s.label)} min={s.bipolar ? -1 : 0} max={1} step={0.01} value={draft.modifiers[s.id] ?? 0} onChange={(v) => setMod(s.id, v)} resetTo={0} />
                  ))}
                </details>
              );
            })}
          </div>
        )}
      </aside>
    </div>
  );
}
