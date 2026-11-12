# Reaproveitamento do FigureBox Planner

## Origem

| Item | Valor |
|---|---|
| Repositório | `Olukasao/FigureBox_Planner` (privado, mesmo autor) |
| Commit pedido | `f478167a569b6c7b9e66e941c4020978aed4a85e` |
| Commit efetivamente usado | `f478167a569b6c7b9e66e941c4020978aed4a85e` — em 12/11/2026 era o `HEAD` de `main` (conferido com `git ls-remote`), então a branch de referência e o commit pedido coincidem |
| Mensagem do commit | "Catálogo de móveis, quadros modulares, texturas, arrastar com altura e biblioteca sem duplicatas" |
| Como foi lido | clone somente leitura em pasta temporária, fora deste projeto. O FigureBox Planner não foi alterado |
| Stack de origem | React 18, Vite 5, TypeScript, Three.js 0.169, React Three Fiber 8, drei 9, zustand, glTF Transform, sharp, vitest |

O Office 3D mantém a mesma stack no cliente e acrescenta Node/Express no servidor, com MariaDB em produção e SQLite embutido no caminho local.

## Mapa do editor de origem (caminhos reais no commit)

| Recurso | Onde está no FigureBox | O que o Office 3D fez |
|---|---|---|
| Canvas e câmera | `src/components/ThreeDViewer.tsx`: `Canvas`, `OrbitControls` com amortecimento, `Environment` com `Lightformer` procedural (sem rede), `CameraRig` com presets de enquadramento e `PerfProbe` (lê `gl.info`) | **Adaptado** em `src/three/Scene3D.tsx`. A câmera tem vista isométrica e vista de planta ortográfica, enquadra pelos limites das salas e anima o foco. O medidor de desempenho foi mantido (`window.__office3d`) |
| Seleção por raycast | `src/components/RoomFurniture.tsx`: `Item` com `onPointerDown/Over/Out` na malha de clique (`hitDim`), `onPointerMissed` no Canvas para limpar a seleção | **Adaptado.** Os eventos ficam no grupo de cada objeto. Shift soma objetos à seleção, e selecionar um membro de grupo seleciona o grupo inteiro |
| Arraste com altura | `RoomFurniture.tsx`: arrasta num plano horizontal na altura do ponto agarrado (`planeH`), desliga os `controls` durante o arraste, pousa no tampo mais alto (`canRestOn`, `surfaceTop`) e mostra a etiqueta `HeightHint` | **Adaptado** em `src/editor/DragController.tsx`, agora em metros e com hierarquia. Um item de superfície que pousa numa mesa passa a ser **filho** dela e acompanha a mesa. Objetos de parede deslizam no plano da parede. Esc cancela o arraste |
| Snapping | `src/utils/furniture.ts`: `snap5`, `snapPlacement` com encosto na parede (`WALL_SNAP`), `clampToRoom`, `resolvePlacement` | **Adaptado** em `shared/scene.ts` (`snapTo`) e `src/editor/ops.ts`. A grade é configurável (livre, 5, 10, 25 ou 50 cm) e há o botão "alinhar à grade" |
| Colisões | `furniture.ts`: `collides` bloqueia a soltura e devolve o móvel à posição original | **Mudado de propósito:** agora é **aviso**, não bloqueio (`collisionWarnings`), porque no escritório há sobreposições legítimas, como a cadeira sob a mesa. Pai e filho não contam como sobreposição |
| Teclado | `RoomFurniture.tsx`: setas, PageUp/PageDown, R, Delete, Esc. `src/utils/viewAxes.ts` traduz direções da tela | **Reaproveitado** (setas, PageUp/PageDown para altura, R para girar, Delete, Esc). Acrescentados Ctrl+Z/Y, Ctrl+D, Ctrl+G e Ctrl+S |
| Objetos modulares | `src/components/Room3D.tsx` (`FadingWall`, `Poster`) e `src/store/roomStore.ts` (`PosterItem`: tamanho, parede e posição) | O **conceito da parede que some** quando fica entre a câmera e o cômodo virou parede que **baixa para 25 cm** (`Wall` em `Scene3D.tsx`). Salas, paredes, divisórias, portas e janelas foram reescritas como objetos paramétricos |
| Texturas | `src/utils/surfaces.ts` (texturas procedurais de piso e parede, descartadas no desmonte), `src/services/modelTextures.ts` (cache com contagem de referências e `GRACE_MS`) | O **padrão de contagem de referências** foi reaproveitado em `src/three/assetCache.ts`. Os pisos usam texturas CC0 reais do ambientCG em vez das procedurais |
| Importação de modelos | `RoomFurniture.tsx`: `GlbModel` (clone, `Box3` para normalizar a altura, pivô na base) e `GlbBoundary` (substituto se o arquivo falhar). Ferramentas `tools/optimize-props.mjs`, `inspect-models.mjs` e `extract-node.mjs` (glTF Transform: weld, simplify, dedup, prune, textureCompress WebP) | **Normalização movida para o pipeline offline** (`server/assets/glb.ts` e `tools/assets/process.ts`). Os GLB já saem em metros e com o pivô certo, e o cliente só clona. O **substituto visual** em caso de falha foi mantido |
| Catálogo | `src/utils/furniture.ts` (`FURNITURE`, medidas em cm, `glb`, `topH`), `FurnitureLibrary.tsx`, `FurnitureThumbs.tsx` (miniatura renderizada em canvas escondido e guardada em cache) | **Reescrito sobre dados.** `AssetDefinition` fica no banco, com o manifesto como fonte. As miniaturas são geradas no build por um navegador real (`tools/assets/thumbs.mjs`, mesma ideia do `FurnitureThumbs`) |
| Deduplicação | `src/store/libraryStore.ts`: `dedupeFigures` (une figures repetidas por nome e metadados) | **Mudado:** a deduplicação passou a ser pelo **hash SHA-256 do arquivo**, sem misturar metadados e licenças (veja `docs/assets.md`) |
| Serialização | `roomStore.ts`: `load()` valida campo a campo e grava em localStorage com atraso; `services/persistence.ts`, `backup.ts`, `shareLink.ts` | **Substituído** por documento de cena versionado no servidor (`SceneDoc`), validado no cliente e no servidor (`validateScene`), com rascunho, revisões publicadas e controle de versão |
| Descarte WebGL | `Room3D.tsx` (`useSurfaceTexture` com `dispose`), `PhotoBox.tsx` e `PackagedBox.tsx` (`dispose` de material e geometria), `modelTextures.ts` (`disposeEntry`) | **Reaproveitado e ampliado.** Geometrias, materiais e texturas do modelo-base são descartados quando a última instância sai, e o desmonte do Canvas libera o que não está em uso |

## Descartado (específico do FigureBox)

Motor de empacotamento (`packingEngine.ts`, `consolidation*`), figures e caixas (`types/figure.ts`, `CabinetBox`, `PhotoBox`), Box Mockup Studio (`components/mockup/*`, `mockupStore`), modo exposição e tour, assistente, entitlements/planos, janela animada, pôsteres de anime, personagens VRoid e todos os modelos de figures e quarto gamer.

## Licenças

- O FigureBox não tem arquivo `LICENSE`: é privado e do mesmo autor. O reaproveitamento é interno e o crédito aparece na tela **Créditos** e neste documento.
- **Nenhum arquivo de modelo foi copiado do FigureBox.** Os itens do Kenney e do Poly Haven que ele também usava foram **baixados de novo das fontes oficiais**, com proveniência própria (`assets-src/provenance.json`).
- O FigureBox inclui um modelo **CC BY-NC** (Saber Lily) e outro **CC BY-NC-SA** (Nintendo Switch). Os dois foram deixados de fora de propósito, porque o Office 3D é corporativo.
- Bibliotecas de terceiros (React, Three.js, R3F, drei, glTF Transform, Express, mysql2, sharp e outras) seguem as próprias licenças, todas MIT, Apache-2.0 ou ISC, listadas em `node_modules/*/LICENSE`.
