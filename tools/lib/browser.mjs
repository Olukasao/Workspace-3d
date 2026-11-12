/** Utilidades das ferramentas que dirigem um navegador real (miniaturas, e2e, medição). Usa o Chrome/Edge do sistema. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright-core';

export const ROOT = path.resolve(import.meta.dirname, '../..');

export async function launchBrowser({ gpu = false, headless = true } = {}) {
  const args = gpu ? ['--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless, args });
    } catch {
      /* tenta o próximo canal */
    }
  }
  throw new Error('Chrome ou Edge não encontrado neste computador.');
}

export async function waitForHttp(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Sem resposta de ${url}`);
}

/** Sobe um processo Node do projeto (Vite ou API) e devolve a função que o encerra. */
export function startNode(args, env = {}, { quiet = true } = {}) {
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: quiet ? 'ignore' : 'inherit', env: { ...process.env, ...env } });
  const stop = () => {
    if (!child.killed) child.kill();
  };
  process.on('exit', stop);
  return { child, stop };
}

export const viteBin = path.join(ROOT, 'node_modules/vite/bin/vite.js');
export const tsxBin = path.join(ROOT, 'node_modules/tsx/dist/cli.mjs');
