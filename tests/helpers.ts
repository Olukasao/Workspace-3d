import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, type AppContext } from '../server/app';
import { loadConfig } from '../server/config';
import { openDb } from '../server/db/driver';
import { migrate } from '../server/db/migrate';
import { DEMO_PASSWORD, seed } from '../server/db/seed';

export interface TestServer {
  url: string;
  ctx: AppContext;
  close(): Promise<void>;
}

/** Sobe o servidor real em uma porta livre, com banco SQLite em memória e dados de demonstração. */
export async function startServer(env: Record<string, string> = {}): Promise<TestServer> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'office3d-test-'));
  const cfg = loadConfig({ SQLITE_PATH: ':memory:', DATA_DIR: dataDir, DEMO_MODE: 'true', ...env });
  const db = await openDb(cfg);
  await migrate(db);
  await seed(db);
  const { app, ctx } = createApp(cfg, db);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    ctx,
    async close() {
      await new Promise((r) => server.close(r));
      await db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export interface Reply<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Headers;
}

/** Cliente com sessão própria (cada instância equivale a um navegador diferente). */
export class Client {
  cookie = '';
  constructor(private base: string) {}

  async request<T = Record<string, unknown>>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply<T>> {
    const raw = body instanceof Uint8Array;
    const res = await fetch(this.base + url, {
      method,
      headers: { 'X-Requested-With': 'office3d', ...(this.cookie ? { Cookie: this.cookie } : {}), ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : raw ? (body as unknown as BodyInit) : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }
  get<T = Record<string, unknown>>(url: string) {
    return this.request<T>('GET', url);
  }
  post<T = Record<string, unknown>>(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>('POST', url, body ?? {}, headers);
  }
  put<T = Record<string, unknown>>(url: string, body?: unknown) {
    return this.request<T>('PUT', url, body ?? {});
  }
  patch<T = Record<string, unknown>>(url: string, body?: unknown) {
    return this.request<T>('PATCH', url, body ?? {});
  }
  async login(email: string): Promise<this> {
    const r = await this.post('/api/auth/login', { email, password: DEMO_PASSWORD });
    if (r.status !== 200) throw new Error(`login falhou: ${r.status}`);
    return this;
  }
}

export const ADMIN = 'admin@demo.office3d.local';
export const OPERATOR = 'operador@demo.office3d.local';
export const VIEWER = 'visualizador@demo.office3d.local';
export const OTHER_ADMIN = 'admin@outra.office3d.local';
export const OFFICE = 'off_sede_1';

/** PDF mínimo válido o bastante para a checagem de assinatura. */
export const tinyPdf = (label = 'a') => new TextEncoder().encode(`%PDF-1.4\n% documento de teste ${label}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);

let n = 0;
export const key = () => `test-key-${Date.now()}-${n++}`;
