/** Gera docs/assets.md a partir do manifesto e da validação. Uso: npx tsx tools/assets/report.ts */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const m = JSON.parse(readFileSync(path.join(ROOT, 'public/assets/manifest.json'), 'utf8'));
const v = existsSync(path.join(ROOT, 'public/assets/validation.json')) ? JSON.parse(readFileSync(path.join(ROOT, 'public/assets/validation.json'), 'utf8')) : null;
type Model = { slug: string; name: string; category: string; file: string; originalTitle: string; author: string; license: string; sourceUrl: string; origin: string; bytes: number; triangles: number; dimensions: { width: number; depth: number; height: number }; original: { format: string }; changes: string[]; consultedAt: string; sha256: string };
const models = m.models as Model[];
const kb = (b: number) => `${(b / 1024).toFixed(0)} KB`;
const via = (u: string) => (u.includes('poly.pizza') ? 'Poly Pizza' : u.includes('opengameart') ? 'OpenGameArt (Kenney)' : u.includes('polyhaven') ? 'Poly Haven' : u.includes('ambientcg') ? 'ambientCG' : '—');
const dl = models.filter((x) => x.origin === 'download');
const proc = models.filter((x) => x.origin === 'procedural');
const conv = dl.filter((x) => !x.original.format.startsWith('glb'));
const total = models.reduce((s, x) => s + x.bytes, 0) + m.textures.reduce((s: number, t: { bytes: number }) => s + t.bytes, 0);
const byLicense = models.reduce<Record<string, number>>((acc, x) => ((acc[x.license] = (acc[x.license] ?? 0) + 1), acc), {});

const coverage: Array<[string, string]> = [
  ['Paredes, portas, vidro, divisórias, pisos', 'Paramétricos no editor (sala com 4 paredes, parede avulsa, porta, porta de vidro, janela, divisória de vidro) + texturas de piso ambientCG + divisória baixa original'],
  ['Mesas retas e de reunião', 'mesa-reta, mesa-reuniao (originais), mesa-madeira, mesa-redonda, kn-mesa, kn-mesa-canto'],
  ['Cadeiras', 'cadeira-escritorio, cadeira-executiva, kn-cadeira, kn-poltrona'],
  ['Bancada de recepção', 'bancada-recepcao (original)'],
  ['Sofá', 'sofa-recepcao'],
  ['Gaveteiro, armário, prateleira', 'gaveteiro, armario-baixo, estante-baixa, estante-livros, kn-estante-aberta, kn-criado-gavetas'],
  ['Monitor, desktop, notebook, teclado, mouse, telefone', 'monitor, desktop-torre, notebook, teclado, mouse, telefone'],
  ['Impressora/copiadora', 'copiadora (Office Printer / Copier, Bruno Oliveira — prioridade do briefing), impressora-mesa'],
  ['TV plana e rack', 'tv-parede, tv-pedestal, tv-painel (original), rack-servidor'],
  ['Vasos, luminárias, lixeira', 'planta-vaso-vermelho, planta-folhagem, ph-planta, luminaria-piso, luminaria-mesa, kn-luminaria, lixeira'],
  ['Quadros, relógio, livros, caixas, placas', 'quadro-arte, quadro-branco, porta-retrato, relogio-parede, livros, caixas, caixa-organizadora (original), placa-saida, placa-sala (original)'],
];

const lines: string[] = [
  '# Assets: pesquisa, aquisição e curadoria',
  '',
  `Gerado por \`npx tsx tools/assets/report.ts\` em ${new Date().toISOString().slice(0, 10)}. A fonte de verdade é \`public/assets/manifest.json\` (um registro por asset: autor, URL de origem, licença, atribuição, data de consulta, versão, hash, alterações, dimensões e arquivo distribuído). Os avisos de licença distribuídos com o produto estão em \`public/assets/CREDITS.md\` e na tela **Créditos**.`,
  '',
  '## Resumo',
  '',
  `- **${models.length} modelos** no catálogo: ${dl.length} baixados das fontes oficiais (${conv.length} deles convertidos de OBJ ou glTF para GLB) e ${proc.length} de geometria original simples.`,
  `- **${m.textures.length} texturas** CC0 (ambientCG).`,
  `- Licenças: ${Object.entries(byLicense).map(([k, n]) => `${k}: ${n}`).join(' · ')}.`,
  `- Peso total distribuído: **${(total / 1048576).toFixed(2)} MB** (modelos + texturas; miniaturas à parte).`,
  v ? `- glTF Validator (${v.validator}): **${v.errors} erros**, ${v.warnings} avisos em ${v.models} modelos (avisos: espaço tangente gerado na planta do Poly Haven, sem efeito visual).` : '- glTF Validator: não executado.',
  '- Licença conferida **modelo a modelo**: o título, o autor e a licença foram lidos da própria página de cada item no momento do download (`tools/assets/fetch.ts`). Licença não prevista interrompe o processo.',
  '- "Gratuito" não foi tomado como licença comercial: só entraram CC0 1.0 e CC-BY 3.0, que permitem uso comercial com as atribuições registradas.',
  '',
  '## Pipeline',
  '',
  '1. `npm run assets:fetch`: baixa só os itens curados em `tools/assets/sources.json`. Do Kenney, extrai do zip oficial apenas os 10 arquivos usados, sem baixar coleções inteiras. Grava os originais em `assets-src/originals/` (fora do git) e a proveniência em `assets-src/provenance.json`.',
  '2. Itens sem modelo compatível são gerados por código (`tools/assets/procedural.ts`) dentro da etapa seguinte.',
  '3. `npm run assets:process`: GLB autocontido, metros, Y para cima, frente em +Z e pivô no centro da base (ou centro da face traseira, para parede). Depois solda vértices, simplifica malhas acima de 12 mil triângulos, remove dados não usados, converte texturas para WebP de até 512 px e deduplica pelo hash do arquivo final. Medidas e altura do tampo vão para o manifesto.',
  '4. `npm run assets:validate`: glTF Validator (Khronos) em todos os GLB, mais conferência de hash, licença, autor, fonte e miniatura.',
  '5. `npm run assets:thumbs`: miniaturas próprias, renderizadas num navegador real a partir do GLB distribuído. `-- --debug` gera folhas de contato com eixos para conferir orientação e escala.',
  '',
  '**Deduplicação:** o arquivo é guardado uma vez por hash SHA-256. O cadastro (`AssetDefinition`) é separado. O mesmo arquivo enviado com outra licença ou outro autor vira **outro cadastro** que reaproveita o arquivo, e os metadados nunca se misturam (coberto por teste).',
  '',
  '**Upload do administrador** (`POST /api/assets/upload`):',
  '',
  '- O tipo é checado pela assinatura glTF binária, não pela extensão. Limites: 8 MB, 150 mil triângulos e texturas de até 2048 px.',
  '- Buffers ou imagens externos (por URI) são **recusados**, assim como extensões obrigatórias desconhecidas.',
  '- O arquivo enviado é normalizado (pivô) e servido só para a própria empresa.',
  '',
  '**Entrega:**',
  '',
  '- **Assets servidos localmente:** `/assets/...` pelo próprio servidor, e a CSP bloqueia recursos externos.',
  '- **Carregamento sob demanda:** cada GLB é baixado quando a primeira instância aparece, com cache e contagem de referências.',
  '- **Compartilhamento:** geometria e material são compartilhados entre instâncias (`clone`).',
  '- **Instanciamento:** no modo operacional, objetos repetidos (4 ou mais) e não acionáveis viram `InstancedMesh`.',
  '- **Falha de carregamento:** a cena mostra uma caixa âmbar com as medidas do asset no lugar do modelo.',
  '',
  '## Cobertura pedida no briefing',
  '',
  '| Item | Assets |',
  '|---|---|',
  ...coverage.map(([a, b]) => `| ${a} | ${b} |`),
  '',
  '## Modelos distribuídos',
  '',
  '| Arquivo | Nome no produto | Original | Autor | Licença | Via | Formato original | Medidas (m) | Triângulos | Peso |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...models.map((x) => `| \`${x.file}\` | ${x.name} | ${x.sourceUrl ? `[${x.originalTitle}](${x.sourceUrl})` : x.originalTitle} | ${x.author} | ${x.license} | ${x.origin === 'procedural' ? 'geometria original' : via(x.sourceUrl)} | ${x.original.format} | ${x.dimensions.width} × ${x.dimensions.depth} × ${x.dimensions.height} | ${x.triangles} | ${kb(x.bytes)} |`),
  '',
  '## Texturas',
  '',
  '| Arquivo | Nome | Original | Licença | Alterações |',
  '|---|---|---|---|---|',
  ...m.textures.map((t: { file: string; name: string; originalTitle: string; sourceUrl: string; license: string; changes: string[] }) => `| \`${t.file}\` | ${t.name} | [${t.originalTitle}](${t.sourceUrl}) | ${t.license} | ${t.changes.join('; ')} |`),
  '',
  '## Rejeitados',
  '',
  '| Item | Licença | Motivo |',
  '|---|---|---|',
  ...m.rejected.map((r: { name: string; url: string; license: string; reason: string }) => `| [${r.name}](${r.url}) | ${r.license} | ${r.reason} |`),
  '',
  '## Pendentes',
  '',
  '| Item | Motivo |',
  '|---|---|',
  ...m.pending.map((r: { name: string; url: string; reason: string }) => `| [${r.name}](${r.url}) | ${r.reason} |`),
  '',
  '## Observações de curadoria',
  '',
  '- **dook Office Pack** (Poly Pizza): os modelos "Desk" do próprio dook são **conjuntos fundidos** (mesa + cadeira + computador num só modelo). Não servem como peças modulares nem para o computador acompanhar a mesa por parentesco, então ficaram como referência de estilo. Do pack foram usadas peças avulsas: telefone (dook), copiadora, gaveteiro, bebedouro, placa de saída, quadro, livros, plantas, cadeiras e outras, cada uma com a licença da própria página.',
  '- **Monitor CRT** indicado como referência: substituído por um monitor moderno genérico (CreativeTrio, CC0). As TVs planas vieram separadas (Alex Safayan e J-Toastie, CC-BY 3.0), mais uma TV de painel original.',
  '- **Orientação e escala** conferidas visualmente nas folhas de contato. Cinco modelos foram girados para a frente ficar em +Z e um porta-retrato foi reclassificado de parede para superfície.',
  '- **Defeito encontrado pelo glTF Validator e corrigido:** o conversor OBJ gerava normais nulas em triângulos degenerados do kit Kenney (113 erros em 8 modelos, antes da correção).',
];
writeFileSync(path.join(ROOT, 'docs/assets.md'), lines.join('\n') + '\n');
console.log('docs/assets.md gerado');
