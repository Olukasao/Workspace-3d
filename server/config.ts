import { existsSync } from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

export interface Config {
  port: number;
  demoMode: boolean;
  dbDriver: 'sqlite' | 'mariadb';
  sqlitePath: string;
  mariadb: { host: string; port: number; user: string; password: string; database: string };
  sessionTtlHours: number;
  cookieSecure: boolean;
  dataDir: string;
  /** Provedores: 'demo' simula localmente; os demais dependem de ambiente real (ver docs/integrations.md). */
  chatProvider: 'demo' | 'workscape';
  transferProvider: 'demo' | 'workscape';
  remoteProvider: 'demo' | 'anydesk';
  printProvider: 'demo' | 'ipp' | 'none';
  /** Fonte do ciclo de atendimento/telefonia para os avatares: demo = controles manuais identificados. */
  callProvider: 'demo' | 'workscape';
  /** Tempos da presença ao vivo (ms): tolerância de desconexão, expiração de digitação/fala, chamada máxima, heartbeat SSE. */
  live: { graceMs: number; typingTtlMs: number; speakingTtlMs: number; callMaxMs: number; heartbeatMs: number };
  /** 'manual' mostra o endereço; 'uri' também devolve o link anydesk: (só após validação no ambiente gerenciado). */
  anydeskLaunch: 'manual' | 'uri';
  workscape: { baseUrl: string; token: string };
  /** Sinal "Workspace aberto" que o chat interno envia (segredo só no servidor). Vazio = recepção desligada. */
  workspacePresence: { token: string };
  /** Hosts https autorizados para painéis de TV e para links de CAD (Autodesk). */
  dashboardAllowedHosts: string[];
  cadAllowedHosts: string[];
  printMaxBytes: number;
  printRetentionMinutes: number;
  uploadMaxBytes: number;
}

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const oneOf = <T extends string>(v: string | undefined, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const envFile = path.join(ROOT, '.env');
  if (env === process.env && existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      /* .env ilegível: segue com o ambiente atual */
    }
  }
  const dataDir = path.resolve(ROOT, env.DATA_DIR ?? 'data');
  return {
    port: Number(env.PORT ?? 8787),
    demoMode: (env.DEMO_MODE ?? 'true') !== 'false',
    dbDriver: oneOf(env.DB_DRIVER, ['sqlite', 'mariadb'] as const, 'sqlite'),
    sqlitePath: env.SQLITE_PATH === ':memory:' ? ':memory:' : path.resolve(ROOT, env.SQLITE_PATH ?? path.join(dataDir, 'office3d.sqlite')),
    mariadb: { host: env.DB_HOST ?? '127.0.0.1', port: Number(env.DB_PORT ?? 3306), user: env.DB_USER ?? 'office3d', password: env.DB_PASSWORD ?? '', database: env.DB_NAME ?? 'office3d' },
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 12),
    cookieSecure: env.COOKIE_SECURE === 'true',
    dataDir,
    chatProvider: oneOf(env.CHAT_PROVIDER, ['demo', 'workscape'] as const, 'demo'),
    transferProvider: oneOf(env.TRANSFER_PROVIDER, ['demo', 'workscape'] as const, 'demo'),
    remoteProvider: oneOf(env.REMOTE_PROVIDER, ['demo', 'anydesk'] as const, 'demo'),
    printProvider: oneOf(env.PRINT_PROVIDER, ['demo', 'ipp', 'none'] as const, 'demo'),
    callProvider: oneOf(env.CALL_PROVIDER, ['demo', 'workscape'] as const, 'demo'),
    live: {
      graceMs: Number(env.PRESENCE_GRACE_MS ?? 15000),
      typingTtlMs: Number(env.TYPING_TTL_MS ?? 6000),
      speakingTtlMs: Number(env.SPEAKING_TTL_MS ?? 5000),
      callMaxMs: Number(env.CALL_MAX_MS ?? 4 * 3600_000),
      heartbeatMs: Number(env.LIVE_HEARTBEAT_MS ?? 20000),
    },
    anydeskLaunch: oneOf(env.ANYDESK_LAUNCH, ['manual', 'uri'] as const, 'manual'),
    workscape: { baseUrl: env.WORKSCAPE_BASE_URL ?? '', token: env.WORKSCAPE_TOKEN ?? '' },
    workspacePresence: { token: env.WORKSPACE_PRESENCE_TOKEN ?? '' },
    dashboardAllowedHosts: list(env.DASHBOARD_ALLOWED_HOSTS),
    cadAllowedHosts: list(env.CAD_ALLOWED_HOSTS),
    printMaxBytes: Number(env.PRINT_MAX_MB ?? 10) * 1024 * 1024,
    printRetentionMinutes: Number(env.PRINT_RETENTION_MINUTES ?? 30),
    uploadMaxBytes: Number(env.UPLOAD_MAX_MB ?? 8) * 1024 * 1024,
  };
}
