/**
 * Roda tools/avatars/build.py no Blender portátil (modo sem interface) com o MPFB2 instalado.
 * Uso: npm run avatars:build [-- male|female]
 * Requer .build-tools/blender-4.2.9-windows-x64 (ou BLENDER=<caminho do executável>) com o MPFB 2.0.x e os pacotes
 * de recursos do MakeHuman instalados — ver docs/avatars.md. Saída: .build-tools/avatars-raw (depois: npm run avatars:process).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const blender = process.env.BLENDER ?? path.join(ROOT, '.build-tools/blender-4.2.9-windows-x64/blender.exe');
if (!existsSync(blender)) {
  console.error(`Blender não encontrado em ${blender}. Instale o Blender 4.2 portátil em .build-tools/ ou defina BLENDER. Ver docs/avatars.md.`);
  process.exit(1);
}
const args = ['-b', '-P', path.join(ROOT, 'tools/avatars/build.py'), '--', path.join(ROOT, 'tools/avatars/sources.json'), path.join(ROOT, '.build-tools/avatars-raw'), ...process.argv.slice(2)];
const r = spawnSync(blender, args, { stdio: 'inherit', cwd: ROOT });
process.exit(r.status ?? 1);
