/** Gera os pedidos da folha de clipping (poses principais) para os looks informados. Uso: tsx tools/avatars/clipping-requests.ts m-casual,f-corp saida.json */
import { writeFileSync } from 'node:fs';
import { LOOKS, defaultAvatar } from '../../shared/avatarCatalog';

const ids = process.argv[2].split(',');
const out: unknown[] = [];
for (const id of ids) {
  const l = LOOKS.find((x) => x.id === id)!;
  const config = { ...defaultAvatar('sheet-' + id), ...l.config, base: l.base };
  const poses = [
    { label: `${id} digitando 3/4`, mode: 'sit', activity: 'typing', view: 'three', zoom: 'full' },
    { label: `${id} digitando mãos`, mode: 'sit', activity: 'typing', view: 'three', zoom: 'hands' },
    { label: `${id} atendimento falando`, mode: 'sit', activity: 'call', speaking: true, view: 'three', zoom: 'upper', t: 2.1 },
    { label: `${id} sentado pernas`, mode: 'sit', activity: 'idle', view: 'side', zoom: 'legs' },
    { label: `${id} sentado costas`, mode: 'sit', activity: 'typing', view: 'back', zoom: 'full' },
    { label: `${id} em pé`, mode: 'stand', activity: 'idle', view: 'front', zoom: 'full' },
  ];
  for (const p of poses) out.push({ ...p, config });
}
writeFileSync(process.argv[3], JSON.stringify(out));
