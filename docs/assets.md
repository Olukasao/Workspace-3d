# Assets: pesquisa, aquisição e curadoria

Gerado por `npx tsx tools/assets/report.ts` em 2026-11-12. A fonte de verdade é `public/assets/manifest.json` (um registro por asset: autor, URL de origem, licença, atribuição, data de consulta, versão, hash, alterações, dimensões e arquivo distribuído). Os avisos de licença distribuídos com o produto estão em `public/assets/CREDITS.md` e na tela **Créditos**.

## Resumo

- **52 modelos** no catálogo: 45 baixados das fontes oficiais (11 deles convertidos de OBJ ou glTF para GLB) e 7 de geometria original simples.
- **5 texturas** CC0 (ambientCG).
- Licenças: CC0 1.0: 26 · CC-BY 3.0: 19 · Original do projeto: 7.
- Peso total distribuído: **1.84 MB** (modelos + texturas; miniaturas à parte).
- glTF Validator (gltf-validator 2.0.0-dev.3.10): **0 erros**, 4 avisos em 52 modelos (avisos: espaço tangente gerado na planta do Poly Haven, sem efeito visual).
- Licença conferida **modelo a modelo**: o título, o autor e a licença foram lidos da própria página de cada item no momento do download (`tools/assets/fetch.ts`). Licença não prevista interrompe o processo.
- "Gratuito" não foi tomado como licença comercial: só entraram CC0 1.0 e CC-BY 3.0, que permitem uso comercial com as atribuições registradas.

## Pipeline

1. `npm run assets:fetch`: baixa só os itens curados em `tools/assets/sources.json`. Do Kenney, extrai do zip oficial apenas os 10 arquivos usados, sem baixar coleções inteiras. Grava os originais em `assets-src/originals/` (fora do git) e a proveniência em `assets-src/provenance.json`.
2. Itens sem modelo compatível são gerados por código (`tools/assets/procedural.ts`) dentro da etapa seguinte.
3. `npm run assets:process`: GLB autocontido, metros, Y para cima, frente em +Z e pivô no centro da base (ou centro da face traseira, para parede). Depois solda vértices, simplifica malhas acima de 12 mil triângulos, remove dados não usados, converte texturas para WebP de até 512 px e deduplica pelo hash do arquivo final. Medidas e altura do tampo vão para o manifesto.
4. `npm run assets:validate`: glTF Validator (Khronos) em todos os GLB, mais conferência de hash, licença, autor, fonte e miniatura.
5. `npm run assets:thumbs`: miniaturas próprias, renderizadas num navegador real a partir do GLB distribuído. `-- --debug` gera folhas de contato com eixos para conferir orientação e escala.

**Deduplicação:** o arquivo é guardado uma vez por hash SHA-256. O cadastro (`AssetDefinition`) é separado. O mesmo arquivo enviado com outra licença ou outro autor vira **outro cadastro** que reaproveita o arquivo, e os metadados nunca se misturam (coberto por teste).

**Upload do administrador** (`POST /api/assets/upload`):

- O tipo é checado pela assinatura glTF binária, não pela extensão. Limites: 8 MB, 150 mil triângulos e texturas de até 2048 px.
- Buffers ou imagens externos (por URI) são **recusados**, assim como extensões obrigatórias desconhecidas.
- O arquivo enviado é normalizado (pivô) e servido só para a própria empresa.

**Entrega:**

- **Assets servidos localmente:** `/assets/...` pelo próprio servidor, e a CSP bloqueia recursos externos.
- **Carregamento sob demanda:** cada GLB é baixado quando a primeira instância aparece, com cache e contagem de referências.
- **Compartilhamento:** geometria e material são compartilhados entre instâncias (`clone`).
- **Instanciamento:** no modo operacional, objetos repetidos (4 ou mais) e não acionáveis viram `InstancedMesh`.
- **Falha de carregamento:** a cena mostra uma caixa âmbar com as medidas do asset no lugar do modelo.

## Cobertura pedida no briefing

| Item | Assets |
|---|---|
| Paredes, portas, vidro, divisórias, pisos | Paramétricos no editor (sala com 4 paredes, parede avulsa, porta, porta de vidro, janela, divisória de vidro) + texturas de piso ambientCG + divisória baixa original |
| Mesas retas e de reunião | mesa-reta, mesa-reuniao (originais), mesa-madeira, mesa-redonda, kn-mesa, kn-mesa-canto |
| Cadeiras | cadeira-escritorio, cadeira-executiva, kn-cadeira, kn-poltrona |
| Bancada de recepção | bancada-recepcao (original) |
| Sofá | sofa-recepcao |
| Gaveteiro, armário, prateleira | gaveteiro, armario-baixo, estante-baixa, estante-livros, kn-estante-aberta, kn-criado-gavetas |
| Monitor, desktop, notebook, teclado, mouse, telefone | monitor, desktop-torre, notebook, teclado, mouse, telefone |
| Impressora/copiadora | copiadora (Office Printer / Copier, Bruno Oliveira — prioridade do briefing), impressora-mesa |
| TV plana e rack | tv-parede, tv-pedestal, tv-painel (original), rack-servidor |
| Vasos, luminárias, lixeira | planta-vaso-vermelho, planta-folhagem, ph-planta, luminaria-piso, luminaria-mesa, kn-luminaria, lixeira |
| Quadros, relógio, livros, caixas, placas | quadro-arte, quadro-branco, porta-retrato, relogio-parede, livros, caixas, caixa-organizadora (original), placa-saida, placa-sala (original) |

## Modelos distribuídos

| Arquivo | Nome no produto | Original | Autor | Licença | Via | Formato original | Medidas (m) | Triângulos | Peso |
|---|---|---|---|---|---|---|---|---|---|
| `models/cadeira-escritorio.glb` | Cadeira de escritório | [Office Chair](https://poly.pizza/m/UfKvrZBK6C) | Quaternius | CC0 1.0 | Poly Pizza | glb | 0.672 × 0.752 × 1.05 | 2116 | 112 KB |
| `models/cadeira-executiva.glb` | Cadeira executiva | [Office Chair](https://poly.pizza/m/dCEsSsJJ1Md) | CMHT Oculus | CC-BY 3.0 | Poly Pizza | glb | 0.642 × 0.639 × 1.2 | 2222 | 42 KB |
| `models/sofa-recepcao.glb` | Sofá de recepção | [Couch Medium](https://poly.pizza/m/mWgQ94zhDZ) | Quaternius | CC0 1.0 | Poly Pizza | glb | 1.9 × 0.893 × 0.774 | 1012 | 22 KB |
| `models/copiadora.glb` | Impressora / copiadora | [Office Printer / Copier](https://poly.pizza/m/bgNnmejxBa-) | Bruno Oliveira | CC-BY 3.0 | Poly Pizza | glb | 0.987 × 0.797 × 1.1 | 916 | 51 KB |
| `models/impressora-mesa.glb` | Impressora de mesa | [Printer](https://poly.pizza/m/77K2TCL5Lz) | CreativeTrio | CC0 1.0 | Poly Pizza | glb | 0.45 × 0.645 × 0.338 | 182 | 17 KB |
| `models/monitor.glb` | Monitor | [Monitor](https://poly.pizza/m/PvSjEbz11k) | CreativeTrio | CC0 1.0 | Poly Pizza | glb | 0.6 × 0.122 × 0.37 | 84 | 10 KB |
| `models/desktop-torre.glb` | Desktop (torre) | [Computer](https://poly.pizza/m/7KNoiQlSxi) | CreativeTrio | CC0 1.0 | Poly Pizza | glb | 0.202 × 0.422 × 0.42 | 324 | 21 KB |
| `models/notebook.glb` | Notebook | [Laptop](https://poly.pizza/m/bxB1L0m8LzZ) | Poly by Google | CC-BY 3.0 | Poly Pizza | glb | 0.36 × 0.25 × 0.241 | 1240 | 93 KB |
| `models/teclado.glb` | Teclado | [Keyboard](https://poly.pizza/m/aPwr5p1dluw) | Poly by Google | CC-BY 3.0 | Poly Pizza | glb | 0.44 × 0.155 × 0.026 | 2224 | 43 KB |
| `models/mouse.glb` | Mouse | [Computer Mouse](https://poly.pizza/m/V2Ebx3pvo4) | CreativeTrio | CC0 1.0 | Poly Pizza | glb | 0.083 × 0.11 × 0.035 | 100 | 11 KB |
| `models/telefone.glb` | Telefone de mesa | [Office Phone](https://poly.pizza/m/YxfMuchpUF) | dook | CC-BY 3.0 | Poly Pizza | glb | 0.24 × 0.162 × 0.19 | 5216 | 273 KB |
| `models/tv-parede.glb` | TV plana de parede | [Flat Screen TV](https://poly.pizza/m/cQ6pt8VHR7G) | Alex Safayan | CC-BY 3.0 | Poly Pizza | glb | 1.45 × 0.145 × 0.854 | 224 | 21 KB |
| `models/tv-pedestal.glb` | TV plana com base | [Flat-screen TV](https://poly.pizza/m/KmT5q0N2AH) | J-Toastie | CC-BY 3.0 | Poly Pizza | glb | 1.25 × 0.122 × 0.772 | 356 | 21 KB |
| `models/rack-servidor.glb` | Rack de servidores | [server rack](https://poly.pizza/m/6ijQclm8jxw) | Jeremy Eyring | CC-BY 3.0 | Poly Pizza | glb | 0.669 × 1.311 × 2 | 1104 | 117 KB |
| `models/gaveteiro.glb` | Gaveteiro de arquivo | [File Cabinet](https://poly.pizza/m/9732ObD3OY) | J-Toastie | CC-BY 3.0 | Poly Pizza | glb | 0.563 × 0.649 × 1.32 | 876 | 37 KB |
| `models/armario-baixo.glb` | Armário baixo | [Cabinet](https://poly.pizza/m/wOiMrnUuhe) | CreativeTrio | CC0 1.0 | Poly Pizza | glb | 0.907 × 0.546 × 0.9 | 324 | 25 KB |
| `models/estante-baixa.glb` | Estante baixa | [Shelf Small](https://poly.pizza/m/TfdgUV2RYe) | Quaternius | CC0 1.0 | Poly Pizza | glb | 1.2 × 0.635 × 0.45 | 92 | 6 KB |
| `models/estante-livros.glb` | Estante de livros | [Medium Book Shelf](https://poly.pizza/m/FeK5BNlpBf) | Zsky | CC-BY 3.0 | Poly Pizza | glb | 1.767 × 0.28 × 1.5 | 572 | 31 KB |
| `models/mesa-redonda.glb` | Mesa de reunião redonda | [Table Large Circular](https://poly.pizza/m/aG6qYcqcI0) | CreativeTrio | CC0 1.0 | Poly Pizza | glb | 2.023 × 2.023 × 0.72 | 298 | 14 KB |
| `models/mesa-madeira.glb` | Mesa de madeira | [Table](https://poly.pizza/m/2UW71XCeyGh) | Darwin Yamamoto | CC-BY 3.0 | Poly Pizza | glb | 1.451 × 0.558 × 0.75 | 160 | 10 KB |
| `models/mesa-centro.glb` | Mesa de centro | [Coffee Table](https://poly.pizza/m/dP74Xz2DlMe) | Francisco Hui | CC-BY 3.0 | Poly Pizza | glb | 0.833 × 0.448 × 0.42 | 312 | 18 KB |
| `models/planta-vaso-vermelho.glb` | Planta em vaso | [Potted Plant](https://poly.pizza/m/GJ3Bm5FDE4) | CreativeTrio | CC0 1.0 | Poly Pizza | glb | 1.126 × 0.885 × 0.9 | 390 | 31 KB |
| `models/planta-folhagem.glb` | Folhagem em vaso | [Houseplant](https://poly.pizza/m/bfLOqIV5uP) | Quaternius | CC0 1.0 | Poly Pizza | glb | 0.926 × 0.968 × 0.7 | 449 | 16 KB |
| `models/luminaria-piso.glb` | Luminária de piso | [Light Floor](https://poly.pizza/m/eBQtooeh43) | Quaternius | CC0 1.0 | Poly Pizza | glb | 0.289 × 0.304 × 1.65 | 226 | 9 KB |
| `models/luminaria-mesa.glb` | Luminária de mesa | [Light Desk](https://poly.pizza/m/uJDWrSJGVH) | Quaternius | CC0 1.0 | Poly Pizza | glb | 0.197 × 0.356 × 0.45 | 356 | 12 KB |
| `models/lixeira.glb` | Lixeira | [Trashcan Small](https://poly.pizza/m/i7HDuYDLkx) | Quaternius | CC0 1.0 | Poly Pizza | glb | 0.268 × 0.163 × 0.38 | 260 | 11 KB |
| `models/quadro-arte.glb` | Quadro decorativo | [Wall Art 06](https://poly.pizza/m/2YYlC15J9SZ) | Jarlan Perez | CC-BY 3.0 | Poly Pizza | glb | 0.546 × 0.03 × 0.9 | 70 | 6 KB |
| `models/porta-retrato.glb` | Porta-retrato | [Blank Picture Frame](https://poly.pizza/m/89xZIizrRZ0) | Jarlan Perez | CC-BY 3.0 | Poly Pizza | glb | 0.17 × 0.109 × 0.24 | 102 | 8 KB |
| `models/relogio-parede.glb` | Relógio de parede | [Analog clock](https://poly.pizza/m/5gAoMR2YHs3) | Poly by Google | CC-BY 3.0 | Poly Pizza | glb | 0.36 × 0.05 × 0.36 | 588 | 13 KB |
| `models/quadro-branco.glb` | Quadro branco | [Whiteboard](https://poly.pizza/m/cYQOKE7Wd7D) | jeremy | CC-BY 3.0 | Poly Pizza | glb | 1.8 × 0.054 × 1.217 | 120 | 9 KB |
| `models/placa-saida.glb` | Placa de saída | [Fire Exit Sign](https://poly.pizza/m/gpft2tHZv4) | J-Toastie | CC-BY 3.0 | Poly Pizza | glb | 0.5 × 0.027 × 0.17 | 643 | 47 KB |
| `models/livros.glb` | Pilha de livros | [Book Stack](https://poly.pizza/m/1WggoIFq8tx) | Danni Bittman | CC-BY 3.0 | Poly Pizza | glb | 0.26 × 0.259 × 0.18 | 640 | 38 KB |
| `models/caixas.glb` | Caixas de papelão | [Cardboard Boxes](https://poly.pizza/m/V9KbWC8Vd6) | Quaternius | CC0 1.0 | Poly Pizza | glb | 0.648 × 0.452 × 0.8 | 432 | 24 KB |
| `models/bebedouro.glb` | Bebedouro | [Water Cooler](https://poly.pizza/m/zWi9p5FSxD) | J-Toastie | CC-BY 3.0 | Poly Pizza | glb | 0.265 × 0.31 × 1.15 | 1566 | 52 KB |
| `models/kn-mesa.glb` | Mesa simples (Kenney) | [desk](https://opengameart.org/content/furniture-kit) | Kenney (www.kenney.nl) | CC0 1.0 | OpenGameArt (Kenney) | obj+mtl | 1.414 × 0.755 × 0.74 | 193 | 12 KB |
| `models/kn-mesa-canto.glb` | Mesa de canto (Kenney) | [deskCorner](https://opengameart.org/content/furniture-kit) | Kenney (www.kenney.nl) | CC0 1.0 | OpenGameArt (Kenney) | obj+mtl | 1.876 × 1.876 × 0.74 | 247 | 14 KB |
| `models/kn-cadeira.glb` | Cadeira de mesa (Kenney) | [chairDesk](https://opengameart.org/content/furniture-kit) | Kenney (www.kenney.nl) | CC0 1.0 | OpenGameArt (Kenney) | obj+mtl | 0.524 × 0.491 × 0.95 | 584 | 31 KB |
| `models/kn-poltrona.glb` | Poltrona (Kenney) | [loungeChair](https://opengameart.org/content/furniture-kit) | Kenney (www.kenney.nl) | CC0 1.0 | OpenGameArt (Kenney) | obj+mtl | 0.852 × 0.713 × 0.8 | 124 | 8 KB |
| `models/kn-estante-aberta.glb` | Estante aberta (Kenney) | [bookcaseOpen](https://opengameart.org/content/furniture-kit) | Kenney (www.kenney.nl) | CC0 1.0 | OpenGameArt (Kenney) | obj+mtl | 0.8 × 0.5 × 1.76 | 292 | 13 KB |
| `models/kn-criado-gavetas.glb` | Aparador com gavetas (Kenney) | [sideTableDrawers](https://opengameart.org/content/furniture-kit) | Kenney (www.kenney.nl) | CC0 1.0 | OpenGameArt (Kenney) | obj+mtl | 1.071 × 0.445 × 0.77 | 234 | 14 KB |
| `models/kn-cafeteira.glb` | Cafeteira (Kenney) | [kitchenCoffeeMachine](https://opengameart.org/content/furniture-kit) | Kenney (www.kenney.nl) | CC0 1.0 | OpenGameArt (Kenney) | obj+mtl | 0.384 × 0.487 × 0.36 | 164 | 12 KB |
| `models/kn-luminaria.glb` | Luminária quadrada (Kenney) | [lampSquareFloor](https://opengameart.org/content/furniture-kit) | Kenney (www.kenney.nl) | CC0 1.0 | OpenGameArt (Kenney) | obj+mtl | 0.237 × 0.237 × 1.7 | 60 | 5 KB |
| `models/kn-tapete.glb` | Tapete retangular (Kenney) | [rugRectangle](https://opengameart.org/content/furniture-kit) | Kenney (www.kenney.nl) | CC0 1.0 | OpenGameArt (Kenney) | obj+mtl | 2.4 × 1.406 × 0.015 | 28 | 3 KB |
| `models/kn-mesa-centro.glb` | Mesa de centro (Kenney) | [tableCoffee](https://opengameart.org/content/furniture-kit) | Kenney (www.kenney.nl) | CC0 1.0 | OpenGameArt (Kenney) | obj+mtl | 1.207 × 0.73 × 0.42 | 116 | 6 KB |
| `models/ph-planta.glb` | Planta em vaso (Poly Haven) | [Potted Plant 04](https://polyhaven.com/a/potted_plant_04) | James Ray Cock | CC0 1.0 | Poly Haven | gltf+bin+jpg (1k) | 0.471 × 0.518 × 0.75 | 8929 | 358 KB |
| `models/mesa-reta.glb` | Mesa reta 1,40 m | Mesa reta 1,40 m | Office 3D (geometria original) | Original do projeto | geometria original | gerado por código | 1.4 × 0.7 × 0.75 | 60 | 5 KB |
| `models/mesa-reuniao.glb` | Mesa de reunião 2,40 m | Mesa de reunião 2,40 m | Office 3D (geometria original) | Original do projeto | geometria original | gerado por código | 2.4 × 1.1 × 0.758 | 84 | 6 KB |
| `models/bancada-recepcao.glb` | Bancada de recepção | Bancada de recepção | Office 3D (geometria original) | Original do projeto | geometria original | gerado por código | 2.04 × 0.74 × 1.08 | 84 | 7 KB |
| `models/tv-painel.glb` | TV painel 55" (parede) | TV painel 55" (parede) | Office 3D (geometria original) | Original do projeto | geometria original | gerado por código | 1.23 × 0.069 × 0.71 | 36 | 4 KB |
| `models/divisoria-baixa.glb` | Divisória baixa de estação | Divisória baixa de estação | Office 3D (geometria original) | Original do projeto | geometria original | gerado por código | 1.46 × 0.36 × 1.13 | 72 | 6 KB |
| `models/placa-sala.glb` | Placa de identificação | Placa de identificação | Office 3D (geometria original) | Original do projeto | geometria original | gerado por código | 0.32 × 0.014 × 0.11 | 64 | 4 KB |
| `models/caixa-organizadora.glb` | Caixa organizadora | Caixa organizadora | Office 3D (geometria original) | Original do projeto | geometria original | gerado por código | 0.38 × 0.28 × 0.24 | 36 | 3 KB |

## Texturas

| Arquivo | Nome | Original | Licença | Alterações |
|---|---|---|---|---|
| `textures/piso-madeira.webp` | Piso de madeira | [Wood Floor 051](https://ambientcg.com/a/WoodFloor051) | CC0 1.0 | somente o mapa de cor é distribuído; reduzido de 1024 para 512 px e convertido para WebP (qualidade 80) |
| `textures/piso-carpete.webp` | Carpete | [Carpet 016](https://ambientcg.com/a/Carpet016) | CC0 1.0 | somente o mapa de cor é distribuído; reduzido de 1024 para 512 px e convertido para WebP (qualidade 80) |
| `textures/piso-concreto.webp` | Concreto | [Concrete 034](https://ambientcg.com/a/Concrete034) | CC0 1.0 | somente o mapa de cor é distribuído; reduzido de 1024 para 512 px e convertido para WebP (qualidade 80) |
| `textures/piso-ceramica.webp` | Cerâmica | [Tiles 141](https://ambientcg.com/a/Tiles141) | CC0 1.0 | somente o mapa de cor é distribuído; reduzido de 1024 para 512 px e convertido para WebP (qualidade 80) |
| `textures/metal-escovado.webp` | Metal escovado | [Metal 009](https://ambientcg.com/a/Metal009) | CC0 1.0 | somente o mapa de cor é distribuído; reduzido de 1024 para 512 px e convertido para WebP (qualidade 80) |

## Rejeitados

| Item | Licença | Motivo |
|---|---|---|
| [Desk (dook)](https://poly.pizza/m/EtJlOllzbf) | CC-BY 3.0 | Conjunto fundido (mesa + cadeira + computador + acessórios em um só modelo): não serve como peça modular nem para o computador acompanhar a mesa por parentesco. Usado como referência de estilo. |
| [Standing Desk (dook)](https://poly.pizza/m/uxIo5ge0pw) | CC-BY 3.0 | Mesmo motivo: conjunto fundido com monitores e acessórios. |
| [Desk (dook, variação)](https://poly.pizza/m/ISpMh81QGq) | CC-BY 3.0 | Mesmo motivo: conjunto fundido com planta e cadeira. |
| [Monitor CRT (Poly by Google)](https://poly.pizza/m/2D221SHzAER) | CC-BY 3.0 | Referência CRT indicada no briefing; o escritório usa monitor moderno (Monitor, CreativeTrio, CC0). |
| [Monitor estilo all-in-one (Poly by Google)](https://poly.pizza/m/5qZ5IaClHHw) | CC-BY 3.0 | Aparência próxima de um produto de marca; preferido o monitor genérico CC0. |
| [Laptop / MacBook Pro (Alex Safayan)](https://poly.pizza/m/27hcX_w47Jb) | CC-BY 3.0 | Reproduz produto de marca registrada; usado o notebook genérico (Poly by Google). |
| [Kenney Furniture Kit — demais 109 modelos](https://opengameart.org/content/furniture-kit) | CC0 1.0 | Fora do escopo de escritório (cozinha, banheiro, quarto). Só o subconjunto listado foi convertido. |
| [Poly Haven — potted_plant_01 / potted_plant_02](https://polyhaven.com/models/plants) | CC0 1.0 | 70–96 mil polígonos cada: pesados para a cena isométrica. Adotada a potted_plant_04 (≈6 mil). |

## Pendentes

| Item | Motivo |
|---|---|
| [Quaternius — Stylized Nature MegaKit](https://quaternius.com/packs/stylizednaturemegakit.html) | Distribuído como pacote único; o briefing pede para não baixar coleções inteiras. Plantas avulsas do mesmo autor (CC0) vieram pelo Poly Pizza. Confirmar a licença no pack antes de usar. |
| [Quaternius — Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) | Avaliação futura de personagens (ver docs/characters-roadmap.md). Sem download nesta fase. |
| [Adobe Mixamo](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html) | Avaliação futura de rig e animação (ver docs/characters-roadmap.md). Sem download nesta fase. |
| [Poly Haven — HDRI de escritório](https://polyhaven.com/hdris/indoor) | Não adotado no MVP: a iluminação usa ambiente procedural (sem download inicial). Um HDRI de 1K acrescentaria ~1,5 MB ao carregamento. |

## Observações de curadoria

- **dook Office Pack** (Poly Pizza): os modelos "Desk" do próprio dook são **conjuntos fundidos** (mesa + cadeira + computador num só modelo). Não servem como peças modulares nem para o computador acompanhar a mesa por parentesco, então ficaram como referência de estilo. Do pack foram usadas peças avulsas: telefone (dook), copiadora, gaveteiro, bebedouro, placa de saída, quadro, livros, plantas, cadeiras e outras, cada uma com a licença da própria página.
- **Monitor CRT** indicado como referência: substituído por um monitor moderno genérico (CreativeTrio, CC0). As TVs planas vieram separadas (Alex Safayan e J-Toastie, CC-BY 3.0), mais uma TV de painel original.
- **Orientação e escala** conferidas visualmente nas folhas de contato. Cinco modelos foram girados para a frente ficar em +Z e um porta-retrato foi reclassificado de parede para superfície.
- **Defeito encontrado pelo glTF Validator e corrigido:** o conversor OBJ gerava normais nulas em triângulos degenerados do kit Kenney (113 erros em 8 modelos, antes da correção).
