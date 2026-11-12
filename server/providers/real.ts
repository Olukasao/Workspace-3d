/**
 * Pontos de encaixe dos serviços REAIS. Só o AnyDesk tem comportamento implementado (endereço autorizado / link do cliente oficial);
 * Workscape e servidor de impressão ficam como adaptadores "não configurados" até existirem documentação, credenciais
 * e ambiente de homologação — ver docs/integrations.md. Nenhum contrato foi inventado aqui.
 */
import type { Config } from '../config';
import { ProviderNotConfigured, type ChatProvider, type PresenceProvider, type PrintProvider, type RemoteAccessProvider, type RemoteDevice, type TransferProvider } from './types';

const WORKSCAPE_PENDING = 'Adaptador Workscape aguardando o contrato real da API (autenticação, conversas, presença e atendimentos).';

export class WorkscapeChat implements ChatProvider {
  mode = 'real' as const;
  configured = false;
  detail: string;
  constructor(cfg: Config) {
    this.detail = cfg.workscape.baseUrl && cfg.workscape.token ? WORKSCAPE_PENDING : 'Defina WORKSCAPE_BASE_URL e WORKSCAPE_TOKEN. ' + WORKSCAPE_PENDING;
  }
  async openDirect(): Promise<never> {
    throw new ProviderNotConfigured('chat', this.detail);
  }
  async listMessages(): Promise<never> {
    throw new ProviderNotConfigured('chat', this.detail);
  }
  async sendMessage(): Promise<never> {
    throw new ProviderNotConfigured('chat', this.detail);
  }
}

export class WorkscapePresence implements PresenceProvider {
  mode = 'real' as const;
  configured = false;
  detail = WORKSCAPE_PENDING;
  async presence(): Promise<never> {
    throw new ProviderNotConfigured('presence', this.detail);
  }
}

export class WorkscapeTransfer implements TransferProvider {
  mode = 'real' as const;
  configured = false;
  detail = WORKSCAPE_PENDING;
  async activeTickets(): Promise<never> {
    throw new ProviderNotConfigured('transfer', this.detail);
  }
  async transfer(): Promise<never> {
    throw new ProviderNotConfigured('transfer', this.detail);
  }
}

/**
 * AnyDesk. O mecanismo DOCUMENTADO pelo fabricante é a linha de comando do cliente oficial: "anydesk.exe <ID/Alias>"
 * (https://support.anydesk.com/command-line-interface-for-windows). Um navegador não executa programas, então há dois modos:
 *  - 'manual' (padrão): o sistema mostra o endereço autorizado do dispositivo e o comando documentado; o operador abre o AnyDesk.
 *  - 'uri': o sistema também devolve o link "anydesk:<endereço>", que o cliente oficial costuma registrar no Windows. Esse protocolo
 *    NÃO consta na página de referência: só ligue (ANYDESK_LAUNCH=uri) depois de validar no ambiente gerenciado.
 * Em ambos, consentimento e autenticação ficam no AnyDesk. Nunca usamos --with-password, nunca guardamos senha,
 * nunca executamos comandos e nunca conectamos sozinhos.
 */
export class AnyDeskRemoteAccess implements RemoteAccessProvider {
  mode = 'real' as const;
  configured = true;
  detail: string;
  constructor(private launch: 'manual' | 'uri') {
    this.detail = launch === 'uri' ? 'Abre o cliente oficial do AnyDesk pelo link anydesk: (validado no ambiente gerenciado).' : 'Mostra o endereço AnyDesk autorizado; o operador abre o cliente oficial.';
  }
  async prepare(device: RemoteDevice) {
    const address = (device.remoteAddress ?? '').replace(/\s+/g, '');
    // endereço AnyDesk: ID numérico (9 ou 10 dígitos) ou alias nome@namespace
    if (device.remoteProvider !== 'anydesk' || !/^(\d{9,10}|[A-Za-z0-9._-]{1,64}@[A-Za-z0-9._-]{1,64})$/.test(address)) {
      throw new ProviderNotConfigured('remote', 'Este dispositivo não tem um endereço AnyDesk válido cadastrado.');
    }
    return {
      status: 'launch_ready' as const,
      address,
      command: 'anydesk.exe ' + address,
      launchUrl: this.launch === 'uri' ? 'anydesk:' + address : undefined,
      note: 'Abra o AnyDesk neste computador com o endereço indicado. A pessoa do outro lado precisa aceitar a sessão no próprio AnyDesk.',
    };
  }
}

/** Servidor de impressão corporativo (IPP/CUPS ou agente gerenciado): desenho do adaptador em docs/integrations.md. */
export class IppPrint implements PrintProvider {
  mode = 'real' as const;
  configured = false;
  detail = 'Adaptador de servidor de impressão ainda não implementado: depende do servidor/agente da empresa.';
  async submit(): Promise<never> {
    throw new ProviderNotConfigured('print', this.detail);
  }
  async status(): Promise<never> {
    throw new ProviderNotConfigured('print', this.detail);
  }
}

/** Sem envio direto: só o diálogo de impressão do navegador. */
export class NoPrint implements PrintProvider {
  mode = 'real' as const;
  configured = false;
  detail = 'Envio direto desativado (PRINT_PROVIDER=none): disponível apenas o diálogo de impressão do navegador.';
  async submit(): Promise<never> {
    throw new ProviderNotConfigured('print', this.detail);
  }
  async status(): Promise<never> {
    throw new ProviderNotConfigured('print', this.detail);
  }
}
