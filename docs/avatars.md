# Avatares

Cada colaborador tem um avatar 3D, personalizado por ele mesmo, sentado na cadeira da mesa vinculada a ele e animado pelo estado de presença ao vivo. Este documento cobre catálogo, persistência, pipeline de assets, licenças, animação, desempenho e lacunas. As regras de presença e os sinais estão em [integrations.md](integrations.md#presença-ao-vivo-e-avatares).

## O que a pessoa vê

- **Meu avatar** (clique no próprio nome, no topo): pré-visualização 3D girando, com vistas em pé e sentado e botões para conferir as poses de trabalho, digitação e atendimento. Corpo masculino ou feminino, 5 tons de pele, 4 rostos, cabelo e cor, barba (corpo masculino), parte de cima, parte de baixo e sapatos com cor, óculos. O headset entra sozinho durante o atendimento; dá para deixá-lo sempre visível.
- **Looks prontos:** 2 casuais e 2 corporativos para cada corpo. Trocar de corpo preserva o que é compatível (cabelo, óculos, sapatos e cores) e troca o resto pela peça padrão do slot.
- **Salvar / Cancelar:** nada sai da pré-visualização antes de salvar. Ao salvar, quem está com o escritório aberto vê a nova aparência na hora, sem recarregar, inclusive se a pessoa estiver em atendimento.
- **No escritório:** o avatar aparece quando a pessoa está online e ocupa a cadeira da **mesa vinculada** (posição fixa da mesa, ver [README](../README.md)). Pessoa online sem mesa aparece na lista "Online sem mesa" do painel. Pessoa offline: a mesa continua visível e atribuída, sem avatar.

| Estado (prioridade) | Pose | Extras |
|---|---|---|
| Offline | sem avatar | — |
| Em atendimento | sentado, mão esquerda gesticulando, cabeça acompanhando | headset; balão "Em atendimento", que vira "•••" enquanto o indicador de fala estiver ativo |
| Digitando | as duas mãos no teclado, dedos batendo, olhar no monitor | — |
| Online | mão esquerda no teclado, direita no mouse, respiração e pequenos movimentos | — |

## Persistência e autorização

- Tabela `avatar_profiles` (migração `002_avatars.sql`): `employee_id`, `company_id`, `config_json`, `catalog_version`, `version`, `updated_by`, `updated_at`.
- A configuração guarda **IDs do catálogo** e **IDs de cor da paleta**, nunca caminhos de arquivo nem cores livres. O servidor valida tudo (`validateAvatar` em `shared/avatarCatalog.ts`): peça inexistente ou incompatível com o corpo, cor fora da paleta e campos desconhecidos são recusados com 422.
- Gravação com `baseVersion`: salvar a partir de uma versão antiga (outra aba ou dispositivo) devolve 409, e a tela pede para recarregar.
- **Só o próprio colaborador edita o próprio avatar.** Administrador não edita o de ninguém (403).
- Quem nunca salvou recebe uma aparência padrão determinística, sorteada a partir do ID do colaborador. **O corpo não é deduzido do nome.**
- `AVATAR_CATALOG_VERSION` (hoje 1) vai junto em cada perfil, para migrar configurações se o catálogo mudar.

## Catálogo (`shared/avatarCatalog.ts`)

| Slot | Itens | Observação |
|---|---|---|
| Parte de cima | 8 | 2 nos dois corpos; 3 só masculinos (ternos e paletó); 3 só femininos (camisa social, tailleur, blazer) |
| Parte de baixo | 13 | jeans, calça social, legging, saias |
| Sapatos | 6 | todos nos dois corpos |
| Cabelo | 10 | todos nos dois corpos |
| Barba | 2 | corpo masculino; usa a cor do cabelo |
| Óculos | 3 | — |
| Headset | 1 | geometria original, presa ao osso da cabeça |
| Paletas | cabelo 6, parte de cima 8, parte de baixo 5, sapatos 4 | tons de pele 5, rostos 4 |

**Curadoria:** as camisetas e blusas casuais do pacote do sistema do MakeHuman (`male_casualsuit02/04/06`, `female_casualsuit01/02`, `female_sportsuit01`) têm o **logotipo do projeto MakeHuman estampado**. Ficaram fora do catálogo, e o `process.ts` não as distribui. Os shorts de `female_casualsuit02` também ficaram fora, por não combinarem com o uso corporativo.

## Pipeline de assets

```
MPFB2 no Blender 4.2 (modo sem interface)          tools/avatars/build.py   → .build-tools/avatars-raw/*.glb + build.json
  └─ npm run avatars:build [-- male|female]        tools/avatars/build.mjs (localiza o Blender portátil)
pós-processamento web                               tools/avatars/process.ts → public/assets/avatars/** + manifest.json + CREDITS.md
  └─ npm run avatars:process
conferência visual (poses, peças, clipping)         tools/avatars/sheet.mjs + tools/avatars/clipping-requests.ts
  └─ npm run avatars:sheet -- <nome> <pedidos.json> → test-results/avatar-<nome>.jpg
```

O **build** (`build.py`, configurado por `tools/avatars/sources.json`):

1. Cria o humano MakeHuman (macro de gênero 1 ou 0, proporções médias), aplica os alvos de rosto e os **visemas** (`viseme_aa_ah_ax_01`, `viseme_ao_03`, `viseme_y_iy_ih_ix_06`) como shape keys e gera o rig **game_engine** (53 ossos, mesmos nomes em todos os arquivos).
2. Para cada roupa, ajusta ao corpo pelo MPFB e separa a parte de cima e a de baixo pelas partes soltas da malha (é parte de baixo o que termina abaixo de 62% da altura da cabeça). Cada parte grava quais vértices do corpo esconde (`delverts` do `.mhclo`) num bit dos atributos `_hidea`/`_hideb`.
3. Reduz cada peça ao **orçamento de triângulos** (parte de cima 7.000, parte de baixo 4.500, cabelo 5.000, sapatos 2.600, óculos 2.000, barba 3.000) e gera o **LOD1** com 33%.
4. Separa a parte principal de cada peça num material `tint` (recebe a cor escolhida), modela o headset e o prende ao osso `head`.
5. Exporta um GLB por peça e por corpo (com morphs esparsos e os atributos de máscara) e grava `build.json`.

O **pós-processamento** (`process.ts`) converte as texturas para WebP (pele e olhos 1024 px, o resto 512 px), deixa a textura `tint` em tons de cinza com brilho normalizado, faz dedup e prune, confere esqueleto, morphs e máscara de pele, publica só os itens do catálogo e grava o manifesto (bytes, sha256, triângulos, atributos, ossos e origem e licença de cada item) e o `CREDITS.md`.

**Resultado atual:** 124 arquivos, 21,6 MB em `public/assets/avatars/`. Corpo: 36.476 triângulos (LOD1: 10.868). Um avatar completo tem cerca de 50 mil triângulos em LOD0 e 16 mil em LOD1.

**Ambiente de build** (fora do repositório, em `.build-tools/`, ignorado pelo git): Blender 4.2.9 portátil, MPFB 2.0.18 instalado como extensão e os pacotes de recursos do MakeHuman `makehuman_system_assets`, `skins01`, `skins02`, `suits01`, `glasses01`, `bodyparts05`, `poses01` e `visemes01` (hashes em `.build-tools/packs.sha256`). O Blender com os pacotes ocupa cerca de 2 GB e pode ser apagado depois do build: o produto só usa `public/assets/avatars/`.

## Montagem e animação no navegador

- `src/three/avatar/assets.ts` clona o corpo, liga cada peça ao **esqueleto do corpo** (uma textura de ossos e um cálculo de matrizes por avatar) e aplica a cor no material `tint` (materiais reaproveitados por peça e cor). No shader do corpo, descarta a pele coberta pelas peças vestidas.
- **Calça justa com sapato de cano:** a gola do sapato atravessava a barra da calça nas pernas mais finas. A parte do sapato acima da barra (medida na pose de bind) é descartada no shader, porque ficaria escondida pela calça de qualquer jeito. Saia não corta nada.
- `src/three/avatar/rig.ts`: poses procedurais com **IK de dois ossos** (braços até o teclado e o mouse, pernas até o chão), pesos com transição suave entre sentado, digitando e em atendimento, dedos curvados, olhar e visemas na fala. Medidas do posto em `STATION`: assento 0,48 m, mesa 0,75 m, teclado a 0,36 m à frente do assento. Os punhos ficam a 6 cm acima do tampo, e as pontas dos dedos tocam as teclas sem atravessar.
- `src/three/avatar/Avatar.tsx`:
  - **LOD** com histerese: LOD0 a menos de 8 m da câmera, LOD1 a mais de 10 m.
  - Em LOD1, a animação roda a cada 3 quadros e o personagem não projeta sombra.
  - Fora do enquadramento, não desenha nem anima.
  - Peça ausente ou com falha de carga entra em `missing` e o resto continua. Se o corpo falhar, aparece o substituto "avatar indisponível".

## Validação de clipping

Folhas de contato com os 8 looks, cada um em 6 quadros: digitando em 3/4, mãos no teclado de perto, em atendimento falando, pernas sentado de lado, sentado de costas e em pé. Para gerar: `npx tsx tools/avatars/clipping-requests.ts m-casual,m-corp test-results/clip.json`, depois `npm run avatars:sheet -- clip test-results/clip.json`.

| Achado | Situação |
|---|---|
| Pontas dos dedos afundando no teclado (todos os looks) | **corrigido**: punho de 3,5 para 6 cm acima do tampo |
| Gola dos sapatos atravessando calça justa e legging (corpo feminino, sentado e em pé) | **corrigido**: recorte do sapato acima da barra |
| Cabelo volumoso passando por cima da haste do headset (chanel, longo) | **aceito**: aparece só em atendimento, de perto |
| Braços, tronco e pernas contra cadeira e mesa nas poses sentado, digitando e em atendimento | sem atravessamento visível nas folhas |
| Pose independente da orientação da mesa no mundo | conferido: girado em 0, 1,2 e π rad, mãos a 0,81 m e a 0,36 m à frente do assento na cena real |

## Desempenho com 25 avatares (`npm run perf:avatars`)

Cena inicial + 25 mesas com cadeira e 25 colegas simulados vinculados, todos online. Interface compilada, cache HTTP vazio, câmera girando durante a amostragem. Ambiente: o mesmo de [verification.md](verification.md) (Ryzen 5 5600G com GPU integrada, Chromium headless com GPU, 1440×900).

| Medida | Antes da otimização | Depois |
|---|---|---|
| FPS, câmera próxima (mediana / mínimo) | 28 / 18 | **37 / 23** |
| FPS, câmera afastada | 29 / 21 | **49 / 29** |
| Triângulos (próxima) | 1,26 milhão | 653 mil |
| Texturas na GPU | 589 | **160** |
| Draw calls | 387 | 334 |
| Heap JS | 87 MB | 79 MB |
| Download dos avatares (cache vazio) | 14,5 MB em 77 arquivos | 12,6 MB |
| Tempo até os 25 avatares | 5,8 s | 3,6 s |

O que mudou:

1. **Esqueleto único por avatar.** Antes, cada peça tinha o próprio `Skeleton`, e no WebGL2 isso cria uma textura de ossos por peça, com as matrizes recalculadas a cada quadro.
2. **LOD0 mais perto** (8 m em vez de 12 m).
3. **Sem sombra no LOD1.**

O teste com renderização por software (SwiftShader) não serve como medida de FPS.

## Lacunas

1. **Fontes reais dos sinais:** digitação do Workscape, ciclo de chamada e atividade de voz da telefonia ([integrations.md](integrations.md#presença-ao-vivo-e-avatares)). Hoje, com dados reais, só online e offline e a digitação do chat interno são verdadeiros. Atendimento e fala vêm dos controles de demonstração.
2. **Texturas por arquivo:** cada GLB embute as suas texturas, então o LOD1 de uma peça baixa de novo as do LOD0. Texturas externas e compartilhadas reduziriam o download (12,6 MB no pior caso) e a memória de GPU.
3. **Animação procedural**, sem captura de movimento: poses fixas por estado, sem caminhar. A pessoa aparece direto na cadeira.
4. **Mãos e rosto** sem rig facial completo: só os visemas e 4 variações de rosto por morph.
5. **Cabelo com headset:** sem deformação do cabelo pela haste.
6. **Mais de um processo de servidor** exige barramento compartilhado para a presença (ver integrações).
