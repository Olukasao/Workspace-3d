/**
 * Pós-processa o build estático (dist-static): reaponta os caminhos absolutos (/assets, /demo) para a subpasta onde o app
 * é hospedado e remove o que a demonstração não usa (dados do gerador de personagens e o estilo MakeHuman).
 * Uso: node tools/static-demo/finalize.mjs <dist-static> <base, ex.: /apps/workspace-3d>
 */
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [dir, baseArg = '/apps/workspace-3d'] = process.argv.slice(2);
const base = baseArg.replace(/\/$/, '');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
let n = 0;
for (const f of walk(dir)) {
  if (!/\.(js|css|html|json)$/.test(f) || /[\/]assets[\/]/.test(f.replace(dir, ''))) continue;
  const s = readFileSync(f, 'utf8');
  const o = s.replace(/(["'`(])\/(assets|demo)\//g, `$1${base}/$2/`).replace(/(["'`(])\/favicon\.svg/g, `$1${base}/favicon.svg`);
  if (o !== s) { writeFileSync(f, o); n++; }
}
for (const p of ['assets/ara-data', 'assets/avatars']) rmSync(path.join(dir, p), { recursive: true, force: true });
console.log(`reapontados ${n} arquivos para ${base}`);
