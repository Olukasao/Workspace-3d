import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { ROOT, type Config } from './config';
import type { Db } from './db/driver';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './db/seed';
import { SESSION_COOKIE, currentUser, login, logout, readCookie, requireAuth, sessionCookie } from './auth';
import { HttpError, correlation, errorHandler, h, requireAppHeader } from './http';
import { AraGenerator } from './araGen';
import { Office2D } from './office2d';
import { DemoCallSource, LiveHub } from './live';
import { Integrations } from './providers';
import { ProviderNotConfigured, ProviderUnavailable } from './providers/types';
import { actionRoutes } from './routes/actions';
import { adminRoutes } from './routes/admin';
import { assetRoutes } from './routes/assets';
import { liveRoutes } from './routes/live';
import { officeRoutes } from './routes/office';
import { workspaceRoutes } from './routes/workspace';

export interface AppContext {
  cfg: Config;
  db: Db;
  integrations: Integrations;
  /** Presença ao vivo (avatares): conexões, digitação, atendimento. */
  live: LiveHub;
  /** Gera (em thread própria) e guarda os modelos 3D dos personagens personalizados do estilo Ara 3D Gen. */
  ara: AraGenerator;
  /** Escritório 2D: layout, estações e posição de cada pessoa (autoridade do servidor). */
  office2d: Office2D;
  /** Apaga do disco os documentos de impressão vencidos (retenção). */
  purgePrintFiles?: () => Promise<number>;
}

export function createApp(cfg: Config, db: Db): { app: Express; ctx: AppContext } {
  const live = new LiveHub(db, cfg.live, new DemoCallSource(), cfg.demoMode);
  const office2d = new Office2D(db, live);
  live.attach2d(office2d);
  const ctx: AppContext = { cfg, db, integrations: new Integrations(cfg, db), live, office2d, ara: new AraGenerator(path.join(ROOT, 'public/assets/ara-data'), path.join(cfg.dataDir, 'avatar-models')) };
  office2d.start();
  ctx.live.start();
  const app = express();
  app.disable('x-powered-by');
  app.use(correlation);
  app.use((_req, res, next) => {
    const frames = ["'self'", 'blob:', ...cfg.dashboardAllowedHosts.map((host) => `https://${host}`)].join(' ');
    // nenhum recurso externo: scripts, modelos, texturas e fontes vêm só do próprio servidor
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob: data:; worker-src 'self' blob:; frame-src ${frames}; object-src 'none'; base-uri 'self'; frame-ancestors 'self'`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  const api = express.Router();
  api.use(requireAppHeader);
  api.use(express.json({ limit: '3mb' }));

  api.get('/health', (_req, res) => res.json({ ok: true, demoMode: cfg.demoMode, db: db.dialect }));

  // ---- autenticação ----
  const attempts = new Map<string, { n: number; reset: number }>();
  api.post('/auth/login', h(async (req, res) => {
    const ip = req.ip ?? 'local';
    const now = Date.now();
    const a = attempts.get(ip);
    if (a && a.reset > now && a.n >= 10) throw new HttpError(429, 'too_many_attempts', 'Muitas tentativas. Aguarde um minuto e tente de novo.');
    const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 190 || password.length > 200) throw new HttpError(400, 'bad_request', 'Informe e-mail e senha.');
    const out = await login(db, cfg, email, password);
    if (!out) {
      attempts.set(ip, a && a.reset > now ? { n: a.n + 1, reset: a.reset } : { n: 1, reset: now + 60_000 });
      throw new HttpError(401, 'invalid_credentials', 'E-mail ou senha incorretos.');
    }
    attempts.delete(ip);
    res.setHeader('Set-Cookie', sessionCookie(cfg, out.token, out.maxAgeMs));
    res.json({ user: out.user });
  }));
  api.post('/auth/logout', h(async (req, res) => {
    await logout(db, readCookie(req, SESSION_COOKIE));
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.json({ ok: true });
  }));
  // contas fictícias mostradas na tela de entrada — só existem no modo demonstração
  api.get('/demo/accounts', (_req, res) => {
    if (!cfg.demoMode) return res.json({ demoMode: false, accounts: [] });
    res.json({ demoMode: true, password: DEMO_PASSWORD, accounts: DEMO_ACCOUNTS.map((a) => ({ email: a.email, label: a.label, name: a.name, role: a.role })) });
  });

  const authed = express.Router();
  authed.use(requireAuth(db));
  authed.get('/auth/me', (_req, res) => res.json({ user: currentUser(res), demoMode: cfg.demoMode }));
  officeRoutes(authed, ctx);
  assetRoutes(authed, ctx);
  adminRoutes(authed, ctx);
  ctx.purgePrintFiles = actionRoutes(authed, ctx).purgeExpiredPrintFiles;
  liveRoutes(authed, ctx);
  workspaceRoutes(authed, ctx);
  api.use(authed);
  api.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Rota não encontrada.')));

  // erros dos conectores viram respostas com estado explícito
  api.use((err: unknown, _req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (err instanceof ProviderUnavailable) return next(new HttpError(503, 'provider_unavailable', err.message, { service: err.service }));
    if (err instanceof ProviderNotConfigured) return next(new HttpError(409, 'not_configured', err.message, { service: err.service }));
    next(err);
  });
  app.use('/api', api);

  // ---- arquivos estáticos: assets aprovados (local) e o aplicativo compilado ----
  app.use('/assets', express.static(path.join(ROOT, 'public/assets'), { maxAge: '1h', fallthrough: true }));
  app.use('/demo', express.static(path.join(ROOT, 'public/demo'), { fallthrough: true }));
  const dist = path.join(ROOT, 'dist');
  if (existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // arquivos ausentes em /assets e /demo respondem 404 (o cliente mostra o substituto visual), não a página do aplicativo
    app.get('*', (req, res, next) => (/^\/(api|assets|demo)\//.test(req.path) ? next() : res.sendFile(path.join(dist, 'index.html'))));
  }
  app.use((req, res, next) => (res.headersSent ? next() : res.status(404).json({ error: 'not_found', message: `Não encontrado: ${req.path}` })));
  app.use(errorHandler);
  return { app, ctx };
}
