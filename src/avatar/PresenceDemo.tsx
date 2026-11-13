/**
 * Minha presença (topo da tela). Mostra o estado consolidado pelo servidor e, no modo demonstração,
 * controles IDENTIFICADOS para simular o ciclo de atendimento e o indicador de fala — sempre do próprio usuário.
 * A digitação vem do chat interno real do aplicativo (sinal booleano), não destes controles.
 */
import { Headset } from 'lucide-react';
import { useState } from 'react';
import type { SessionUser } from '../../shared/types';
import { errorText } from '../api';
import { demoCall, useLive, type LiveStatus } from '../live';
import { toast } from '../ui';

export const STATUS_LABEL: Record<LiveStatus, string> = { offline: 'Offline', online: 'Online', typing: 'Digitando no chat', in_call: 'Em atendimento', away: 'Ausente' };
export const STATUS_COLOR: Record<LiveStatus, string> = { offline: '#9aa0a6', online: '#1f9d55', typing: '#2f6fed', in_call: '#c05621', away: '#d69e2e' };

export function PresenceDemo({ user, demoMode }: { user: SessionUser; demoMode: boolean }) {
  const me = useLive((s) => (user.employeeId ? s.people[user.employeeId] : undefined));
  const connected = useLive((s) => s.connected);
  const [open, setOpen] = useState(false);
  const [withSpeaking, setWithSpeaking] = useState(true);
  if (!user.employeeId) return null;
  const status: LiveStatus = me?.status ?? (connected ? 'online' : 'offline');
  const run = (p: Promise<unknown>) => p.catch((e) => toast(errorText(e)));
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn small" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="presence-button" title="Minha presença">
        <span className="presence-dot" style={{ background: STATUS_COLOR[status] }} /> {STATUS_LABEL[status]}
      </button>
      {open && (
        <div className="card stack" style={{ position: 'absolute', right: 0, top: 36, width: 300, zIndex: 40 }} role="dialog" aria-label="Minha presença">
          <p className="muted">Estado consolidado pelo servidor: offline &gt; em atendimento &gt; digitando &gt; online. Várias abas contam como uma presença.</p>
          {demoMode ? (
            <>
              <div className="notice demo">Demonstração: telefonia/atendimento ainda não integrados. Estes controles usam o mesmo caminho de atualização que a cena consome.</div>
              {me?.call?.active ? (
                <>
                  <button className="btn" onClick={() => void run(demoCall.end())} data-testid="call-end"><Headset size={14} /> Encerrar atendimento (demo)</button>
                  {me.call.speaking !== null && (
                    <button className={`btn${me.call.speaking ? ' primary' : ''}`} onClick={() => void run(demoCall.speaking(!me.call?.speaking))} data-testid="call-speaking">
                      {me.call.speaking ? 'Falando… (clique para parar)' : 'Marcar que estou falando'}
                    </button>
                  )}
                  {me.call.speaking === null && <p className="muted">Sem indicador de fala: a cena mostra uma animação ilustrativa enquanto durar a chamada.</p>}
                </>
              ) : (
                <>
                  <label className="check"><input type="checkbox" checked={withSpeaking} onChange={(e) => setWithSpeaking(e.target.checked)} /> Simular indicador autorizado de fala</label>
                  <button className="btn" onClick={() => void run(demoCall.start(withSpeaking))} data-testid="call-start"><Headset size={14} /> Iniciar atendimento (demo)</button>
                </>
              )}
            </>
          ) : (
            <p className="muted">Atendimento e fala vêm do sistema de telefonia configurado.</p>
          )}
        </div>
      )}
    </div>
  );
}
