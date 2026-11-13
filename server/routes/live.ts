/**
 * Presença ao vivo (SSE) e aparência do avatar.
 * - GET  /api/live/stream     fluxo SSE autenticado: `snapshot` ao conectar, depois `person` (incremental) e `resync`
 * - GET  /api/live/snapshot   o mesmo snapshot por HTTP (o cliente recarrega ao reconectar)
 * - POST /api/live/typing     { state: 'start' | 'stop' } — só o booleano, do próprio usuário
 * - POST /api/live/call       { action: 'start' | 'end', speakingSignal?: boolean } — ciclo de atendimento (demo)
 * - POST /api/live/away       { away: boolean } — "ausente" (a própria pessoa)
 * - POST /api/live/speaking   { speaking: boolean } — indicador booleano de fala (demo)
 * - GET  /api/avatar/model/:model/lod0.glb|lod1.glb  modelo 3D gerado pelo servidor para um personagem personalizado (só da empresa)
 * - GET  /api/avatar/catalog  estilo ativo da empresa + galeria Ara 3D Gen + catálogo de peças do MakeHuman
 * - GET  /api/admin/avatar-style  estilo ativo e opções (admin); PUT { style } troca o estilo da empresa, ao vivo para todos
 * - GET  /api/avatar/me       aparência do próprio colaborador
 * - PUT  /api/avatar/me       { config, baseVersion } — salva (versão para gravação concorrente)
 * - PUT  /api/avatar/employees/:id  só aceita o próprio colaborador (ninguém edita o avatar de outra pessoa)
 */
import type { Router } from 'express';
import { AVATAR_CATALOG, AVATAR_CATALOG_VERSION } from '../../shared/avatarCatalog';
import { normalizeAraParams } from '../../shared/araCustom';
import { AraBusyError } from '../araGen';
import { ARA_CHARACTERS, AVATAR_STYLES, AVATAR_STYLE_LABEL, defaultForStyle, isAraCustom, isAvatarStyle, validateForStyle, type AnyAvatarConfig } from '../../shared/avatarAra';
import type { AppContext } from '../app';
import { currentUser, requireRole } from '../auth';
import { one } from '../db/driver';
import { HttpError, audit, correlationId, h } from '../http';

const GEN_COOLDOWN_MS = 4000;

export function liveRoutes(r: Router, ctx: AppContext) {
  const { db, live, cfg, ara } = ctx;
  const lastGen = new Map<string, number>(); // geração por pessoa: no máximo uma a cada poucos segundos
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

  // "ausente": a própria pessoa (ou o navegador, depois de um tempo sem uso) avisa; vale só para o colaborador da sessão
  r.post('/live/away', h(async (req, res) => {
    const user = currentUser(res);
    const away = (req.body as { away?: unknown })?.away;
    if (typeof away !== 'boolean') throw new HttpError(400, 'bad_request', 'away deve ser verdadeiro ou falso.');
    res.json({ person: await wrap(() => live.setAway(user, away)) });
  }));

  r.post('/live/speaking', h(async (req, res) => {
    const user = currentUser(res);
    if (cfg.callProvider !== 'demo') throw new HttpError(409, 'not_configured', 'O indicador de fala vem do sistema de telefonia.');
    const speaking = (req.body as { speaking?: unknown })?.speaking;
    if (typeof speaking !== 'boolean') throw new HttpError(400, 'bad_request', 'speaking deve ser verdadeiro ou falso.');
    res.json({ person: await wrap(() => live.speaking(user, speaking)) });
  }));

  // ---------- aparência ----------
  r.get('/avatar/catalog', h(async (_req, res) => {
    const user = currentUser(res);
    res.json({ version: AVATAR_CATALOG_VERSION, style: await live.effectiveStyle(user.companyId), ara: ARA_CHARACTERS, catalog: AVATAR_CATALOG });
  }));

  // ---------- estilo de avatar da empresa (opção do administrador) ----------
  const styleInfo = async (companyId: string) => ({ style: await live.avatarStyle(companyId), options: AVATAR_STYLES.map((id) => ({ id, label: AVATAR_STYLE_LABEL[id] })) });
  r.get('/admin/avatar-style', requireRole('admin'), h(async (_req, res) => res.json(await styleInfo(currentUser(res).companyId))));
  r.put('/admin/avatar-style', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    const style = (req.body as { style?: unknown })?.style;
    if (!isAvatarStyle(style)) throw new HttpError(400, 'bad_request', 'Estilo inválido. Use: ' + AVATAR_STYLES.join(', ') + '.');
    const before = await live.avatarStyle(user.companyId);
    if (before !== style) await live.setAvatarStyle(user.companyId, style, user.id);
    await audit(db, { user, action: 'avatar.style', targetType: 'company', targetId: user.companyId, result: 'completed', mode: 'real', detail: { from: before, to: style }, correlationId: correlationId(res) });
    res.json(await styleInfo(user.companyId));
  }));

  const loadMine = async (companyId: string, employeeId: string) => {
    const style = await live.effectiveStyle(companyId);
    const row = await one<{ config_json: string; version: number; updated_at: number }>(db, 'SELECT config_json, version, updated_at FROM avatar_choices WHERE employee_id = ? AND company_id = ? AND style = ?', [employeeId, companyId, style]);
    return row ? { style, config: JSON.parse(row.config_json) as AnyAvatarConfig, version: Number(row.version), updatedAt: Number(row.updated_at), saved: true } : { style, config: defaultForStyle(style, employeeId), version: 0, updatedAt: 0, saved: false };
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
    const style = await live.effectiveStyle(user.companyId);
    const errors = validateForStyle(style, config);
    if (errors.length) throw new HttpError(422, 'invalid_avatar', 'A configuração do avatar tem itens fora do catálogo do estilo ativo.', { details: errors });
    // personagem personalizado: o servidor normaliza os parâmetros e GERA o modelo 3D (nunca recebe modelo do cliente)
    let final = config as AnyAvatarConfig;
    if (isAraCustom(config)) {
      const { params } = normalizeAraParams(config.custom);
      // gerar é caro: no máximo um avatar novo a cada poucos segundos por pessoa (contado do fim da geração anterior)
      if (!ara.has(user.companyId, params) && Date.now() - (lastGen.get(user.id) ?? 0) < GEN_COOLDOWN_MS) throw new HttpError(429, 'too_many_requests', 'Aguarde alguns segundos antes de salvar outro avatar.');
      try {
        const { model } = await ara.ensure(user.companyId, params);
        lastGen.set(user.id, Date.now());
        final = { v: config.v, style: 'ara3d', custom: params, model, headsetAlways: config.headsetAlways };
      } catch (e) {
        if (e instanceof AraBusyError) throw new HttpError(503, 'busy', e.message);
        console.error('geração do avatar:', e);
        throw new HttpError(500, 'avatar_generation_failed', 'Não foi possível gerar o seu avatar agora. Tente de novo.');
      }
    }
    const json = JSON.stringify(final);
    const now = Date.now();
    const out = await db.tx(async (tx) => {
      const cur = await one<{ version: number }>(tx, 'SELECT version FROM avatar_choices WHERE employee_id = ? AND company_id = ? AND style = ?', [employeeId, user.companyId, style]);
      const curVersion = Number(cur?.version ?? 0);
      if (curVersion !== baseVersion) throw new HttpError(409, 'avatar_conflict', 'Seu avatar foi salvo em outra aba ou dispositivo. Recarregue para continuar.', { currentVersion: curVersion });
      if (cur) await tx.exec('UPDATE avatar_choices SET config_json = ?, catalog_version = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE employee_id = ? AND company_id = ? AND style = ? AND version = ?', [json, AVATAR_CATALOG_VERSION, user.id, now, employeeId, user.companyId, style, curVersion]);
      else await tx.exec('INSERT INTO avatar_choices (employee_id, style, company_id, config_json, catalog_version, version, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', [employeeId, style, user.companyId, json, AVATAR_CATALOG_VERSION, user.id, now]);
      return curVersion + 1;
    });
    await live.appearanceChanged(user.companyId, employeeId, final, out);
    await audit(db, { user, action: 'avatar.save', targetType: 'employee', targetId: employeeId, result: 'completed', mode: 'real', detail: { version: out }, correlationId: correlationId(resLocals) });
    return { version: out, style, config: final, updatedAt: now };
  };

  // modelo 3D de um personagem personalizado: conteúdo endereçado por hash, lido só pela empresa dona
  r.get('/avatar/model/:model/:file', h(async (req, res) => {
    const user = currentUser(res);
    const { model, file } = req.params;
    const lod = file === 'lod0.glb' ? 0 : file === 'lod1.glb' ? 1 : null;
    const path = lod === null || !/^[a-f0-9]{16}$/.test(model) ? null : ara.file(user.companyId, model, lod);
    if (!path) throw new HttpError(404, 'not_found', 'Modelo não encontrado.');
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.sendFile(path);
  }));

  r.put('/avatar/me', h(async (req, res) => {
    const user = currentUser(res);
    if (!user.employeeId) throw new HttpError(409, 'no_employee', 'Sua conta não está ligada a um colaborador do diretório.');
    res.json(await save(user.employeeId, req.body, res));
  }));
  r.put('/avatar/employees/:id', h(async (req, res) => res.json(await save(req.params.id, req.body, res))));
}
