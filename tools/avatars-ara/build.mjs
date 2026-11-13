/**
 * Gera os GLB brutos da galeria do estilo "Ara 3D Gen" (npm run avatars-ara:build).
 * Requer o clone do Ara 3D Gen em .build-tools/ara3d (git clone https://github.com/olatunde85/3d-gen.git; npm install;
 * npm run setup-assets), ver docs/avatars-ara.md. Saída: .build-tools/ara-raw/<id>.<detalhe>.glb
 * Uso: node tools/avatars-ara/build.mjs [id ...]
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ARA = path.join(ROOT, '.build-tools/ara3d');
const OUT = path.join(ROOT, '.build-tools/ara-raw');
if (!existsSync(path.join(ARA, 'public/assets'))) {
  console.error('Ara 3D Gen não instalado em .build-tools/ara3d (ver docs/avatars-ara.md).');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
// o script roda dentro do clone (usa os módulos src/core do Ara); a fonte da galeria continua versionada aqui
copyFileSync(path.join(ROOT, 'tools/avatars-ara/gallery.ts'), path.join(ARA, 'scripts/office3d-gallery.ts'));
writeFileSync(
  path.join(ARA, 'scripts/office3d-export.ts'),
  `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHuman } from '../src/core/human';
import { triangleCount } from '../src/core/mesh';
import { exportCharacter } from '../src/export';
import { nodeLibrary } from './node-assets';
import { GALLERY, paramsFor } from './office3d-gallery';
const out = process.argv[2];
const only = process.argv.slice(3);
mkdirSync(out, { recursive: true });
const lib = await nodeLibrary();
if (!only.length) writeFileSync(join(out, 'gallery.json'), JSON.stringify(GALLERY.map((e) => ({ id: e.id, name: e.name, gender: e.gender, style: e.style, params: paramsFor(e) })), null, 1));
for (const e of GALLERY) {
  if (only.length && !only.includes(e.id)) continue;
  for (const detail of ['medium', 'low'] as const) {
    const ch = await buildHuman(lib, paramsFor(e, detail));
    const f = await exportCharacter(lib, ch, 'glb');
    writeFileSync(join(out, e.id + '.' + detail + '.glb'), f.data);
    console.log(e.id, detail, (ch.height * 100).toFixed(0) + ' cm', triangleCount(ch.mesh) + ' tris', (f.data.length / 1048576).toFixed(1) + ' MB');
  }
}
`,
);
// sem shell: o caminho do projeto tem espaço ("Workscape 3D")
const tsx = path.join(ARA, 'node_modules/tsx/dist/cli.mjs');
const r = spawnSync(process.execPath, [tsx, 'scripts/office3d-export.ts', OUT, ...process.argv.slice(2)], { cwd: ARA, stdio: 'inherit' });
process.exit(r.status ?? 1);
