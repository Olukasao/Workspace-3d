/**
 * Geração dos modelos 3D dos personagens personalizados (estilo Ara 3D Gen).
 *  - o cliente só envia PARÂMETROS (validados em shared/araCustom.ts); o modelo é sempre gerado aqui, nunca recebido do cliente;
 *  - o identificador do modelo é o SHA-256 dos parâmetros normalizados (conteúdo endereçado: o mesmo personagem não é gerado duas vezes);
 *  - arquivos em <DATA_DIR>/avatar-models/<empresa>/<modelo>/lod0.glb e lod1.glb: uma empresa nunca lê o modelo de outra;
 *  - a geração roda numa thread própria (server/araWorker.ts), uma por vez, com tempo limite; a thread é encerrada quando fica ociosa.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { AraParams } from '../shared/araCustom';
import type { GenReply } from './araWorker';

const WORKER_FILE = fileURLToPath(new URL('./araWorker.ts', import.meta.url));
const GEN_TIMEOUT_MS = 90_000;
const IDLE_MS = 60_000;
const MAX_QUEUE = 12;

/** JSON canônico (chaves em ordem) para o hash não depender da ordem dos campos. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const modelId = (params: AraParams) => createHash('sha256').update(canonicalJson(params)).digest('hex').slice(0, 16);

export class AraBusyError extends Error {}

export class AraGenerator {
  private worker: Worker | null = null;
  private seq = 0;
  private queued = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private inflight = new Map<string, Promise<{ model: string; height: number | null }>>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private waiting = new Map<number, { resolve: (r: GenReply & { ok: true }) => void; reject: (e: Error) => void }>();

  constructor(
    private assetsDir: string,
    private modelsDir: string,
  ) {}

  dir(companyId: string, model: string) {
    return path.join(this.modelsDir, companyId, model);
  }

  /** Caminho do arquivo do modelo (ou null se não existir). `model` e `lod` precisam ter sido validados por quem chama. */
  file(companyId: string, model: string, lod: 0 | 1): string | null {
    const f = path.join(this.dir(companyId, model), `lod${lod}.glb`);
    return existsSync(f) ? f : null;
  }

  has(companyId: string, params: AraParams) {
    const model = modelId(params);
    return !!this.file(companyId, model, 0) && !!this.file(companyId, model, 1);
  }

  /** Garante que o modelo dos parâmetros existe em disco (gera se faltar). Chamadas iguais e simultâneas dividem a mesma geração. */
  ensure(companyId: string, params: AraParams): Promise<{ model: string; height: number | null }> {
    const model = modelId(params);
    if (this.file(companyId, model, 0) && this.file(companyId, model, 1)) return Promise.resolve({ model, height: null });
    const key = `${companyId}:${model}`;
    const running = this.inflight.get(key);
    if (running) return running;
    if (this.queued >= MAX_QUEUE) return Promise.reject(new AraBusyError('Muitos avatares sendo gerados agora. Tente de novo em instantes.'));
    this.queued++;
    const job = this.chain
      .then(() => this.generate(params))
      .then((r) => {
        const dir = this.dir(companyId, model);
        mkdirSync(dir, { recursive: true });
        // grava em arquivo temporário e renomeia: quem lê nunca vê um GLB pela metade
        for (const [name, bytes] of [['lod0.glb', r.lod0], ['lod1.glb', r.lod1]] as const) {
          const tmp = path.join(dir, `${name}.${process.pid}.tmp`);
          writeFileSync(tmp, bytes);
          renameSync(tmp, path.join(dir, name));
        }
        return { model, height: r.height };
      })
      .finally(() => {
        this.queued--;
        this.inflight.delete(key);
      });
    this.chain = job.catch(() => undefined);
    this.inflight.set(key, job);
    return job;
  }

  private spawn(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(WORKER_FILE, { workerData: { assets: this.assetsDir }, execArgv: ['--import', 'tsx'] });
    w.unref(); // não segura o processo aberto (testes e desligamento)
    w.on('message', (m: GenReply) => {
      const p = this.waiting.get(m.id);
      if (!p) return;
      this.waiting.delete(m.id);
      if (m.ok) p.resolve(m);
      else p.reject(new Error(m.error));
    });
    const fail = (e: Error) => {
      for (const p of this.waiting.values()) p.reject(e);
      this.waiting.clear();
      if (this.worker === w) this.worker = null;
    };
    w.on('error', fail);
    w.on('exit', (code) => fail(new Error(`Gerador de avatares encerrou (código ${code}).`)));
    this.worker = w;
    return w;
  }

  private generate(params: AraParams): Promise<GenReply & { ok: true }> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const id = ++this.seq;
    const w = this.spawn();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        void this.worker?.terminate(); // trava: descarta a thread (a próxima geração cria outra)
        this.worker = null;
        reject(new Error('A geração do avatar demorou demais.'));
      }, GEN_TIMEOUT_MS);
      timer.unref?.();
      this.waiting.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      w.postMessage({ id, params });
    }).finally(() => {
      this.idleTimer = setTimeout(() => this.close(), IDLE_MS);
      this.idleTimer.unref?.();
    }) as Promise<GenReply & { ok: true }>;
  }

  close() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    void this.worker?.terminate();
    this.worker = null;
  }
}
