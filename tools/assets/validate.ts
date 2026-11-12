/**
 * Valida todos os GLB distribuídos com o glTF Validator oficial (Khronos) e confere o manifesto:
 * arquivo existe, hash bate, licença/autor/fonte preenchidos e miniatura presente.
 * Grava public/assets/validation.json. Uso: npm run assets:validate
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error pacote sem tipos
import validator from 'gltf-validator';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'public/assets');

interface Model { slug: string; file: string; sha256: string; license: string; author: string; sourceUrl: string; origin: string; thumb: string }
const manifest = JSON.parse(readFileSync(path.join(OUT, 'manifest.json'), 'utf8')) as { models: Model[]; textures: Array<{ slug: string; file: string; sha256: string }> };
const rows: Array<Record<string, unknown>> = [];
let problems = 0;
for (const m of manifest.models) {
  const file = path.join(OUT, m.file);
  const issues: string[] = [];
  if (!existsSync(file)) issues.push('arquivo ausente');
  else {
    const bytes = new Uint8Array(readFileSync(file));
    if (createHash('sha256').update(bytes).digest('hex') !== m.sha256) issues.push('hash diferente do manifesto');
    const report = (await validator.validateBytes(bytes, { maxIssues: 50 })) as { issues: { numErrors: number; numWarnings: number; messages: Array<{ code: string; message: string; severity: number }> } };
    const errs = report.issues.messages.filter((x) => x.severity === 0);
    if (errs.length) issues.push(...errs.slice(0, 3).map((e) => `glTF: ${e.code}`));
    rows.push({ slug: m.slug, errors: report.issues.numErrors, warnings: report.issues.numWarnings, warningCodes: [...new Set(report.issues.messages.filter((x) => x.severity === 1).map((x) => x.code))] });
  }
  if (!m.license || !m.author) issues.push('licença ou autor ausente');
  if (m.origin === 'download' && !/^https:\/\//.test(m.sourceUrl)) issues.push('URL de origem ausente');
  if (!existsSync(path.join(ROOT, 'public', m.thumb))) issues.push('miniatura ausente');
  if (issues.length) {
    problems++;
    console.log(`PROBLEMA ${m.slug}: ${issues.join('; ')}`);
  }
}
for (const t of manifest.textures) {
  const file = path.join(OUT, t.file);
  if (!existsSync(file) || createHash('sha256').update(readFileSync(file)).digest('hex') !== t.sha256) {
    problems++;
    console.log(`PROBLEMA textura ${t.slug}: arquivo ausente ou hash diferente`);
  }
}
const errors = rows.reduce((s, r) => s + (r.errors as number), 0);
const warnings = rows.reduce((s, r) => s + (r.warnings as number), 0);
writeFileSync(path.join(OUT, 'validation.json'), JSON.stringify({ validator: `gltf-validator ${validator.version()}`, checkedAt: new Date().toISOString(), models: rows.length, errors, warnings, problems, results: rows }, null, 2));
console.log(`glTF Validator ${validator.version()}: ${rows.length} modelos, ${errors} erros, ${warnings} avisos. Manifesto: ${problems} problema(s).`);
if (errors || problems) process.exitCode = 1;
