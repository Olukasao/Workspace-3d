/**
 * "Meu avatar" no modo 2D: monta o personagem em camadas (pele, cabelo, roupa, calçado, óculos, headset).
 * A prévia usa o mesmo desenhista do escritório (composeSheet) num canvas comum. Cada colaborador edita só o próprio avatar;
 * a aparência 2D é guardada à parte da aparência 3D (estilo "sprite2d") e vai para os colegas ao vivo.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LPC_BEARD_IDS, LPC_HAIR_IDS, LPC_LEGS_IDS, LPC_SHOES_IDS, LPC_TORSO_IDS, defaultAvatar2D, isSprite2D, type Avatar2DConfig,
} from '../../../../shared/avatar2d';
import { LPC_CLOTH_COLORS, LPC_EYE_COLORS, LPC_HAIR_COLORS, LPC_PARTS, LPC_SKINS } from '../../../../shared/avatarLpc.generated';
import type { SessionUser } from '../../../../shared/types';
import { api, errorText, type ApiError } from '../../../api';
import { ANIMS, FH, FW, ROW, composeSheet } from './art/characters';
import { composeAnim, lpcLoaded, lpcRow, preloadCatalog, preloadLpc, swatch } from './art/lpc';

interface Mine { style: string; config: unknown; version: number; saved: boolean }

// quadros da prévia: [linha (direção), coluna]: parado de frente/lado/costas, sentado digitando, falando
const VIEWS: Array<{ label: string; row: number; col: number }> = [
  { label: 'Frente', row: ROW.down, col: ANIMS.idle.start },
  { label: 'Lado', row: ROW.left, col: ANIMS.idle.start },
  { label: 'Costas', row: ROW.up, col: ANIMS.idle.start },
  { label: 'Sentado', row: ROW.up, col: ANIMS.type.start },
  { label: 'Falando', row: ROW.down, col: ANIMS.talk.start },
];
const SCALE = 3;

function Preview({ cfg }: { cfg: Avatar2DConfig }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const body = JSON.stringify(cfg);
  useEffect(() => {
    let dead = false;
    void preloadLpc(cfg).then(() => {
      if (dead || !ref.current) return;
      const c = ref.current;
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, c.width, c.height);
      const sheet = composeSheet(cfg, cfg.headsetAlways);
      VIEWS.forEach((v, i) => g.drawImage(sheet, v.col * FW, v.row * FH, FW, FH, i * FW * SCALE, 0, FW * SCALE, FH * SCALE));
      sheet.width = 0; // libera a folha temporária
    });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);
  return <canvas ref={ref} width={FW * SCALE * VIEWS.length} height={FH * SCALE} className="av2d-preview" data-testid="avatar2d-preview" aria-label="Prévia do avatar" />;
}

/** Miniatura: o personagem de frente com a peça `patch` aplicada (as demais peças são as escolhidas agora). */
function Thumb({ cfg, patch, ready }: { cfg: Avatar2DConfig; patch: Partial<Avatar2DConfig>; ready: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const body = JSON.stringify({ ...cfg, ...patch, glasses: false, headsetAlways: false });
  useEffect(() => {
    const c = ref.current;
    if (!c || !ready) return;
    const t = JSON.parse(body) as Avatar2DConfig;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    if (!lpcLoaded(t, ['idle'])) return;
    const sheet = composeAnim(t, 'idle');
    if (sheet) g.drawImage(sheet, 0, lpcRow('down') * 64 + 10, 64, 46, 0, 0, 64, 46); // da cabeça aos joelhos
  }, [body, ready]);
  return <canvas ref={ref} width={64} height={46} className="av2d-thumb" aria-hidden="true" />;
}

type Field = 'hair' | 'shirt' | 'pants' | 'shoes' | 'facial';
function Choice({ label, ids, names, value, onPick, testid, cfg, field, ready }: { label: string; ids: readonly string[]; names: Record<string, string>; value: string; onPick: (id: string) => void; testid: string; cfg: Avatar2DConfig; field: Field; ready: boolean }) {
  return (
    <div className="av2d-group wide">
      <div className="muted">{label}</div>
      <div className="av2d-thumbs">
        {ids.map((id) => (
          <button key={id} className={`av2d-opt ${id === value ? 'on' : ''}`} title={names[id] ?? id} aria-label={names[id] ?? id} aria-pressed={id === value} onClick={() => onPick(id)} data-testid={`${testid}-${id}`}>
            {id === 'none' ? <span className="av2d-none">Nenhum</span> : <Thumb cfg={cfg} patch={{ [field]: id }} ready={ready} />}
          </button>
        ))}
      </div>
    </div>
  );
}
const PT: Record<string, string> = { none: 'Nenhum' };
function Colors({ label, colors, material, value, onPick, testid }: { label: string; colors: readonly string[]; material: 'body' | 'hair' | 'cloth' | 'eye'; value: string; onPick: (c: string) => void; testid: string }) {
  return (
    <div className="av2d-group">
      <div className="muted">{label}</div>
      <div className="editor2d-row">
        {colors.map((c) => (
          <button key={c} className="av2d-color" title={c.replace(/_/g, ' ')} style={{ background: swatch(material, c), outline: c === value ? '2px solid var(--blue)' : '1px solid rgba(0,0,0,.25)' }} onClick={() => onPick(c)} aria-label={`${label} ${c.replace(/_/g, ' ')}`} aria-pressed={c === value} data-testid={`${testid}-${c}`} />
        ))}
      </div>
    </div>
  );
}

export function AvatarEditor2D({ user, onReady }: { user: SessionUser; onReady: () => void }) {
  const [cfg, setCfg] = useState<Avatar2DConfig | null>(null);
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState<Avatar2DConfig | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // miniaturas: imagens de "parado" de todas as peças do corpo escolhido
  const bodyType = cfg?.bodyType ?? 'male';
  useEffect(() => {
    let dead = false;
    setReady(false);
    void preloadCatalog(bodyType).then(() => !dead && setReady(true));
    return () => {
      dead = true;
    };
  }, [bodyType]);
  const names = useMemo(() => Object.fromEntries(Object.values(LPC_PARTS).flat().map((p) => [p.id, p.name])), []);

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
      <div className="av2d-preview-wrap"><Preview cfg={cfg} /></div>
      <div className="av2d-labels muted">{VIEWS.map((v) => <span key={v.label}>{v.label}</span>)}</div>
      <div className="av2d-grid">
        <div className="av2d-group">
          <div className="muted">Corpo</div>
          <div className="editor2d-row">
            {([['male', 'Masculino'], ['female', 'Feminino']] as const).map(([id, name]) => (
              <button key={id} className={`btn small ${cfg.bodyType === id ? 'primary' : ''}`} aria-pressed={cfg.bodyType === id} onClick={() => set({ bodyType: id })} data-testid={`body-${id}`}>{name}</button>
            ))}
          </div>
        </div>
        <Colors label="Pele" colors={LPC_SKINS} material="body" value={cfg.skin} onPick={(c) => set({ skin: c })} testid="skin" />
        <Colors label="Cor dos olhos" colors={LPC_EYE_COLORS} material="eye" value={cfg.eyeColor ?? 'blue'} onPick={(c) => set({ eyeColor: c })} testid="eyecolor" />
        <Choice label="Cabelo" ids={LPC_HAIR_IDS} names={{ ...names, ...PT }} value={cfg.hair} onPick={(id) => set({ hair: id })} testid="hair" cfg={cfg} field="hair" ready={ready} />
        <Colors label="Cor do cabelo e da barba" colors={LPC_HAIR_COLORS} material="hair" value={cfg.hairColor} onPick={(c) => set({ hairColor: c })} testid="haircolor" />
        <Choice label="Barba e bigode" ids={LPC_BEARD_IDS} names={{ ...names, ...PT }} value={cfg.facial} onPick={(id) => set({ facial: id })} testid="facial" cfg={cfg} field="facial" ready={ready} />
        <Choice label="Parte de cima" ids={LPC_TORSO_IDS} names={names} value={cfg.shirt} onPick={(id) => set({ shirt: id })} testid="shirt" cfg={cfg} field="shirt" ready={ready} />
        <Colors label="Cor da parte de cima" colors={LPC_CLOTH_COLORS} material="cloth" value={cfg.shirtColor} onPick={(c) => set({ shirtColor: c })} testid="shirtcolor" />
        <Choice label="Parte de baixo" ids={LPC_LEGS_IDS} names={names} value={cfg.pants} onPick={(id) => set({ pants: id })} testid="pants" cfg={cfg} field="pants" ready={ready} />
        <Colors label="Cor da parte de baixo" colors={LPC_CLOTH_COLORS} material="cloth" value={cfg.pantsColor} onPick={(c) => set({ pantsColor: c })} testid="pantscolor" />
        <Choice label="Calçado" ids={LPC_SHOES_IDS} names={names} value={cfg.shoes} onPick={(id) => set({ shoes: id })} testid="shoes" cfg={cfg} field="shoes" ready={ready} />
        <Colors label="Cor do calçado" colors={LPC_CLOTH_COLORS} material="cloth" value={cfg.shoesColor} onPick={(c) => set({ shoesColor: c })} testid="shoescolor" />
        <div className="av2d-group">
          <div className="muted">Acessórios</div>
          <label><input type="checkbox" checked={cfg.glasses} onChange={(e) => set({ glasses: e.target.checked })} data-testid="glasses" /> Óculos</label>
          <label title="Em ligação o headset aparece sozinho; marque para mostrá-lo sempre"><input type="checkbox" checked={cfg.headsetAlways} onChange={(e) => set({ headsetAlways: e.target.checked })} data-testid="headset" /> Headset sempre visível</label>
        </div>
      </div>
    </div>
  );
}
