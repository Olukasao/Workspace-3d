import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { SessionUser } from '../shared/types';
import type { Db } from './db/driver';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;

/** Envolve um handler assíncrono para que erros cheguem ao tratador central. */
export const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => {
  fn(req, res).catch(next);
};

/** Identificador de correlação: aceita o do cliente (se bem formado) ou gera um. Vai para a resposta e para a trilha. */
export function correlation(req: Request, res: Response, next: NextFunction) {
  const given = req.header('x-correlation-id');
  const id = given && /^[A-Za-z0-9_-]{8,64}$/.test(given) ? given : randomUUID();
  res.locals.correlationId = id;
  res.setHeader('X-Correlation-Id', id);
  next();
}

export const correlationId = (res: Response): string => res.locals.correlationId as string;

/** Mutações só com JSON/binário enviado por fetch (cabeçalho próprio): bloqueia formulários de outros sites, junto do cookie SameSite=Strict. */
export function requireAppHeader(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.header('x-requested-with') !== 'office3d') return next(new HttpError(400, 'bad_request', 'Requisição sem o cabeçalho do aplicativo.'));
  next();
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  void _next;
  const cid = correlationId(res);
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, message: err.message, correlationId: cid, ...err.extra });
    return;
  }
  const e = err as { type?: string; status?: number; message?: string };
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: 'too_large', message: 'Arquivo ou corpo da requisição acima do limite permitido.', correlationId: cid });
    return;
  }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'bad_request', message: 'Corpo da requisição inválido.', correlationId: cid });
    return;
  }
  console.error(`[${cid}]`, err);
  res.status(500).json({ error: 'internal', message: 'Erro interno. Informe o identificador de correlação ao suporte.', correlationId: cid });
}

export interface AuditInput {
  user: SessionUser;
  action: string;
  targetType: string;
  targetId: string;
  objectId?: string | null;
  result: string;
  mode: 'demo' | 'real';
  detail?: Record<string, unknown>;
  correlationId: string;
}

/** Trilha de auditoria: ator, alvo, horário, resultado e identificador de correlação. Nunca guarda segredos nem conteúdo de documentos. */
export async function audit(db: Db, a: AuditInput): Promise<void> {
  await db.exec(
    'INSERT INTO action_audit (id, company_id, actor_user_id, actor_role, action, target_type, target_id, object_id, result, mode, detail_json, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [newId('aud'), a.user.companyId, a.user.id, a.user.role, a.action, a.targetType, a.targetId, a.objectId ?? null, a.result, a.mode, a.detail ? JSON.stringify(a.detail) : null, a.correlationId, Date.now()],
  );
}

export interface IdempotentResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Idempotência por (usuário, escopo, chave): a primeira requisição executa `fn`; repetições com a mesma chave devolvem
 * a MESMA resposta (marcada com `replayed`), sem executar de novo. Chave reutilizada com outro conteúdo é recusada.
 */
export async function idempotent(db: Db, user: SessionUser, scope: string, key: string | undefined, requestBody: unknown, fn: () => Promise<IdempotentResult>): Promise<IdempotentResult & { replayed: boolean }> {
  if (!key || !/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new HttpError(400, 'idempotency_key_required', 'Envie o cabeçalho Idempotency-Key (8 a 80 caracteres) nesta operação.');
  const requestHash = createHash('sha256').update(JSON.stringify(requestBody ?? null)).digest('hex');
  try {
    await db.exec('INSERT INTO idempotency_keys (user_id, scope, idem_key, company_id, request_hash, status_code, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)', [user.id, scope, key, user.companyId, requestHash, Date.now()]);
  } catch (e) {
    if (!db.isUniqueViolation(e)) throw e;
    // já existe: espera a primeira terminar (clique duplo chega quase junto) e devolve a mesma resposta
    for (let i = 0; i < 40; i++) {
      const rows = await db.query<{ request_hash: string; status_code: number; response_json: string | null }>('SELECT request_hash, status_code, response_json FROM idempotency_keys WHERE user_id = ? AND scope = ? AND idem_key = ?', [user.id, scope, key]);
      const row = rows[0];
      if (!row) break; // a primeira falhou com erro interno e liberou a chave
      if (row.request_hash !== requestHash) throw new HttpError(422, 'idempotency_key_reused', 'Esta chave de idempotência já foi usada com outro conteúdo.');
      if (row.status_code > 0) return { status: row.status_code, body: JSON.parse(row.response_json ?? '{}') as Record<string, unknown>, replayed: true };
      await new Promise((r) => setTimeout(r, 75));
    }
    throw new HttpError(409, 'in_progress', 'A operação anterior com esta chave ainda está em andamento.');
  }
  try {
    const out = await fn();
    await db.exec('UPDATE idempotency_keys SET status_code = ?, response_json = ? WHERE user_id = ? AND scope = ? AND idem_key = ?', [out.status, JSON.stringify(out.body), user.id, scope, key]);
    return { ...out, replayed: false };
  } catch (e) {
    if (e instanceof HttpError && e.status < 500) {
      // erro de negócio é determinístico: a repetição recebe o mesmo resultado
      const body = { error: e.code, message: e.message, ...e.extra };
      await db.exec('UPDATE idempotency_keys SET status_code = ?, response_json = ? WHERE user_id = ? AND scope = ? AND idem_key = ?', [e.status, JSON.stringify(body), user.id, scope, key]);
    } else {
      await db.exec('DELETE FROM idempotency_keys WHERE user_id = ? AND scope = ? AND idem_key = ?', [user.id, scope, key]);
    }
    throw e;
  }
}

export const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
