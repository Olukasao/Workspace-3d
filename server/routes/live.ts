/**
 * Presença ao vivo (SSE) e aparência do avatar.
 * - GET  /api/live/stream     fluxo SSE autenticado: `snapshot` ao conectar, depois `person` (incremental) e `resync`
 * - GET  /api/live/snapshot   o mesmo snapshot por HTTP (o cliente recarrega ao reconectar)
 * - POST /api/live/typing     { state: 'start' | 'stop' } — só o booleano, do próprio usuário
 * - POST /api/live/call       { action: 'start' | 'end', speakingSignal?: boolean } — ciclo de atendimento (demo)
 * - POST /api/live/speaking   { speaking: boolean } — indicador booleano de fala (demo)
 * - GET  /api/avatar/catalog  catálogo de peças por slot
 * - GET  /api/avatar/me       aparência do próprio colaborador
 * - PUT  /api/avatar/me       { config, baseVersion } — salva (versão para gravação concorrente)
 * - PUT  /api/avatar/employees/:id  só aceita o próprio colaborador (ninguém edita o avatar de outra pessoa)
 */
import type { Router } from 'express';
import { AVATAR_CATALOG, AVATAR_CATALOG_VERSION, defaultAvatar, validateAvatar, type AvatarConfig } from '../../shared/avatarCatalog';
import type { AppContext } from '../app';
import { currentUser } from '../auth';
import { one } from '../db/driver';
import { HttpError, audit, correlationId, h } from '../http';

export function liveRoutes(r: Router, ctx: AppContext) {
  const { db, live, cfg } = ctx;
  const canSeePresence = (role: string) => role !== 'viewer';

  r.get('/live/stream', h(async (_req, res) => {
    const user = currentUser(res);
    await live.ensureSimulated(user.companyId);
    const close = await live.connect(user, res, canSeePresence(user.role));
    // 'close' da RESPOSTA (o da requisição dispara assim que o GET é consumido, antes deste ponto)
    if (res.writableEnded || res.destroyed) close();
    else res.on('close', close);
  }));

  r.get('/live/snapshot', h(async (_req, res) => {
    const user = currentUser(res);
    await live.ensureSimulated(user.companyId);
    res.json(await live.snapshot(user, canSeePresence(user.role)));
  }));

  const wrap = async (fn: () => Promise<unknown>) => {
    try {
      return await fn();
    } catch (e) {
      const err = e as { status?: number; code?: string; message?: string };
      if (err.status) throw new HttpError(err.status, err.code ?? 'error', err.message ?? 'Erro.');
      throw e;
    }
  };

  r.post('/live/typing', h(async (req, res) => {
    const user = currentUser(res);
    const state = (req.body as { state?: unknown })?.state;
    if (state !== 'start' && state !== 'stop') throw new HttpError(400, 'bad_request', 'state deve ser start ou stop.');
    // só o booleano: o corpo não carrega texto, teclas nem conversa (campos extras são ignorados)
    res.json({ person: await wrap(() => live.typing(user, state)) });
  }));

  // Ciclo de atendimento. Em demonstração o próprio usuário liga e desliga a chamada; com provedor real,
  // a fonte é o sistema de atendimento/telefonia (CALL_PROVIDER) e estas rotas ficam desativadas.
  r.post('/live/call', h(async (req, res) => {
    const user = currentUser(res);
    if (cfg.callProvider !== 'demo') throw new HttpError(409, 'not_configured', 'O ciclo de atendimento vem do sistema de telefonia; o controle manual existe só na demonstração.');
    const { action, speakingSignal } = (req.body ?? {}) as { action?: unknown; speakingSignal?: unknown };
    if (action !== 'start' && action !== 'end') throw new HttpError(400, 'bad_request', 'action deve ser start ou end.');
    if (!user.employeeId) throw new HttpError(409, 'no_employee', 'Sua conta não está ligada a um colaborador do diretório.');
    const demo = live.calls as { start?: (c: string, e: string) => void; end?: (c: string, e: string) => void };
    if (action === 'start') demo.start?.(user.companyId, user.employeeId);
    else demo.end?.(user.companyId, user.employeeId);
    const person = await wrap(() => (action === 'start' ? live.callStart(user, { speakingSignal: speakingSignal === true, source: 'demo' }) : live.callEnd(user)));
    await audit(db, { user, action: `call.${action}`, targetType: 'employee', targetId: user.employeeId, result: 'completed', mode: 'demo', correlationId: correlationId(res) });
    res.json({ person });
  }));

  r.post('/live/speaking', h(async (req, res) => {
    const user = currentUser(res);
    if (cfg.callProvider !== 'demo') throw new HttpError(409, 'not_configured', 'O indicador de fala vem do sistema de telefonia.');
    const speaking = (req.body as { speaking?: unknown })?.speaking;
    if (typeof speaking !== 'boolean') throw new HttpError(400, 'bad_request', 'speaking deve ser verdadeiro ou falso.');
    res.json({ person: await wrap(() => live.speaking(user, speaking)) });
  }));

  // ---------- aparência ----------
  r.get('/avatar/catalog', (_req, res) => res.json({ version: AVATAR_CATALOG_VERSION, catalog: AVATAR_CATALOG }));

  const loadMine = async (companyId: string, employeeId: string) => {
    const row = await one<{ config_json: string; version: number; updated_at: number }>(db, 'SELECT config_json, version, updated_at FROM avatar_profiles WHERE employee_id = ? AND company_id = ?', [employeeId, companyId]);
    return row ? { config: JSON.parse(row.config_json) as AvatarConfig, version: Number(row.version), updatedAt: Number(row.updated_at), saved: true } : { config: defaultAvatar(employeeId), version: 0, updatedAt: 0, saved: false };
  };

  r.get('/avatar/me', h(async (_req, res) => {
    const user = currentUser(res);
    if (!user.employeeId) throw new HttpError(409, 'no_employee', 'Sua conta não está ligada a um colaborador do diretório, então não tem avatar no escritório.');
    res.json(await loadMine(user.companyId, user.employeeId));
  }));

  const save = async (employeeId: string, body: unknown, resLocals: Parameters<typeof currentUser>[0]) => {
    const user = currentUser(resLocals);
    // regra de autorização: só o próprio colaborador edita a própria aparência (nem administrador edita a de outra pessoa)
    if (!user.employeeId || user.employeeId !== employeeId) throw new HttpError(403, 'forbidden', 'Você só pode editar o seu próprio avatar.');
    const { config, baseVersion } = (body ?? {}) as { config?: unknown; baseVersion?: unknown };
    if (!Number.isInteger(baseVersion)) throw new HttpError(400, 'bad_request', 'Informe a versão-base do avatar.');
    const errors = validateAvatar(config);
    if (errors.length) throw new HttpError(422, 'invalid_avatar', 'A configuração do avatar tem itens fora do catálogo.', { details: errors });
    const json = JSON.stringify(config);
    const now = Date.now();
    const out = await db.tx(async (tx) => {
      const cur = await one<{ version: number }>(tx, 'SELECT version FROM avatar_profiles WHERE employee_id = ? AND company_id = ?', [employeeId, user.companyId]);
      const curVersion = Number(cur?.version ?? 0);
      if (curVersion !== baseVersion) throw new HttpError(409, 'avatar_conflict', 'Seu avatar foi salvo em outra aba ou dispositivo. Recarregue para continuar.', { currentVersion: curVersion });
      if (cur) await tx.exec('UPDATE avatar_profiles SET config_json = ?, catalog_version = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE employee_id = ? AND company_id = ? AND version = ?', [json, AVATAR_CATALOG_VERSION, user.id, now, employeeId, user.companyId, curVersion]);
      else await tx.exec('INSERT INTO avatar_profiles (employee_id, company_id, config_json, catalog_version, version, updated_by, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)', [employeeId, user.companyId, json, AVATAR_CATALOG_VERSION, user.id, now]);
      return curVersion + 1;
    });
    await live.appearanceChanged(user.companyId, employeeId, config, out);
    await audit(db, { user, action: 'avatar.save', targetType: 'employee', targetId: employeeId, result: 'completed', mode: 'real', detail: { version: out }, correlationId: correlationId(resLocals) });
    return { version: out, config, updatedAt: now };
  };

  r.put('/avatar/me', h(async (req, res) => {
    const user = currentUser(res);
    if (!user.employeeId) throw new HttpError(409, 'no_employee', 'Sua conta não está ligada a um colaborador do diretório.');
    res.json(await save(user.employeeId, req.body, res));
  }));
  r.put('/avatar/employees/:id', h(async (req, res) => res.json(await save(req.params.id, req.body, res))));
}
