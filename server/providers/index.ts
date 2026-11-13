import type { IntegrationStatus } from '../../shared/types';
import type { Config } from '../config';
import type { Db } from '../db/driver';
import { DemoChat, DemoPresence, DemoPrint, DemoRemoteAccess, DemoTransfer } from './demo';
import { IppPrint, RealRemoteAccess, NoPrint, WorkscapeChat, WorkscapePresence, WorkscapeTransfer } from './real';
import { ProviderUnavailable, type ChatProvider, type PresenceProvider, type PrintProvider, type RemoteAccessProvider, type ServiceId, type TransferProvider } from './types';

const LABELS: Record<ServiceId, string> = { chat: 'Chat', presence: 'Presença', remote: 'Acesso remoto', transfer: 'Transferência de atendimento', print: 'Fila de impressão' };

export class Integrations {
  chat: ChatProvider;
  presence: PresenceProvider;
  remote: RemoteAccessProvider;
  transfer: TransferProvider;
  print: PrintProvider;
  /** Serviços com falha SIMULADA (só no modo demonstração), para exercitar o estado "indisponível". */
  outages = new Set<ServiceId>();

  constructor(
    public cfg: Config,
    db: Db,
  ) {
    this.chat = cfg.chatProvider === 'demo' ? new DemoChat(db) : new WorkscapeChat(cfg);
    this.presence = cfg.chatProvider === 'demo' ? new DemoPresence() : new WorkscapePresence();
    this.remote = cfg.remoteProvider === 'demo' ? new DemoRemoteAccess() : new RealRemoteAccess(cfg.remoteProvider, cfg.anydeskLaunch, cfg.rustdeskLaunch);
    this.transfer = cfg.transferProvider === 'demo' ? new DemoTransfer(db) : new WorkscapeTransfer();
    this.print = cfg.printProvider === 'demo' ? new DemoPrint() : cfg.printProvider === 'ipp' ? new IppPrint() : new NoPrint();
  }

  get(service: ServiceId) {
    return this[service];
  }

  isDown(service: ServiceId): boolean {
    return this.outages.has(service);
  }

  /** Lança se o serviço estiver fora do ar (falha simulada). Chamado antes de cada uso. */
  ensureUp(service: ServiceId): void {
    if (this.isDown(service)) throw new ProviderUnavailable(service, `${LABELS[service]}: serviço indisponível no momento.`);
  }

  status(): IntegrationStatus[] {
    const out: IntegrationStatus[] = (Object.keys(LABELS) as ServiceId[]).map((id) => {
      const p = this.get(id);
      return { id, label: LABELS[id], mode: p.mode, state: this.isDown(id) ? 'unavailable' : p.configured ? 'ok' : 'not_configured', detail: this.isDown(id) ? 'Falha simulada pelo administrador (demonstração).' : p.detail };
    });
    out.push({
      id: 'cad',
      label: 'Visualizador CAD (Autodesk)',
      mode: 'real',
      state: this.cfg.cadAllowedHosts.length ? 'ok' : 'not_configured',
      detail: this.cfg.cadAllowedHosts.length ? `Links autorizados: ${this.cfg.cadAllowedHosts.join(', ')}` : 'Integração a confirmar. Defina CAD_ALLOWED_HOSTS para liberar links de projeto.',
    });
    return out;
  }
}
