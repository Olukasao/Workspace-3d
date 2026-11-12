/**
 * Adaptadores de DEMONSTRAÇÃO: simulam chat, presença, acesso remoto, transferência e fila de impressão
 * dentro do próprio banco, com dados fictícios. Nenhum serviço externo é chamado.
 */
import type { PresenceState, SessionUser } from '../../shared/types';
import { one, type Db } from '../db/driver';
import { HttpError, newId } from '../http';
import type { ChatMessage, ChatProvider, EmployeeRef, PresenceProvider, PrintJobStatus, PrintProvider, RemoteAccessProvider, RemoteDevice, Ticket, TransferProvider } from './types';

const refOf = (user: SessionUser, self: EmployeeRef | null) => self?.id ?? `user:${user.id}`;

export class DemoChat implements ChatProvider {
  mode = 'demo' as const;
  configured = true;
  detail = 'Conversas simuladas, guardadas apenas neste banco de demonstração.';
  constructor(private db: Db) {}

  async openDirect(user: SessionUser, self: EmployeeRef | null, peer: EmployeeRef) {
    const pairKey = [refOf(user, self), peer.id].sort().join('|');
    const find = () => one<{ id: string }>(this.db, 'SELECT id FROM chat_conversations WHERE company_id = ? AND pair_key = ?', [user.companyId, pairKey]);
    const existing = await find();
    if (existing) return { conversationId: existing.id, created: false };
    const id = newId('conv');
    try {
      await this.db.exec('INSERT INTO chat_conversations (id, company_id, pair_key, created_by, created_at) VALUES (?, ?, ?, ?, ?)', [id, user.companyId, pairKey, user.id, Date.now()]);
      return { conversationId: id, created: true };
    } catch (e) {
      // duas solicitações ao mesmo tempo: a restrição única garante uma só conversa por par
      if (!this.db.isUniqueViolation(e)) throw e;
      const other = await find();
      if (!other) throw e;
      return { conversationId: other.id, created: false };
    }
  }

  private async conversation(user: SessionUser, conversationId: string) {
    const c = await one<{ id: string; pair_key: string }>(this.db, 'SELECT id, pair_key FROM chat_conversations WHERE id = ? AND company_id = ?', [conversationId, user.companyId]);
    const me = user.employeeId ?? `user:${user.id}`;
    if (!c || !c.pair_key.split('|').includes(me)) throw new HttpError(404, 'not_found', 'Conversa não encontrada.');
    return { me };
  }

  async listMessages(user: SessionUser, conversationId: string): Promise<ChatMessage[]> {
    const { me } = await this.conversation(user, conversationId);
    const rows = await this.db.query<{ id: string; sender_ref: string; body: string; created_at: number }>('SELECT id, sender_ref, body, created_at FROM chat_messages WHERE conversation_id = ? AND company_id = ? ORDER BY created_at ASC LIMIT 200', [conversationId, user.companyId]);
    return rows.map((r) => ({ id: r.id, senderRef: r.sender_ref, mine: r.sender_ref === me, body: r.body, createdAt: Number(r.created_at) }));
  }

  async sendMessage(user: SessionUser, conversationId: string, body: string): Promise<ChatMessage> {
    const { me } = await this.conversation(user, conversationId);
    const msg = { id: newId('msg'), senderRef: me, mine: true, body, createdAt: Date.now() };
    await this.db.exec('INSERT INTO chat_messages (id, company_id, conversation_id, sender_ref, body, created_at) VALUES (?, ?, ?, ?, ?, ?)', [msg.id, user.companyId, conversationId, me, body, msg.createdAt]);
    return msg;
  }
}

export class DemoPresence implements PresenceProvider {
  mode = 'demo' as const;
  configured = true;
  detail = 'Presença simulada (muda a cada 10 minutos).';
  async presence(_companyId: string, employeeIds: string[]): Promise<Record<string, PresenceState>> {
    const states: PresenceState[] = ['available', 'available', 'busy', 'available', 'away', 'offline'];
    const bucket = Math.floor(Date.now() / 600_000);
    const out: Record<string, PresenceState> = {};
    for (const id of employeeIds) {
      let hash = bucket;
      for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
      out[id] = states[hash % states.length];
    }
    return out;
  }
}

export class DemoRemoteAccess implements RemoteAccessProvider {
  mode = 'demo' as const;
  configured = true;
  detail = 'Pedidos são apenas registrados; nenhum cliente de acesso remoto é aberto.';
  async prepare(_device: RemoteDevice) {
    return { status: 'registered' as const, note: 'Demonstração: o pedido foi registrado na trilha, mas nenhum programa de acesso remoto foi aberto.' };
  }
}

const toTicket = (r: { id: string; protocol: string; customer_name: string; subject: string; queue_name: string; version: number }): Ticket => ({ id: r.id, protocol: r.protocol, customerName: r.customer_name, subject: r.subject, queue: r.queue_name, version: Number(r.version) });

export class DemoTransfer implements TransferProvider {
  mode = 'demo' as const;
  configured = true;
  detail = 'Atendimentos fictícios guardados neste banco de demonstração.';
  constructor(private db: Db) {}

  async activeTickets(user: SessionUser): Promise<Ticket[]> {
    if (!user.employeeId) return [];
    const rows = await this.db.query<Parameters<typeof toTicket>[0]>("SELECT id, protocol, customer_name, subject, queue_name, version FROM service_tickets WHERE company_id = ? AND assignee_employee_id = ? AND status = 'active' ORDER BY protocol", [user.companyId, user.employeeId]);
    return rows.map(toTicket);
  }

  async transfer(user: SessionUser, ticketId: string, expectedVersion: number, target: { employeeId: string }) {
    if (!user.employeeId) throw new HttpError(409, 'no_active_ticket', 'Sua conta não está ligada a um colaborador com atendimentos.');
    const from = user.employeeId;
    return this.db.tx(async (tx) => {
      const now = Date.now();
      // controle de concorrência: só altera se o atendimento ainda for do operador, estiver ativo e na versão vista por ele
      const upd = await tx.exec("UPDATE service_tickets SET assignee_employee_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND company_id = ? AND assignee_employee_id = ? AND status = 'active' AND version = ?", [target.employeeId, now, ticketId, user.companyId, from, expectedVersion]);
      if (!upd.affected) {
        const cur = await one<{ assignee_employee_id: string; status: string; version: number }>(tx, 'SELECT assignee_employee_id, status, version FROM service_tickets WHERE id = ? AND company_id = ?', [ticketId, user.companyId]);
        if (!cur) throw new HttpError(404, 'not_found', 'Atendimento não encontrado.');
        if (cur.assignee_employee_id !== from || cur.status !== 'active') throw new HttpError(409, 'no_active_ticket', 'Este atendimento não está mais ativo com você (já foi transferido ou encerrado).');
        throw new HttpError(409, 'ticket_changed', 'O atendimento mudou desde que você abriu esta tela. Atualize e tente de novo.', { currentVersion: Number(cur.version) });
      }
      const row = await one<Parameters<typeof toTicket>[0]>(tx, 'SELECT id, protocol, customer_name, subject, queue_name, version FROM service_tickets WHERE id = ?', [ticketId]);
      const transferId = newId('trf');
      await tx.exec('INSERT INTO ticket_transfers (id, company_id, ticket_id, from_employee_id, to_employee_id, queue_name, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [transferId, user.companyId, ticketId, from, target.employeeId, row!.queue_name, user.id, now]);
      return { transferId, ticket: toTicket(row!), confirmedAt: now };
    });
  }
}

/** Fila simulada: o estado avança com o tempo desde a criação (na fila → enviado → concluído). */
export class DemoPrint implements PrintProvider {
  mode = 'demo' as const;
  configured = true;
  detail = 'Fila simulada: nada é enviado a uma impressora física.';
  static readonly SENT_AFTER_MS = 2500;
  static readonly DONE_AFTER_MS = 7000;
  async submit() {
    return { status: 'queued' as PrintJobStatus };
  }
  async status(job: { createdAt: number; status: PrintJobStatus }) {
    if (job.status === 'failed' || job.status === 'completed') return { status: job.status };
    const age = Date.now() - job.createdAt;
    return { status: (age >= DemoPrint.DONE_AFTER_MS ? 'completed' : age >= DemoPrint.SENT_AFTER_MS ? 'sent' : 'queued') as PrintJobStatus };
  }
}
