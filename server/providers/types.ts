/**
 * Contratos dos conectores. Cada serviço externo tem um adaptador de DEMONSTRAÇÃO (simulado, com dados fictícios)
 * e um ponto de encaixe para o serviço real. A interface do produto só conversa com estes contratos.
 */
import type { PresenceState, SessionUser } from '../../shared/types';

export type ProviderMode = 'demo' | 'real';

export class ProviderUnavailable extends Error {
  constructor(public service: string, message = 'Serviço temporariamente indisponível.') {
    super(message);
  }
}

export class ProviderNotConfigured extends Error {
  constructor(public service: string, message = 'Integração não configurada.') {
    super(message);
  }
}

export interface ProviderInfo {
  mode: ProviderMode;
  /** false = falta configuração/contrato; as ações aparecem como "não configurado". */
  configured: boolean;
  detail?: string;
}

export interface EmployeeRef {
  id: string;
  name: string;
  chatRef: string | null;
}

export interface ChatMessage {
  id: string;
  senderRef: string;
  mine: boolean;
  body: string;
  createdAt: number;
}

export interface ChatProvider extends ProviderInfo {
  /** Abre a conversa direta existente ou cria uma. Chamadas concorrentes para o mesmo par devolvem a MESMA conversa. */
  openDirect(user: SessionUser, self: EmployeeRef | null, peer: EmployeeRef): Promise<{ conversationId: string; created: boolean }>;
  listMessages(user: SessionUser, conversationId: string): Promise<ChatMessage[]>;
  sendMessage(user: SessionUser, conversationId: string, body: string): Promise<ChatMessage>;
}

export interface PresenceProvider extends ProviderInfo {
  presence(companyId: string, employeeIds: string[]): Promise<Record<string, PresenceState>>;
}

export interface RemoteDevice {
  id: string;
  name: string;
  remoteProvider: string | null;
  remoteAddress: string | null;
}

export interface RemoteAccessProvider extends ProviderInfo {
  /**
   * Registra o pedido e devolve como o cliente OFICIAL deve ser aberto. Consentimento e autenticação acontecem
   * dentro do produto de acesso remoto: este sistema nunca guarda senha, nunca executa comandos e nunca conecta sozinho.
   */
  prepare(device: RemoteDevice): Promise<{ status: 'registered' | 'launch_ready'; address?: string; command?: string; launchUrl?: string; note: string }>;
}

export interface Ticket {
  id: string;
  protocol: string;
  customerName: string;
  subject: string;
  queue: string;
  version: number;
}

export interface TransferProvider extends ProviderInfo {
  activeTickets(user: SessionUser): Promise<Ticket[]>;
  /** Transfere o atendimento ATIVO do operador. Falha com conflito se o estado mudou desde `expectedVersion`. */
  transfer(user: SessionUser, ticketId: string, expectedVersion: number, target: { employeeId: string }): Promise<{ transferId: string; ticket: Ticket; confirmedAt: number }>;
}

export type PrintJobStatus = 'queued' | 'sent' | 'completed' | 'failed';

export interface PrintProvider extends ProviderInfo {
  /** Envia o documento para a fila do destino autorizado e devolve o estado inicial. */
  submit(job: { id: string; printerDeviceId: string; fileName: string; bytes: Uint8Array }): Promise<{ status: PrintJobStatus }>;
  /** Estado atual reportado pela fila (envio confirmado ≠ impressão concluída). */
  status(job: { id: string; createdAt: number; status: PrintJobStatus }): Promise<{ status: PrintJobStatus }>;
}

export type ServiceId = 'chat' | 'presence' | 'remote' | 'transfer' | 'print';
