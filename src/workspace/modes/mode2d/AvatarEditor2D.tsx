/**
 * "Meu avatar" no modo 2D, no formato do gerador do Universal LPC: categorias (corpo, cabeça, cabelo, roupa, pernas e pés, chapéus,
 * acessórios), cada uma com as peças em miniatura e as cores, e uma prévia animada (andar, parado, sentado, digitando, falando) nas
 * quatro direções. A prévia usa o mesmo desenhista do escritório (composeSheet). Cada colaborador edita só o próprio avatar; a aparência
 * 2D é guardada à parte da aparência 3D (estilo "sprite2d") e vai para os colegas ao vivo.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { LPC_BEARD_IDS, LPC_HAIR_IDS, LPC_LEGS_IDS, LPC_SHOES_IDS, LPC_TORSO_IDS, defaultAvatar2D, isSprite2D, type Avatar2DConfig } from '../../../../shared/avatar2d';
import { LPC_CLOTH_COLORS, LPC_EXTRAS, LPC_EYE_COLORS, LPC_HAIR_COLORS, LPC_METAL_COLORS, LPC_PARTS, LPC_SKINS, type LpcExtra } from '../../../../shared/avatarLpc.generated';
import type { SessionUser } from '../../../../shared/types';
import { api, errorText, type ApiError } from '../../../api';
import { ANIMS, FH, FOOT_Y, FW, ROW, composeSheet, type AnimName } from './art/characters';
import { packChair } from './art/pack';
import { drawPartThumb, preloadLpc, preloadPart, swatch } from './art/lpc';

interface Mine { style: string; config: unknown; version: number; saved: boolean }
type Material = 'body' | 'hair' | 'cloth' | 'eye' | 'metal';

// ---------- prévia animada ----------
const ANIM_LIST: Array<{ id: AnimName; label: string; fps: number }> = [
  { id: 'walk', label: 'Andar', fps: 10 },
  { id: 'idle', label: 'Parado', fps: 1 },
  { id: 'sit', label: 'Sentado', fps: 1 },
  { id: 'type', label: 'Digitando', fps: 6 },
  { id: 'talk', label: 'Falando', fps: 4 },
  { id: 'sittalk', label: 'Falando sentado', fps: 4 },
];
const SEATED = new Set<AnimName>(['sit', 'type', 'sittalk']);
const DIR_LIST = [
  { id: 'down', label: 'Frente' },
  { id: 'up', label: 'Costas' },
  { id: 'left', label: 'Esquerda' },
  { id: 'right', label: 'Direita' },
] as const;
const SCALE = 4;

function Preview({ cfg }: { cfg: Avatar2DConfig }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sheet = useRef<HTMLCanvasElement | null>(null);
  const [anim, setAnim] = useState<AnimName>('idle');
  const [dir, setDir] = useState<(typeof DIR_LIST)[number]['id']>('down');
  const [rev, setRev] = useState(0);
  const body = JSON.stringify(cfg);
  useEffect(() => {
    let dead = false;
    void preloadLpc(cfg).then(() => {
      if (dead) return;
      if (sheet.current) sheet.current.width = 0; // libera a folha anterior
      sheet.current = composeSheet(cfg, cfg.headsetAlways);
      setRev((n) => n + 1);
    });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);
  useEffect(() => () => void (sheet.current && (sheet.current.width = 0)), []);
  useEffect(() => {
    const def = ANIMS[anim];
    const fps = ANIM_LIST.find((a) => a.id === anim)!.fps;
    let i = 0;
    const draw = () => {
      const c = ref.current;
      const s = sheet.current;
      if (!c || !s || !s.width) return;
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, c.width, c.height);
      if (SEATED.has(anim)) {
        // quem está sentado aparece numa cadeira de escritório, como no escritório
        const ch = packChair(dir);
        if (ch) g.drawImage(ch.img, 0, 0, ch.img.width, ch.img.height, (FW / 2 - 16 - ch.ax) * SCALE, (FOOT_Y - 34 - ch.ay) * SCALE, ch.img.width * SCALE, ch.img.height * SCALE);
      }
      const col = def.start + (def.frames > 1 ? i % def.frames : 0);
      g.drawImage(s, col * FW, ROW[dir] * FH, FW, FH, 0, 0, FW * SCALE, FH * SCALE);
      i++;
    };
    draw();
    const t = setInterval(draw, 1000 / fps);
    return () => clearInterval(t);
  }, [anim, dir, rev]);
  return (
    <div className="av2d-previewbox">
      <div className="av2d-preview-wrap">
        <canvas ref={ref} width={FW * SCALE} height={FH * SCALE} className="av2d-preview" data-testid="avatar2d-preview" aria-label="Prévia do avatar" />
      </div>
      <div className="av2d-seg" role="group" aria-label="Animação">
        {ANIM_LIST.map((a) => (
          <button key={a.id} className={`btn small ${anim === a.id ? 'primary' : ''}`} aria-pressed={anim === a.id} onClick={() => setAnim(a.id)} data-testid={`anim-${a.id}`}>{a.label}</button>
        ))}
      </div>
      <div className="av2d-seg" role="group" aria-label="Direção">
        {DIR_LIST.map((d) => (
          <button key={d.id} className={`btn small ${dir === d.id ? 'primary' : ''}`} aria-pressed={dir === d.id} onClick={() => setDir(d.id)} data-testid={`dir-${d.id}`}>{d.label}</button>
        ))}
      </div>
    </div>
  );
}

// ---------- miniaturas e cores ----------
function Thumb({ cfg, cat, id, color }: { cfg: Avatar2DConfig; cat: string; id: string; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = [cfg.bodyType, cfg.skin, cfg.hairColor, cfg.eyeColor, cfg.head, cat, id, color].join('|');
  useEffect(() => {
    let dead = false;
    void preloadPart(cfg, cat, id, color).then(() => {
      if (!dead && ref.current) drawPartThumb(ref.current, cfg, cat, id, color);
    });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <canvas ref={ref} width={64} height={64} className="av2d-thumb" aria-hidden="true" />;
}

interface Item { id: string; name: string; color?: string }
function Grid({ title, items, value, onPick, testid, cfg, cat, none }: { title: string; items: readonly Item[]; value: string; onPick: (id: string) => void; testid: string; cfg: Avatar2DConfig; cat: string; none?: boolean }) {
  return (
    <div className="av2d-group wide">
      <div className="av2d-title">{title}</div>
      <div className="av2d-thumbs">
        {none && (
          <button className={`av2d-opt ${value === 'none' ? 'on' : ''}`} title="Nenhum" aria-label={`${title}: nenhum`} aria-pressed={value === 'none'} onClick={() => onPick('none')} data-testid={`${testid}-none`}>
            <span className="av2d-none">Nenhum</span>
          </button>
        )}
        {items.map((it) => (
          <button key={it.id} className={`av2d-opt ${it.id === value ? 'on' : ''}`} title={it.name} aria-label={it.name} aria-pressed={it.id === value} onClick={() => onPick(it.id)} data-testid={`${testid}-${it.id}`}>
            <Thumb cfg={cfg} cat={cat} id={it.id} color={it.color} />
          </button>
        ))}
      </div>
    </div>
  );
}
function Colors({ label, colors, material, value, onPick, testid }: { label: string; colors: readonly string[]; material: Material; value: string; onPick: (c: string) => void; testid: string }) {
  return (
    <div className="av2d-group">
      <div className="av2d-title">{label}</div>
      <div className="av2d-colors">
        {colors.map((c) => (
          <button key={c} className="av2d-color" title={c.replace(/_/g, ' ')} style={{ background: swatch(material, c), outline: c === value ? '2px solid var(--blue)' : '1px solid rgba(0,0,0,.25)' }} onClick={() => onPick(c)} aria-label={`${label} ${c.replace(/_/g, ' ')}`} aria-pressed={c === value} data-testid={`${testid}-${c}`} />
        ))}
      </div>
    </div>
  );
}

const TABS = [
  { id: 'corpo', label: 'Corpo' },
  { id: 'cabeca', label: 'Cabeça e rosto' },
  { id: 'cabelo', label: 'Cabelo e barba' },
  { id: 'roupa', label: 'Roupa' },
  { id: 'pernas', label: 'Pernas e pés' },
  { id: 'chapeus', label: 'Chapéus' },
  { id: 'acessorios', label: 'Acessórios' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export function AvatarEditor2D({ user, onReady }: { user: SessionUser; onReady: () => void }) {
  const [cfg, setCfg] = useState<Avatar2DConfig | null>(null);
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState<Avatar2DConfig | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('corpo');
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of [...Object.values(LPC_EXTRAS), ...Object.values(LPC_PARTS)]) for (const p of c) m.set(p.id, p.name);
    return m;
  }, []);

  useEffect(() => {
    let dead = false;
    if (!user.employeeId) {
      setErr('Sua conta não está ligada a um colaborador do diretório, então não tem avatar no escritório.');
      onReady();
      return;
    }
    api.get<Mine>('/api/avatar/me').then(
      (r) => {
        if (dead) return;
        // aparências antigas (personagem pequeno) viram a aparência LPC padrão ao editar
        const c = isSprite2D(r.config) && r.config.look === 'lpc' ? r.config : defaultAvatar2D(user.employeeId!);
        setCfg(c);
        setSaved(c);
        setVersion(r.version);
        onReady();
      },
      (e) => {
        if (dead) return;
        setErr(errorText(e));
        onReady();
      },
    );
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.employeeId]);

  if (err) return <div className="page"><div className="notice bad">{err}</div></div>;
  if (!cfg) return <div className="loading">Carregando seu avatar…</div>;
  const set = (patch: Partial<Avatar2DConfig>) => { setCfg({ ...cfg, ...patch }); setMsg(null); };
  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);
  const nm = (id: string) => names.get(id) ?? id;

  // peças opcionais (chapéu, expressão...): 'none' remove; a cor anterior é mantida quando a nova peça a aceita
  const setExtra = (cat: string, id: string) => {
    const ex = { ...(cfg.extras ?? {}) };
    if (id === 'none') delete ex[cat];
    else {
      const part = LPC_EXTRAS[cat as keyof typeof LPC_EXTRAS].find((p) => p.id === id) as LpcExtra;
      const prev = ex[cat]?.color;
      const color = part.variants ? (prev && part.variants.includes(prev) ? prev : part.variants.includes('black') ? 'black' : part.variants[0]) : part.recolor === 'cloth' ? prev && (LPC_CLOTH_COLORS as readonly string[]).includes(prev) ? prev : 'white' : part.recolor === 'metal' ? prev && (LPC_METAL_COLORS as readonly string[]).includes(prev) ? prev : 'steel' : undefined;
      ex[cat] = color ? { id, color } : { id };
    }
    set({ extras: Object.keys(ex).length ? ex : undefined });
  };
  const setExtraColor = (cat: string, color: string) => {
    const cur = cfg.extras?.[cat];
    if (cur) set({ extras: { ...cfg.extras, [cat]: { ...cur, color } } });
  };
  const extra = (cat: string) => cfg.extras?.[cat];
  const extraItems = (cat: string): Item[] => (LPC_EXTRAS[cat as keyof typeof LPC_EXTRAS] as readonly LpcExtra[]).map((p) => ({ id: p.id, name: p.name, color: extra(cat)?.color && (p.variants ? p.variants.includes(extra(cat)!.color!) : true) ? extra(cat)!.color : undefined }));
  const extraGrid = (cat: string, title: string) => (
    <>
      <Grid title={title} items={extraItems(cat)} value={extra(cat)?.id ?? 'none'} onPick={(id) => setExtra(cat, id)} testid={cat} cfg={cfg} cat={cat} none />
      {(() => {
        const cur = extra(cat);
        const part = cur && (LPC_EXTRAS[cat as keyof typeof LPC_EXTRAS] as readonly LpcExtra[]).find((p) => p.id === cur.id);
        if (!cur || !part) return null;
        if (part.variants) return <Colors label={`Cor: ${title.toLowerCase()}`} colors={part.variants} material="cloth" value={cur.color ?? ''} onPick={(c) => setExtraColor(cat, c)} testid={`${cat}color`} />;
        if (part.recolor === 'cloth') return <Colors label={`Cor: ${title.toLowerCase()}`} colors={LPC_CLOTH_COLORS} material="cloth" value={cur.color ?? 'white'} onPick={(c) => setExtraColor(cat, c)} testid={`${cat}color`} />;
        if (part.recolor === 'metal') return <Colors label={`Cor: ${title.toLowerCase()}`} colors={LPC_METAL_COLORS} material="metal" value={cur.color ?? 'steel'} onPick={(c) => setExtraColor(cat, c)} testid={`${cat}color`} />;
        return null;
      })()}
    </>
  );
  const core = (ids: readonly string[], color?: string): Item[] => ids.filter((i) => i !== 'none').map((id) => ({ id, name: nm(id), color }));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.put<{ version: number; config: Avatar2DConfig }>('/api/avatar/me', { config: cfg, baseVersion: version });
      setVersion(r.version);
      setSaved(cfg);
      setMsg({ ok: true, text: 'Avatar salvo. Seus colegas já veem a nova aparência.' });
    } catch (e) {
      const status = (e as ApiError).status;
      if (status === 409) {
        // alteração em outra aba: pega a versão atual e mantém o que está na tela
        const r = await api.get<Mine>('/api/avatar/me').catch(() => null);
        if (r) setVersion(r.version);
        setMsg({ ok: false, text: 'Seu avatar foi alterado em outra janela. Clique em Salvar de novo para manter esta versão.' });
      } else setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page av2d" data-testid="avatar-editor-2d" data-engine="2d-avatar">
      <div className="av2d-top">
        <h2>Meu avatar (2D)</h2>
        <div className="editor2d-row">
          <button className="btn small" onClick={() => { setCfg(defaultAvatar2D(`${user.employeeId}-${Date.now()}`)); setMsg(null); }} data-testid="avatar2d-random">Sortear</button>
          <button className="btn small" disabled={!dirty || busy} onClick={() => { setCfg(saved); setMsg(null); }}>Descartar</button>
          <button className="btn small primary" disabled={!dirty || busy} onClick={() => void save()} data-testid="avatar2d-save">Salvar</button>
        </div>
      </div>
      {msg && <div className={`notice ${msg.ok ? 'ok' : 'bad'}`} role="status" data-testid="avatar2d-msg">{msg.text}</div>}
      <div className="av2d-layout">
        <Preview cfg={cfg} />
        <div className="av2d-editor">
          <div className="av2d-tabs" role="tablist" aria-label="Categorias">
            {TABS.map((t) => (
              <button key={t.id} role="tab" className={`av2d-tab ${tab === t.id ? 'on' : ''}`} aria-selected={tab === t.id} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>{t.label}</button>
            ))}
          </div>
          <div className="av2d-panel">
            {tab === 'corpo' && (
              <>
                <div className="av2d-group">
                  <div className="av2d-title">Tipo de corpo</div>
                  <div className="editor2d-row">
                    {([['male', 'Masculino'], ['female', 'Feminino']] as const).map(([id, name]) => (
                      <button key={id} className={`btn small ${cfg.bodyType === id ? 'primary' : ''}`} aria-pressed={cfg.bodyType === id} onClick={() => set({ bodyType: id, head: undefined })} data-testid={`body-${id}`}>{name}</button>
                    ))}
                  </div>
                </div>
                <Colors label="Pele" colors={LPC_SKINS} material="body" value={cfg.skin} onPick={(c) => set({ skin: c })} testid="skin" />
              </>
            )}
            {tab === 'cabeca' && (
              <>
                <Grid title="Cabeça" items={core(LPC_EXTRAS.head.map((p) => p.id))} value={cfg.head ?? (cfg.bodyType === 'female' ? 'heads_human_female' : 'heads_human_male')} onPick={(id) => set({ head: id })} testid="head" cfg={cfg} cat="head" />
                <Colors label="Cor dos olhos" colors={LPC_EYE_COLORS} material="eye" value={cfg.eyeColor ?? 'blue'} onPick={(c) => set({ eyeColor: c })} testid="eyecolor" />
                {extraGrid('expression', 'Expressão')}
                {extraGrid('eyebrows', 'Sobrancelhas')}
                {extraGrid('nose', 'Nariz')}
              </>
            )}
            {tab === 'cabelo' && (
              <>
                <Grid title="Cabelo" items={core(LPC_HAIR_IDS, cfg.hairColor)} value={cfg.hair} onPick={(id) => set({ hair: id })} testid="hair" cfg={{ ...cfg }} cat="hair" none />
                <Colors label="Cor do cabelo, da barba e das sobrancelhas" colors={LPC_HAIR_COLORS} material="hair" value={cfg.hairColor} onPick={(c) => set({ hairColor: c })} testid="haircolor" />
                <Grid title="Barba e bigode" items={core(LPC_BEARD_IDS, cfg.hairColor)} value={cfg.facial} onPick={(id) => set({ facial: id })} testid="facial" cfg={cfg} cat="beard" none />
              </>
            )}
            {tab === 'roupa' && (
              <>
                <Grid title="Parte de cima" items={core(LPC_TORSO_IDS, cfg.shirtColor)} value={cfg.shirt} onPick={(id) => set({ shirt: id })} testid="shirt" cfg={cfg} cat="torso" />
                <Colors label="Cor da parte de cima" colors={LPC_CLOTH_COLORS} material="cloth" value={cfg.shirtColor} onPick={(c) => set({ shirtColor: c })} testid="shirtcolor" />
                {extraGrid('overalls', 'Macacão e suspensório')}
                {extraGrid('neck', 'Pescoço')}
                {extraGrid('wrists', 'Luvas e pulseiras')}
              </>
            )}
            {tab === 'pernas' && (
              <>
                <Grid title="Parte de baixo" items={core(LPC_LEGS_IDS, cfg.pantsColor)} value={cfg.pants} onPick={(id) => set({ pants: id })} testid="pants" cfg={cfg} cat="legs" />
                <Colors label="Cor da parte de baixo" colors={LPC_CLOTH_COLORS} material="cloth" value={cfg.pantsColor} onPick={(c) => set({ pantsColor: c })} testid="pantscolor" />
                <Grid title="Calçado" items={core(LPC_SHOES_IDS, cfg.shoesColor)} value={cfg.shoes} onPick={(id) => set({ shoes: id })} testid="shoes" cfg={cfg} cat="shoes" />
                <Colors label="Cor do calçado" colors={LPC_CLOTH_COLORS} material="cloth" value={cfg.shoesColor} onPick={(c) => set({ shoesColor: c })} testid="shoescolor" />
                {extraGrid('socks', 'Meias')}
              </>
            )}
            {tab === 'chapeus' && extraGrid('hat', 'Chapéu, touca e lenço')}
            {tab === 'acessorios' && (
              <div className="av2d-group">
                <div className="av2d-title">Acessórios</div>
                <label><input type="checkbox" checked={cfg.glasses} onChange={(e) => set({ glasses: e.target.checked })} data-testid="glasses" /> Óculos</label>
                <label title="Em ligação o headset aparece sozinho; marque para mostrá-lo sempre"><input type="checkbox" checked={cfg.headsetAlways} onChange={(e) => set({ headsetAlways: e.target.checked })} data-testid="headset" /> Headset sempre visível</label>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
