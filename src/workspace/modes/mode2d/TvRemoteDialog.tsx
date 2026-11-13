/**
 * Clique na TV do escritório 2D: área de dispositivos, no estilo do catálogo do AnyDesk/RustDesk. A pessoa escolhe o dispositivo
 * (o da TV vem marcado) e conecta para gerenciar o que aparece na tela. Nada conecta sozinho: o pedido fica registrado na trilha,
 * e a conexão, a aprovação de quem estiver do outro lado e a senha acontecem dentro do cliente oficial.
 */
import { Monitor, Search, Tv } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, errorText } from '../../../api';
import { DemoBadge, Dialog } from '../../../ui';

interface Device {
  id: string;
  name: string;
  kind: string;
  location: string | null;
  provider: string | null;
  canConnect: boolean;
  reason?: string;
  bound: boolean;
}
interface Result {
  requestId: string;
  mode: 'demo' | 'real';
  status: string;
  provider: string | null;
  device: { name: string };
  note: string;
  address?: string;
  command?: string;
  launchUrl?: string;
  correlationId: string;
}
const PRODUCT: Record<string, string> = { anydesk: 'AnyDesk', rustdesk: 'RustDesk' };
const KIND: Record<string, string> = { tv_player: 'Player de TV', pc: 'Computador', tv: 'TV' };

export function TvRemoteDialog({ officeId, objectId, onClose }: { officeId: string; objectId: string; onClose: () => void }) {
  const [list, setList] = useState<{ mode: 'demo' | 'real'; devices: Device[] } | null>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const base = `/api/office2d/${officeId}/objects/${objectId}/remote`;

  useEffect(() => {
    let dead = false;
    api.get<{ mode: 'demo' | 'real'; devices: Device[] }>(`${base}/devices`).then(
      (r) => {
        if (dead) return;
        setList(r);
        setSel((r.devices.find((d) => d.bound && d.canConnect) ?? r.devices.find((d) => d.canConnect))?.id ?? null);
      },
      (e) => !dead && setErr(errorText(e)),
    );
    return () => {
      dead = true;
    };
  }, [base]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list?.devices ?? []).filter((d) => !t || `${d.name} ${d.location ?? ''} ${KIND[d.kind] ?? d.kind} ${PRODUCT[d.provider ?? ''] ?? ''}`.toLowerCase().includes(t));
  }, [list, q]);
  const chosen = list?.devices.find((d) => d.id === sel) ?? null;
  const product = PRODUCT[(res?.provider ?? chosen?.provider) ?? ''] ?? 'acesso remoto';

  const connect = async () => {
    if (!chosen) return;
    setBusy(true);
    setErr(null);
    try {
      setRes(await api.post<Result>(`${base}/request`, { deviceId: chosen.id, confirm: true }));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Gerenciar a TV: escolha o dispositivo"
      wide
      onClose={onClose}
      badge={list || res ? <DemoBadge mode={res?.mode ?? list?.mode ?? 'demo'} /> : undefined}
      footer={
        res ? (
          <button className="btn primary" onClick={onClose} data-testid="tv-close">Fechar</button>
        ) : (
          <>
            <button className="btn" onClick={onClose} data-testid="tv-close">Cancelar</button>
            <button className="btn primary" disabled={busy || !chosen} onClick={() => void connect()} data-testid="tv-connect">{busy ? 'Registrando…' : chosen ? `Conectar a ${chosen.name} pelo ${product}` : 'Escolha um dispositivo'}</button>
          </>
        )
      }
    >
      {!res && (
        <>
          <label className="tv-search">
            <Search size={14} aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, local, tipo ou produto" aria-label="Buscar dispositivo" data-testid="tv-search" />
          </label>
          {!list && !err && <div className="muted">Carregando…</div>}
          {list && !list.devices.length && <div className="notice info" data-testid="tv-empty">Nenhum dispositivo com acesso remoto (AnyDesk ou RustDesk) está cadastrado no inventário.</div>}
          {list && list.devices.length > 0 && !shown.length && <div className="muted">Nenhum dispositivo encontrado para essa busca.</div>}
          <ul className="tv-devices" role="listbox" aria-label="Dispositivos">
            {shown.map((d) => (
              <li key={d.id}>
                <button
                  role="option"
                  aria-selected={d.id === sel}
                  disabled={!d.canConnect}
                  className={`tv-device ${d.id === sel ? 'on' : ''}`}
                  title={d.reason}
                  onClick={() => setSel(d.id)}
                  onDoubleClick={() => d.canConnect && (setSel(d.id), void connect())}
                  data-testid={`tv-device-${d.id}`}
                >
                  {d.kind === 'tv_player' || d.kind === 'tv' ? <Tv size={20} aria-hidden="true" /> : <Monitor size={20} aria-hidden="true" />}
                  <span className="tv-device-main">
                    <b>{d.name}</b>
                    <span className="muted">{[KIND[d.kind] ?? d.kind, d.location].filter(Boolean).join(' · ')}</span>
                    {!d.canConnect && <span className="muted tv-reason">{d.reason}</span>}
                  </span>
                  {d.bound && <span className="tv-tag">Desta TV</span>}
                  <span className="tv-tag product">{PRODUCT[d.provider ?? ''] ?? '—'}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="muted">O pedido fica registrado na trilha de auditoria. A conexão, a aprovação de quem estiver do outro lado e a senha ficam dentro do {product}: este sistema não guarda senhas nem conecta sozinho.</p>
        </>
      )}
      {err && <div className="notice bad" role="alert">{err}</div>}
      {res && (
        <div className="stack" data-testid="tv-result">
          <dl className="kv"><dt>Dispositivo</dt><dd data-testid="tv-device">{res.device.name}</dd><dt>Acesso por</dt><dd>{product}</dd></dl>
          <div className={`notice ${res.mode === 'demo' ? 'demo' : 'ok'}`} role="status">{res.note}</div>
          {res.address && (
            <dl className="kv">
              <dt>ID {product}</dt><dd className="mono">{res.address}</dd>
              <dt>Comando oficial</dt><dd className="mono">{res.command}</dd>
            </dl>
          )}
          {res.launchUrl && <a className="btn primary" href={res.launchUrl}>Abrir o {product}</a>}
          <p className="muted">Registro {res.requestId} · ref. {res.correlationId.slice(0, 8)}</p>
        </div>
      )}
    </Dialog>
  );
}
