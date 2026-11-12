/**
 * Ações operacionais. Em todas: a permissão e o estado são reavaliados no servidor (requireAction), o alvo vem do vínculo
 * guardado pelo ID estável do objeto, e o resultado vai para a trilha com o identificador de correlação.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import express, { type Router } from 'express';
import type { AppContext } from '../app';
import { sha256 } from '../assets/glb';
import { currentUser } from '../auth';
import { one } from '../db/driver';
import { HttpError, audit, correlationId, h, idempotent, newId, str } from '../http';
import { allowedUrl, requireAction } from '../office';
import type { PrintJobStatus } from '../providers/types';

const PRINT_LABEL: Record<string, string> = { queued: 'Na fila', sent: 'Envio confirmado pela fila', completed: 'Conclusão reportada pela fila', failed: 'Falhou' };

export function actionRoutes(r: Router, { db, cfg, integrations }: AppContext) {
  const printDir = path.join(cfg.dataDir, 'print-spool');

  // ---------- chat ----------
  r.post('/offices/:id/actions/chat/open', h(async (req, res) => {
    const user = currentUser(res);
    const cid = correlationId(res);
    const objectId = str((req.body as { objectId?: unknown })?.objectId, 40) ?? '';
    const { object } = await requireAction(db, user, req.params.id, objectId, 'chat', integrations);
    const peer = object.seat!.employee!;
    const mode = integrations.chat.mode;
    try {
      integrations.ensureUp('chat');
      const self = user.employeeId ? await one<{ id: string; name: string; chat_ref: string | null }>(db, 'SELECT id, name, chat_ref FROM employees WHERE id = ? AND company_id = ?', [user.employeeId, user.companyId]) : null;
      const peerRow = await one<{ chat_ref: string | null }>(db, 'SELECT chat_ref FROM employees WHERE id = ? AND company_id = ?', [peer.id, user.companyId]);
      const out = await integrations.chat.openDirect(user, self ? { id: self.id, name: self.name, chatRef: self.chat_ref } : null, { id: peer.id, name: peer.name, chatRef: peerRow?.chat_ref ?? null });
      await audit(db, { user, action: 'chat.open', targetType: 'employee', targetId: peer.id, objectId, result: 'completed', mode, detail: { conversationId: out.conversationId, created: out.created }, correlationId: cid });
      res.json({ ...out, mode, peer, correlationId: cid });
    } catch (e) {
      await audit(db, { user, action: 'chat.open', targetType: 'employee', targetId: peer.id, objectId, result: 'failed', mode, detail: { error: (e as Error).message }, correlationId: cid });
      throw e;
    }
  }));

  r.get('/chat/conversations/:conversationId/messages', h(async (req, res) => {
    integrations.ensureUp('chat');
    res.json({ mode: integrations.chat.mode, messages: await integrations.chat.listMessages(currentUser(res), req.params.conversationId) });
  }));

  r.post('/chat/conversations/:conversationId/messages', h(async (req, res) => {
    const user = currentUser(res);
    if (user.role === 'viewer') throw new HttpError(403, 'forbidden', 'O perfil de visualizador não envia mensagens.');
    const body = str((req.body as { body?: unknown })?.body, 2000)?.trim();
    if (!body) throw new HttpError(400, 'bad_request', 'Mensagem vazia ou longa demais.');
    integrations.ensureUp('chat');
    res.status(201).json({ mode: integrations.chat.mode, message: await integrations.chat.sendMessage(user, req.params.conversationId, body) });
  }));

  // ---------- acesso remoto ----------
  r.post('/offices/:id/actions/remote/request', h(async (req, res) => {
    const user = currentUser(res);
    const cid = correlationId(res);
    const body = (req.body ?? {}) as { objectId?: unknown; confirm?: unknown };
    const objectId = str(body.objectId, 40) ?? '';
    const { object, bindings } = await requireAction(db, user, req.params.id, objectId, 'remote', integrations);
    if (body.confirm !== true) throw new HttpError(400, 'confirmation_required', 'O acesso remoto precisa de confirmação explícita.');
    const b = bindings.find((x) => x.binding_type === 'device')!;
    const mode = integrations.remote.mode;
    const requestId = newId('rar');
    try {
      integrations.ensureUp('remote');
      const out = await integrations.remote.prepare({ id: b.device_id!, name: b.device_name!, remoteProvider: b.remote_provider, remoteAddress: b.remote_address });
      await db.exec('INSERT INTO remote_access_requests (id, company_id, device_id, object_id, requested_by, provider, mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [requestId, user.companyId, b.device_id!, objectId, user.id, b.remote_provider ?? 'none', mode, out.status, Date.now()]);
      await audit(db, { user, action: 'remote.request', targetType: 'device', targetId: b.device_id!, objectId, result: out.status, mode, detail: { requestId, provider: b.remote_provider }, correlationId: cid });
      // no modo demonstração o endereço não é devolvido: nada é aberto
      res.json({ requestId, mode, status: out.status, device: { id: b.device_id, name: b.device_name }, note: out.note, address: mode === 'real' ? out.address : undefined, command: mode === 'real' ? out.command : undefined, launchUrl: mode === 'real' ? out.launchUrl : undefined, object: object.name, correlationId: cid });
    } catch (e) {
      await audit(db, { user, action: 'remote.request', targetType: 'device', targetId: b.device_id ?? '-', objectId, result: 'failed', mode, detail: { error: (e as Error).message }, correlationId: cid });
      throw e;
    }
  }));

  // ---------- transferência de atendimento ----------
  r.get('/tickets/active', h(async (_req, res) => {
    const user = currentUser(res);
    if (user.role === 'viewer') return res.json({ mode: integrations.transfer.mode, tickets: [], reason: 'O perfil de visualizador não tem atendimentos.' });
    integrations.ensureUp('transfer');
    const tickets = await integrations.transfer.activeTickets(user);
    res.json({ mode: integrations.transfer.mode, tickets, reason: tickets.length ? undefined : user.employeeId ? 'Você não tem atendimento ativo no momento. Só é possível transferir um atendimento que esteja com você.' : 'Sua conta não está ligada a um colaborador do diretório, então não há atendimento ativo para transferir.' });
  }));

  r.post('/offices/:id/actions/transfer', h(async (req, res) => {
    const user = currentUser(res);
    const cid = correlationId(res);
    const body = (req.body ?? {}) as { objectId?: unknown; ticketId?: unknown; expectedVersion?: unknown; confirm?: unknown };
    const objectId = str(body.objectId, 40) ?? '';
    const ticketId = str(body.ticketId, 40);
    if (!ticketId || !Number.isInteger(body.expectedVersion)) throw new HttpError(400, 'bad_request', 'Informe o atendimento e a versão vista na tela.');
    if (body.confirm !== true) throw new HttpError(400, 'confirmation_required', 'A transferência precisa de confirmação explícita.');
    const mode = integrations.transfer.mode;
    const out = await idempotent(db, user, 'transfer', req.header('idempotency-key'), { officeId: req.params.id, objectId, ticketId, expectedVersion: body.expectedVersion }, async () => {
      // elegibilidade do destino e permissão do operador, reavaliadas agora
      const { object } = await requireAction(db, user, req.params.id, objectId, 'transfer', integrations);
      const target = object.seat!.employee!;
      try {
        integrations.ensureUp('transfer');
        const result = await integrations.transfer.transfer(user, ticketId, body.expectedVersion as number, { employeeId: target.id });
        await audit(db, { user, action: 'ticket.transfer', targetType: 'ticket', targetId: ticketId, objectId, result: 'completed', mode, detail: { transferId: result.transferId, to: target.id, queue: result.ticket.queue }, correlationId: cid });
        return { status: 200, body: { mode, transferId: result.transferId, ticket: result.ticket, recipient: target, confirmedAt: result.confirmedAt, correlationId: cid } };
      } catch (e) {
        await audit(db, { user, action: 'ticket.transfer', targetType: 'ticket', targetId: ticketId, objectId, result: e instanceof HttpError ? e.code : 'failed', mode, detail: { to: target.id }, correlationId: cid });
        throw e;
      }
    });
    res.status(out.status).json({ ...out.body, replayed: out.replayed });
  }));

  // ---------- impressão ----------
  /** Etapa 1: o navegador abriu o diálogo de impressão. Isso NÃO comprova impressão nem escolhe a impressora — só fica registrado. */
  r.post('/offices/:id/actions/print/dialog', h(async (req, res) => {
    const user = currentUser(res);
    const body = (req.body ?? {}) as { objectId?: unknown; fileName?: unknown; fileSha256?: unknown; bytes?: unknown };
    const objectId = str(body.objectId, 40) ?? '';
    await requireAction(db, user, req.params.id, objectId, 'print', integrations);
    const fileName = str(body.fileName, 200) ?? 'documento.pdf';
    await audit(db, { user, action: 'print.dialog_opened', targetType: 'object', targetId: objectId, objectId, result: 'dialog_opened', mode: 'real', detail: { fileName, fileSha256: str(body.fileSha256, 64), bytes: Number(body.bytes) || 0 }, correlationId: correlationId(res) });
    res.json({ status: 'dialog_opened', note: 'O diálogo de impressão do navegador foi aberto. O sistema não sabe qual impressora foi escolhida nem se o documento foi impresso.', correlationId: correlationId(res) });
  }));

  const toJob = (j: { id: string; file_name: string; file_bytes: number; status: string; mode: string; created_at: number; updated_at: number }, status = j.status) => ({
    id: j.id, fileName: j.file_name, bytes: Number(j.file_bytes), status, statusLabel: PRINT_LABEL[status] ?? status, mode: j.mode, createdAt: Number(j.created_at), updatedAt: Number(j.updated_at),
  });

  /**
   * Etapa 2 (envio direto): manda o PDF para a fila da impressora CADASTRADA vinculada ao objeto.
   * Corpo = bytes do PDF. Limite de tamanho, checagem de assinatura, idempotência por chave e
   * proteção contra clique duplo (mesmo usuário + impressora + arquivo em poucos segundos = mesmo job).
   */
  r.post('/offices/:id/actions/print/jobs', express.raw({ type: () => true, limit: cfg.printMaxBytes }), h(async (req, res) => {
    const user = currentUser(res);
    const cid = correlationId(res);
    const objectId = str(req.query.objectId, 40) ?? '';
    const fileName = (str(req.query.fileName, 200) ?? 'documento.pdf').replace(/[\\/:*?"<>|]/g, '_');
    if (req.query.confirm !== 'true') throw new HttpError(400, 'confirmation_required', 'O envio para a impressora precisa de confirmação explícita.');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'bad_request', 'Documento ausente.');
    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    const hash = sha256(bytes);
    const mode = integrations.print.mode;
    const out = await idempotent(db, user, 'print', req.header('idempotency-key'), { officeId: req.params.id, objectId, hash }, async () => {
      const { bindings } = await requireAction(db, user, req.params.id, objectId, 'printQueue', integrations);
      const printer = bindings.find((b) => b.binding_type === 'device')!;
      if (body.subarray(0, 5).toString('latin1') !== '%PDF-') {
        await audit(db, { user, action: 'print.submit', targetType: 'device', targetId: printer.device_id!, objectId, result: 'rejected', mode, detail: { reason: 'invalid_type', fileName }, correlationId: cid });
        throw new HttpError(415, 'invalid_type', 'Arquivo inválido: só PDF é aceito para impressão (a assinatura do arquivo não é de PDF).');
      }
      const now = Date.now();
      // clique duplo com chaves diferentes: reaproveita o job recém-criado em vez de imprimir duas vezes
      const recent = await one<Parameters<typeof toJob>[0]>(db, "SELECT id, file_name, file_bytes, status, mode, created_at, updated_at FROM print_jobs WHERE company_id = ? AND user_id = ? AND printer_device_id = ? AND file_hash = ? AND created_at > ? AND status <> 'failed' ORDER BY created_at DESC", [user.companyId, user.id, printer.device_id!, hash, now - 15_000]);
      if (recent) return { status: 200, body: { job: toJob(recent), duplicateOf: recent.id, printer: { id: printer.device_id, name: printer.device_name }, correlationId: cid } };
      integrations.ensureUp('print');
      const id = newId('prn');
      mkdirSync(printDir, { recursive: true });
      const stored = path.join(printDir, `${id}.pdf`);
      writeFileSync(stored, body);
      try {
        const sub = await integrations.print.submit({ id, printerDeviceId: printer.device_id!, fileName, bytes });
        const purgeAfter = now + cfg.printRetentionMinutes * 60_000;
        await db.exec('INSERT INTO print_jobs (id, company_id, printer_device_id, object_id, user_id, file_name, file_hash, file_bytes, stored_path, mode, status, created_at, updated_at, purge_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, user.companyId, printer.device_id!, objectId, user.id, fileName, hash, body.length, `${id}.pdf`, mode, sub.status, now, now, purgeAfter]);
        await audit(db, { user, action: 'print.submit', targetType: 'device', targetId: printer.device_id!, objectId, result: sub.status, mode, detail: { jobId: id, fileName, bytes: body.length, fileSha256: hash }, correlationId: cid });
        return { status: 201, body: { job: toJob({ id, file_name: fileName, file_bytes: body.length, status: sub.status, mode, created_at: now, updated_at: now }), printer: { id: printer.device_id, name: printer.device_name }, retentionMinutes: cfg.printRetentionMinutes, correlationId: cid } };
      } catch (e) {
        rmSync(stored, { force: true });
        await audit(db, { user, action: 'print.submit', targetType: 'device', targetId: printer.device_id!, objectId, result: 'failed', mode, detail: { fileName, error: (e as Error).message }, correlationId: cid });
        throw e;
      }
    });
    res.status(out.status).json({ ...out.body, replayed: out.replayed });
  }));

  r.get('/print/jobs/:jobId', h(async (req, res) => {
    const user = currentUser(res);
    const j = await one<{ id: string; file_name: string; file_bytes: number; status: string; mode: string; created_at: number; updated_at: number; stored_path: string | null }>(db, 'SELECT id, file_name, file_bytes, status, mode, created_at, updated_at, stored_path FROM print_jobs WHERE id = ? AND company_id = ? AND user_id = ?', [req.params.jobId, user.companyId, user.id]);
    if (!j) throw new HttpError(404, 'not_found', 'Trabalho de impressão não encontrado.');
    let status = j.status as PrintJobStatus;
    if (status !== 'completed' && status !== 'failed') {
      if (integrations.isDown('print')) return res.json({ job: toJob(j), stale: true, note: 'A fila de impressão não respondeu; este é o último estado conhecido.' });
      status = (await integrations.print.status({ id: j.id, createdAt: Number(j.created_at), status })).status;
      if (status !== j.status) {
        await db.exec('UPDATE print_jobs SET status = ?, updated_at = ? WHERE id = ? AND company_id = ?', [status, Date.now(), j.id, user.companyId]);
        await audit(db, { user, action: 'print.status', targetType: 'print_job', targetId: j.id, result: status, mode: j.mode as 'demo' | 'real', correlationId: correlationId(res) });
        // retenção: o documento sai do disco assim que a fila reporta um estado final
        if ((status === 'completed' || status === 'failed') && j.stored_path) {
          rmSync(path.join(printDir, j.stored_path), { force: true });
          await db.exec('UPDATE print_jobs SET stored_path = NULL WHERE id = ?', [j.id]);
        }
      }
    }
    res.json({ job: toJob(j, status) });
  }));

  // ---------- painel de TV e link de CAD ----------
  for (const kind of ['dashboard', 'cad'] as const) {
    r.post(`/offices/:id/actions/${kind}/open`, h(async (req, res) => {
      const user = currentUser(res);
      const objectId = str((req.body as { objectId?: unknown })?.objectId, 40) ?? '';
      const { bindings } = await requireAction(db, user, req.params.id, objectId, kind, integrations);
      const b = bindings.find((x) => x.binding_type === (kind === 'dashboard' ? 'dashboard' : 'cad_link'))!;
      const conf = JSON.parse(b.config_json ?? '{}') as { name?: string; url?: string };
      const url = allowedUrl(conf.url, kind === 'dashboard' ? cfg.dashboardAllowedHosts : cfg.cadAllowedHosts, kind === 'dashboard' && cfg.demoMode);
      if (!url) throw new HttpError(403, 'forbidden', 'O endereço não está autorizado no servidor.');
      const mode = url.startsWith('/demo/') ? 'demo' : 'real';
      await audit(db, { user, action: `${kind}.open`, targetType: 'object', targetId: objectId, objectId, result: 'completed', mode, detail: { name: conf.name }, correlationId: correlationId(res) });
      res.json({ name: conf.name, url, mode, correlationId: correlationId(res) });
    }));
  }

  return { purgeExpiredPrintFiles };

  /** Retenção: apaga do disco os documentos vencidos (chamado periodicamente pelo servidor). */
  async function purgeExpiredPrintFiles(): Promise<number> {
    const rows = await db.query<{ id: string; stored_path: string }>('SELECT id, stored_path FROM print_jobs WHERE stored_path IS NOT NULL AND purge_after < ?', [Date.now()]);
    for (const j of rows) {
      rmSync(path.join(printDir, j.stored_path), { force: true });
      await db.exec('UPDATE print_jobs SET stored_path = NULL WHERE id = ?', [j.id]);
    }
    // arquivos sem registro (queda entre gravar o arquivo e o banco) também saem
    if (existsSync(printDir)) {
      const known = new Set((await db.query<{ stored_path: string }>('SELECT stored_path FROM print_jobs WHERE stored_path IS NOT NULL')).map((x) => x.stored_path));
      for (const f of readdirSync(printDir)) if (!known.has(f)) rmSync(path.join(printDir, f), { force: true });
    }
    return rows.length;
  }
}
