/**
 * "Meu avatar" no modo 2D: monta o personagem em camadas (pele, cabelo, roupa, calçado, óculos, headset).
 * A prévia usa o mesmo desenhista do escritório (composeSheet) num canvas comum. Cada colaborador edita só o próprio avatar;
 * a aparência 2D é guardada à parte da aparência 3D (estilo "sprite2d") e vai para os colegas ao vivo.
 */
import { useEffect, useRef, useState } from 'react';
import { FACIAL2D, HAIR2D, PALETTE2D, PANTS2D, SHIRT2D, SHOES2D, SKIN2D, defaultAvatar2D, isSprite2D, type Avatar2DConfig, type Opt2D } from '../../../../shared/avatar2d';
import type { SessionUser } from '../../../../shared/types';
import { api, errorText, type ApiError } from '../../../api';
import { FH, FW, composeSheet } from './art/characters';

interface Mine { style: string; config: unknown; version: number; saved: boolean }

// quadros da prévia: [linha (direção), coluna]: parado de frente/lado/costas, sentado digitando, falando
const VIEWS: Array<{ label: string; row: number; col: number }> = [
  { label: 'Frente', row: 0, col: 4 },
  { label: 'Lado', row: 1, col: 4 },
  { label: 'Costas', row: 3, col: 4 },
  { label: 'Sentado', row: 3, col: 6 },
  { label: 'Falando', row: 0, col: 8 },
];

function Preview({ cfg }: { cfg: Avatar2DConfig }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    const sheet = composeSheet(cfg, cfg.headsetAlways);
    VIEWS.forEach((v, i) => g.drawImage(sheet, v.col * FW, v.row * FH, FW, FH, i * FW * 4, 0, FW * 4, FH * 4));
    // libera a folha temporária
    sheet.width = 0;
  }, [cfg]);
  return <canvas ref={ref} width={FW * 4 * VIEWS.length} height={FH * 4} className="av2d-preview" data-testid="avatar2d-preview" aria-label="Prévia do avatar" />;
}

function Choice({ label, list, value, onPick, testid }: { label: string; list: readonly Opt2D[]; value: string; onPick: (id: string) => void; testid: string }) {
  return (
    <div className="av2d-group">
      <div className="muted">{label}</div>
      <div className="editor2d-row">
        {list.map((o) => (
          <button key={o.id} className={`btn small ${o.id === value ? 'primary' : ''}`} aria-pressed={o.id === value} onClick={() => onPick(o.id)} data-testid={`${testid}-${o.id}`}>{o.name}</button>
        ))}
      </div>
    </div>
  );
}
function Colors({ label, colors, value, onPick, testid }: { label: string; colors: readonly string[]; value: string; onPick: (c: string) => void; testid: string }) {
  return (
    <div className="av2d-group">
      <div className="muted">{label}</div>
      <div className="editor2d-row">
        {colors.map((c) => (
          <button key={c} className="av2d-color" style={{ background: c, outline: c === value ? '2px solid var(--blue)' : '1px solid rgba(0,0,0,.25)' }} onClick={() => onPick(c)} aria-label={`${label} ${c}`} aria-pressed={c === value} data-testid={`${testid}-${c.slice(1)}`} />
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
        const c = isSprite2D(r.config) ? r.config : defaultAvatar2D(user.employeeId!);
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
          <div className="muted">Pele</div>
          <div className="editor2d-row">
            {SKIN2D.map((s) => (
              <button key={s.id} className="av2d-color" title={s.name} style={{ background: s.hex, outline: s.id === cfg.skin ? '2px solid var(--blue)' : '1px solid rgba(0,0,0,.25)' }} onClick={() => set({ skin: s.id })} aria-label={`Pele ${s.name}`} aria-pressed={s.id === cfg.skin} data-testid={`skin-${s.id}`} />
            ))}
          </div>
        </div>
        <Choice label="Cabelo" list={HAIR2D} value={cfg.hair} onPick={(id) => set({ hair: id })} testid="hair" />
        <Colors label="Cor do cabelo" colors={PALETTE2D.hair} value={cfg.hairColor} onPick={(c) => set({ hairColor: c })} testid="haircolor" />
        <Choice label="Barba" list={FACIAL2D} value={cfg.facial} onPick={(id) => set({ facial: id })} testid="facial" />
        <Choice label="Parte de cima" list={SHIRT2D} value={cfg.shirt} onPick={(id) => set({ shirt: id })} testid="shirt" />
        <Colors label="Cor da roupa" colors={PALETTE2D.shirt} value={cfg.shirtColor} onPick={(c) => set({ shirtColor: c })} testid="shirtcolor" />
        <Choice label="Parte de baixo" list={PANTS2D} value={cfg.pants} onPick={(id) => set({ pants: id })} testid="pants" />
        <Colors label="Cor da calça" colors={PALETTE2D.pants} value={cfg.pantsColor} onPick={(c) => set({ pantsColor: c })} testid="pantscolor" />
        <Choice label="Calçado" list={SHOES2D} value={cfg.shoes} onPick={(id) => set({ shoes: id })} testid="shoes" />
        <Colors label="Cor do calçado" colors={PALETTE2D.shoes} value={cfg.shoesColor} onPick={(c) => set({ shoesColor: c })} testid="shoescolor" />
        <div className="av2d-group">
          <div className="muted">Acessórios</div>
          <label><input type="checkbox" checked={cfg.glasses} onChange={(e) => set({ glasses: e.target.checked })} data-testid="glasses" /> Óculos</label>
          <label title="Em ligação o headset aparece sozinho; marque para mostrá-lo sempre"><input type="checkbox" checked={cfg.headsetAlways} onChange={(e) => set({ headsetAlways: e.target.checked })} data-testid="headset" /> Headset sempre visível</label>
        </div>
      </div>
    </div>
  );
}
