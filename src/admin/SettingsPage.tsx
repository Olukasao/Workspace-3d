/**
 * Admin → Configurações → Ambiente virtual.
 * O modo (3D ou 2D) vale para a empresa toda e só o administrador troca. A troca pede confirmação, é gravada no servidor
 * e chega em tempo real a todos os usuários conectados (cada navegador desmonta um motor gráfico e monta o outro).
 */
import { useState } from 'react';
import { WORKSPACE_MODES, WORKSPACE_MODE_LABEL, type WorkspaceMode } from '../../shared/workspace';
import { api, errorText } from '../api';
import { useLive } from '../live';
import { Dialog, toast } from '../ui';
import { DeskAssignments } from './DeskAssignments';
import { AvatarStyleCard } from './pages';

const DESCRIPTION: Record<WorkspaceMode, string> = {
  '3d': 'Escritório tridimensional: câmera livre, móveis e personagens em 3D. É o ambiente original do produto.',
  '2d': 'Escritório em pixel art, visto de cima em 3/4: andar com o teclado ou clicando, sentar nas estações, ver quem está perto. Leve, funciona bem em celular e em computador simples.',
};

export function SettingsPage({ officeId = null }: { officeId?: string | null }) {
  const mode = useLive((s) => s.workspace.mode);
  const [pending, setPending] = useState<WorkspaceMode | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await api.put('/api/admin/workspace-mode', { mode: pending, confirm: true });
      toast(`Ambiente ${pending === '2d' ? '2D' : '3D'} ativado para todos os usuários.`);
      setPending(null);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <div className="page-inner">
        <div>
          <h2>Configurações</h2>
          <p className="muted">Ajustes que valem para a empresa toda.</p>
        </div>
        <section className="card" data-testid="workspace-mode-card" aria-labelledby="ambiente-h">
          <h3 id="ambiente-h">Ambiente virtual</h3>
          <p className="muted">Escolha o ambiente que todos os usuários vão usar. Só um fica ativo: o outro é desmontado em cada navegador e não consome processamento nem memória. Ninguém escolhe por conta própria.</p>
          <div className="mode-choices" role="radiogroup" aria-label="Ambiente virtual">
            {WORKSPACE_MODES.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} aria-pressed={mode === m} className="mode-choice" data-workspace-mode={m} onClick={() => mode !== m && setPending(m)}>
                <b>{WORKSPACE_MODE_LABEL[m]}</b>
                <span>{DESCRIPTION[m]}</span>
                {mode === m && <span className="chip ok">Ativo agora</span>}
              </button>
            ))}
          </div>
        </section>
        <DeskAssignments officeId={officeId} />
        <AvatarStyleCard />
      </div>
      {pending && (
        <Dialog
          title={`Ativar o ambiente ${pending === '2d' ? '2D' : '3D'}?`}
          onClose={() => !busy && setPending(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPending(null)} disabled={busy}>Cancelar</button>
              <button className="btn primary" onClick={() => void apply()} disabled={busy} data-testid="confirm-mode-switch">{busy ? 'Trocando…' : `Ativar ${pending === '2d' ? '2D' : '3D'} para todos`}</button>
            </>
          }
        >
          <p>Todos os usuários conectados vão migrar agora para o ambiente {pending === '2d' ? '2D' : '3D'}, sem precisar atualizar a página.</p>
          <ul>
            <li>As sessões e os dados continuam; só a tela muda.</li>
            <li>O ambiente {pending === '2d' ? '3D' : '2D'} é fechado em cada navegador e deixa de renderizar.</li>
            <li>Cada pessoa volta a aparecer numa posição válida do novo ambiente.</li>
          </ul>
        </Dialog>
      )}
    </main>
  );
}
