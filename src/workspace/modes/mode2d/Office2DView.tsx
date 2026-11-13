/**
 * Escritório 2D (tela de operação): o canvas do Phaser no centro e painéis do React ao redor.
 * O que muda a cada passo de uma pessoa fica dentro do Phaser; o React só re-renderiza quando algo "de interface" muda
 * (lista de pessoas, cartão, dica). Não há dados fictícios: posições e estados vêm do servidor.
 */
import type Phaser from 'phaser';
import { Minus, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionUser } from '../../../../shared/types';
import { STATUS_COLOR, STATUS_LABEL } from '../../../avatar/PresenceDemo';
import { api, errorText } from '../../../api';
import { useLive, type LiveStatus } from '../../../live';
import { ChatDialog } from '../../../ops/dialogs';
import { Net2D } from './net2d';
import { OfficeScene, type SceneBridge } from './OfficeScene';
import { PhaserHost, createGame } from './PhaserHost';
import { useAway } from './useAway';

interface DirEntry { id: string; name: string; department: string; extension: string }

const isTyping = () => {
  const el = document.activeElement as HTMLElement | null;
  return (!!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) || !!document.querySelector('[role="dialog"]');
};

export function Office2DView({ officeId, user, onReady }: { officeId: string; user: SessionUser; onReady: () => void }) {
  const [net, setNet] = useState<Net2D | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [card, setCard] = useState<{ employeeId: string; sx: number; sy: number } | null>(null);
  const [chat, setChat] = useState<{ id: string; name: string } | null>(null);
  const [directory, setDirectory] = useState<Record<string, DirEntry>>({});
  const [, setTick] = useState(0);
  const game = useRef<Phaser.Game | null>(null);
  const people = useLive((s) => s.people);
  const { away, manual, toggle } = useAway();

  useEffect(() => {
    let dead = false;
    const n = new Net2D(officeId, user.employeeId ?? null);
    n.start().then(
      () => !dead && setNet(n),
      (e) => !dead && setErr(errorText(e)),
    );
    api.get<{ employees: DirEntry[] }>('/api/directory').then((r) => !dead && setDirectory(Object.fromEntries(r.employees.map((e) => [e.id, e]))), () => undefined);
    return () => {
      dead = true;
      n.stop(); // cancela as inscrições de tempo real do 2D
      setNet(null);
    };
  }, [officeId, user.employeeId]);

  // a lista de quem está no escritório muda com as posições: atualiza 1 vez por segundo (não a cada passo)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (net) onReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net]);

  const bridge = useMemo<SceneBridge | null>(() => (net ? { net, employeeId: user.employeeId ?? null, onSelect: setCard, onHint: setHint, isTyping } : null), [net, user.employeeId]);
  const scene = () => game.current?.scene.getScene('office') as OfficeScene | undefined;

  if (err) return <div className="page"><div className="notice bad">{err}</div></div>;
  if (!net || !bridge) return <div className="loading">Entrando no escritório…</div>;

  const here = [...net.positions.keys()]
    .map((id) => ({ id, p: people[id] }))
    .filter((x) => x.p && x.p.status !== 'offline')
    .sort((a, b) => (a.p!.name ?? '').localeCompare(b.p!.name ?? ''));
  const selected = card && people[card.employeeId];
  const dir = card ? directory[card.employeeId] : undefined;
  const myStatus: LiveStatus = (user.employeeId && people[user.employeeId]?.status) || 'online';

  return (
    <div className="office2d" data-testid="office2d">
      <div className="office2d-stage">
        <PhaserHost
          className="office2d-canvas"
          make={(parent) => createGame(parent, new OfficeScene(bridge))}
          onGame={(g) => {
            game.current = g;
          }}
        />
        <div className="office2d-zoom" role="group" aria-label="Zoom">
          <button className="btn icon" onClick={() => scene()?.zoomBy(1.25)} aria-label="Aproximar" title="Aproximar"><Plus size={16} /></button>
          <button className="btn icon" onClick={() => scene()?.zoomBy(0.8)} aria-label="Afastar" title="Afastar"><Minus size={16} /></button>
        </div>
        {hint && <div className="office2d-hint" role="status" data-testid="office2d-hint">{hint}</div>}
        {net.spectator && <div className="office2d-hint" role="status" data-testid="office2d-spectator">{net.spectatorReason}</div>}
        {card && selected && (
          <div className="office2d-card" style={{ left: Math.min(card.sx + 12, window.innerWidth - 270), top: Math.max(card.sy - 10, 8) }} role="dialog" aria-label={`Cartão de ${selected.name}`} data-testid="person-card">
            <button className="btn icon ghost small" style={{ float: 'right' }} onClick={() => setCard(null)} aria-label="Fechar"><X size={14} /></button>
            <b>{selected.name}</b>
            <div className="muted">{dir ? `${dir.department} · ramal ${dir.extension}` : ' '}</div>
            <div><span className="chip neutral live"><span className="presence-dot" style={{ background: STATUS_COLOR[selected.status] }} /> {STATUS_LABEL[selected.status]}</span></div>
            {user.employeeId && card.employeeId !== user.employeeId && user.role !== 'viewer' && (
              <button className="btn primary small" onClick={() => { setChat({ id: card.employeeId, name: selected.name }); setCard(null); }} data-testid="person-chat">Conversar</button>
            )}
          </div>
        )}
      </div>
      <aside className="office2d-side" aria-label="Painel do escritório">
        <section>
          <h3>Você</h3>
          {user.employeeId ? (
            <>
              <div><span className="chip neutral live" data-testid="my-status"><span className="presence-dot" style={{ background: STATUS_COLOR[myStatus] }} /> {STATUS_LABEL[myStatus]}</span></div>
              <button className="btn small" aria-pressed={manual} onClick={toggle} data-testid="away-toggle" title="Mostra você como ausente para os colegas">{away && !manual ? 'Ausente (automático): voltar' : manual ? 'Voltar do ausente' : 'Marcar como ausente'}</button>
            </>
          ) : (
            <p className="muted">Observador.</p>
          )}
        </section>
        <section>
          <h3>No escritório ({here.length})</h3>
          <ul className="office2d-people" data-testid="people-list">
            {here.map(({ id, p }) => (
              <li key={id}>
                <button className="btn ghost small" onClick={() => scene()?.focusOn(id)} title="Ir até a pessoa na tela">
                  <span className="presence-dot" style={{ background: STATUS_COLOR[p!.status] }} /> {p!.name}
                </button>
                <span className="muted">{STATUS_LABEL[p!.status]}</span>
              </li>
            ))}
            {here.length === 0 && <li className="muted">Ninguém por aqui ainda.</li>}
          </ul>
        </section>
        <section>
          <h3>Como usar</h3>
          <ul className="office2d-help">
            <li><b>WASD</b> ou <b>setas</b> para andar; ou clique/toque no chão.</li>
            <li><b>E</b> (ou clique na mesa) para sentar e levantar.</li>
            <li>Clique numa pessoa para ver o cartão e conversar.</li>
            <li>Roda do mouse ou +/− para o zoom.</li>
          </ul>
        </section>
      </aside>
      {chat && officeId && <ChatDialog direct officeId={officeId} object={{ objectId: '', seat: { employee: { id: chat.id, name: chat.name } } } as never} onClose={() => setChat(null)} />}
    </div>
  );
}
