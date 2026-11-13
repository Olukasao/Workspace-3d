# Avatares: estilo Ara 3D Gen (padrão) e escolha do estilo pelo administrador

O Office 3D tem **dois estilos de avatar**. O administrador escolhe o da empresa em **Integrações → Estilo dos avatares**, e a troca vale ao vivo para quem está com o escritório aberto.

| Estilo | Como a pessoa personaliza | Situação |
|---|---|---|
| **Ara 3D Gen** (padrão) | **Editor completo**, como o do Ara: corpo, idade, etnia, pele, rosto, cabelo, barba, brincos, roupas (tecido e cor), sapatos, acessórios e 200+ controles finos do corpo e do rosto. Pode começar de um dos 16 personagens prontos | **ativo** |
| **MakeHuman** | Editor de peças: corpo, pele, rosto, cabelo, barba, roupas, sapatos e óculos, com cores ([avatars.md](avatars.md)) | guardado no projeto, **desativado** por padrão |

Trocar de estilo **não apaga nada**: cada pessoa guarda a escolha que fez em cada estilo (tabela `avatar_choices`, uma linha por colaborador e estilo) e volta a ela quando o estilo é reativado. Quem nunca escolheu no estilo ativo recebe um personagem pronto, sorteado a partir do ID do colaborador. **O gênero não é deduzido do nome.**

## O editor ("Meu avatar")

Clique no seu nome, no topo. Dois modos:

- **Montar**
  - **Corpo:** feminino ou masculino (e o ponto entre os dois), idade de 18 a 90 anos, altura, peso, massa muscular, proporções e busto.
  - **Origem e pele:** ascendência africana, asiática e europeia (combinam proporcionalmente), 20 peles com miniatura e ajuste de tom.
  - **Olhos, sobrancelhas e cílios:** 11 cores de olhos, 12 sobrancelhas e 4 cílios, todos com miniatura.
  - **Cabelo:** 10 estilos com miniatura mais 4 (raspado, moicano, tranças nagô e tranças box), cor com paleta natural ou qualquer cor, barba (7 tipos, com cor) e brincos (4, em ouro ou prata).
  - **Roupa:** conjunto pronto (terno com gravata, tailleur, terno masculino, blusa e saia, camisa e jeans...) ou **peças soltas** (parte de cima, paletó ou casaco, parte de baixo). Cada peça tem tecido (terno, linho, cetim, jeans, renda...) e cor.
  - **Sapatos e acessórios:** 10 calçados, relógio, colares, anel, pulseiras, cinto e o headset (que entra sozinho durante o atendimento).
- **Detalhado:** os controles finos do Ara, por categoria (Busto, Rosto, Tronco, Braços e pernas) e por grupo (formato e tamanho da cabeça, testa, olhos, nariz, boca, orelhas, queixo, bochechas, ombros, mãos, pés, braços e pernas). Todos os rótulos estão em português. Cada controle tem "zerar", e há "Zerar todos".
- **Sortear** escolhe um personagem pronto ao acaso. **Salvar** gera o seu avatar e publica para todos. **Cancelar** descarta a edição.

A pré-visualização 3D gira e mostra o que você monta, em pé ou sentado na estação (trabalhando, digitando ou em atendimento).

**O que fica de fora do Ara, de propósito** (não faz sentido num escritório): armas, vestes de fantasia (clérigo, noiva, prisioneiro...), biquíni, óculos escuros, chapéus, tatuagens, veículos e objetos de mão. As camisetas do pacote do MakeHuman com o logotipo do projeto estampado também ficam de fora. Só adultos: a idade mínima é 18 anos.

## Como funciona (arquitetura)

```
Navegador (editor)                         Servidor                                   Colegas
  parâmetros ──► prévia local (worker,       PUT /api/avatar/me { custom }
                 gerador do Ara)              ├─ valida e normaliza (lista permitida)
                                              ├─ gera o modelo 3D numa thread própria  ──►  GET /api/avatar/model/<id>/lod0.glb
                                              ├─ grava em data/avatar-models/<empresa>/<id>/
                                              └─ presença ao vivo: appearance { custom, model }
```

- **A fonte da verdade são os parâmetros** (`custom`), não um arquivo enviado. O cliente **nunca envia modelo 3D**: o servidor valida os parâmetros e gera o modelo ele mesmo. O identificador do modelo (`model`) é o SHA-256 dos parâmetros normalizados, calculado no servidor (qualquer `model` vindo do cliente é ignorado).
- **Validação estrita** (`shared/araCustom.ts`, `normalizeAraParams`): só campos conhecidos; números dentro da faixa; ids da lista permitida; cores `#rrggbb`; padrões de tecido por peça; só 18 anos ou mais; sem conjunto pronto, parte de cima e de baixo obrigatórias (sempre vestido); roupa masculina ou feminina compatível com o corpo; controles do corpo só os do catálogo. Qualquer erro → **422**, sem gerar nada.
- **Geração no servidor** (`server/araGen.ts`, `server/araWorker.ts`): numa thread própria (a presença ao vivo não trava), uma geração por vez, com tempo limite de 90 s e fila de até 12. Leva cerca de 5 a 10 s. O mesmo personagem não é gerado duas vezes (conteúdo endereçado). Cada pessoa pode gerar um avatar novo a cada 4 s (**429** se passar disso). A thread se encerra depois de 1 minuto ocioso.
- **Entrega:** `GET /api/avatar/model/<id>/lod0.glb` e `lod1.glb`, só com sessão e só da empresa dona do modelo (outra empresa recebe 404). O navegador guarda em cache (`immutable`, porque o id é o conteúdo).
- **Prévia no navegador** (`src/avatar/ara/previewWorker.ts`): roda o gerador do Ara num worker (a tela não trava), sem morph targets, e mostra o resultado no mesmo renderizador do escritório. É só local: o que os colegas veem vem do servidor. Pedidos novos substituem os anteriores ainda não executados.
- **Código do Ara no projeto:** `vendor/ara3d` (cópia sem alterações de `src/core`, `src/export` e `node-assets`, MIT; ver `vendor/ara3d/UPSTREAM.md`) e os dados dos personagens em `public/assets/ara-data` (MakeHuman, CC0). O editor é um bloco carregado só quando a pessoa abre o "Meu avatar" (29 KB), mais o worker (1,2 MB).

## Origem e licenças

- **Gerador:** [Ara 3D Gen](https://github.com/olatunde85/3d-gen), código MIT (`vendor/ara3d/LICENSE`). Os personagens gerados podem ser usados em projetos comerciais e não comerciais sem atribuição.
- **Dados** (corpos, rostos, cabelos, roupas, sapatos, texturas): MakeHuman, pacote `makehuman_system_assets`, **CC0 1.0** (`public/assets/ara-data/LICENSE.txt`). É o mesmo pacote que o estilo MakeHuman já usava.
- **Animação:** procedural, do próprio Office 3D. Os clipes de captura de movimento da CMU que o Ara embute **não são distribuídos** (os modelos saem sem animações).
- **Headset:** geometria original do projeto, montada na medida da cabeça de cada personagem.
- Lista por arquivo da galeria: `public/assets/avatars-ara/CREDITS.md` e tela **Créditos**.

## Pipeline da galeria de 16 personagens prontos

```
Ara 3D Gen (clone em .build-tools/ara3d)   npm run avatars-ara:build     tools/avatars-ara/build.mjs + gallery.ts → .build-tools/ara-raw/*.glb + gallery.json
pós-processamento                           npm run avatars-ara:process   tools/avatars-ara/process.ts + optimize.ts → public/assets/avatars-ara/** (GLB, LOD1, manifest, CREDITS.md)
miniaturas                                  npm run avatars-ara:thumbs    tools/avatars-ara/thumbs.mjs → public/assets/avatars-ara/thumbs/*.webp
catálogo compartilhado                      npm run avatars-ara:catalog   tools/avatars-ara/gen-catalog.ts → shared/araCatalog.generated.ts (controles, opções, 16 presets)
```

A galeria é o ponto de partida do editor e o personagem padrão de quem ainda não personalizou. A fonte é `tools/avatars-ara/gallery.ts` (parâmetros reproduzíveis); a lista de nomes que o servidor valida está em `shared/avatarAra.ts`, e um teste confere que as duas batem com o manifesto distribuído. Os mesmos módulos de otimização (`tools/avatars-ara/optimize.ts`) servem ao pipeline e ao servidor.

**Instalar o Ara 3D Gen** (só para regerar a galeria; exige Node 20+ e cerca de 1,2 GB):

```bash
git clone https://github.com/olatunde85/3d-gen.git .build-tools/ara3d
cd .build-tools/ara3d && npm install && npm run setup-assets   # baixa ~420 MB de dados CC0 do MakeHuman
```

`npm install` roda código de terceiros (dependências do Ara 3D Gen) no seu computador. A galeria, o código e os dados já estão no repositório, então **o produto roda sem nada disso**.

> **Defeito do Ara no Windows:** `scripts/build-assets.ts` monta as chaves dos "targets" com `relative(...)`, que usa barras invertidas no Windows. Resultado: `targets.pack` vazio ("0 targets, 0 sliders") e **todos os personagens saem com o mesmo corpo, sem variação de idade, etnia ou peso**. Corrija trocando `relative(...)` por `relative(...).replace(/\\/g, '/')` nas duas linhas que montam as chaves. Sem isso, o editor não teria controles de corpo.

**Otimização dos modelos** (`tools/avatars-ara/optimize.ts`):

- **LOD0** (detalhe médio): só 5 morph targets (3 visemas e o piscar), texturas em WebP (pele, olhos e cabelo 1024 px; roupas 256 px).
- **LOD1** (detalhe baixo, simplificado com meshoptimizer a 28%): sem morph targets, sem normal, rugosidade, oclusão nem emissivo; texturas de 512 px (pele, olhos e cabelo) e 128 px.
- **Por que só 5 morph targets:** o Ara exporta 34. Com 34, o shader da pele não compila nesta GPU (ANGLE/Direct3D 11: "Shader Error 1282"), e o rig só usa os visemas `aa`, `O`, `I`.

## Montagem e animação

`src/three/avatar/ara.ts` carrega o GLB (da galeria, gerado pelo servidor ou a prévia local) e devolve o mesmo `BuiltAvatar` do outro estilo:

- os ossos Mixamo (`Hips`, `LeftArm`…) ganham também os nomes que o rig usa (`pelvis`, `upperarm_l`…), em um mapa. **O rig procedural (IK) não mudou:** ele calcula tudo no espaço do avatar e não depende dos eixos locais dos ossos;
- os visemas do rig apontam para `viseme_aa`, `viseme_O`, `viseme_I`;
- cabelo, cílios e sobrancelhas são recorte por alfa; a camada de detalhes da pele é translúcida, sem escrita de profundidade;
- headset original preso ao osso `Head`.

## Banco e API

- `server/migrations/003_avatar_styles.sql`: `avatar_choices` (PK colaborador + estilo; copia o que já estava salvo como `makehuman`) e `company_settings` (chave `avatar_style` por empresa). A tabela `avatar_profiles` da migração 002 fica só para histórico.
- `GET` e `PUT /api/admin/avatar-style` (administrador): lê e troca o estilo; valor fora de `ara3d` e `makehuman` → 400; outros perfis → 403. Cada troca vai para a trilha (`avatar.style`, de e para).
- `GET /api/avatar/catalog`: estilo ativo, galeria do Ara e catálogo do MakeHuman.
- `GET` e `PUT /api/avatar/me`: operam no estilo ativo. Configuração de outro estilo ou parâmetros inválidos → 422. Dois formatos no estilo Ara: `{ character }` (personagem pronto) e `{ custom }` (personalizado, com `model` gerado pelo servidor).
- `GET /api/avatar/model/:id/lod0.glb` e `lod1.glb`: modelo gerado, só para a empresa dona.
- A troca de estilo é **por empresa**: o administrador de outra empresa não muda o estilo desta.

## Desempenho com 25 avatares (`npm run perf:avatars`)

Mesmo cenário e ambiente do [estilo MakeHuman](avatars.md#desempenho-com-25-avatares-npm-run-perfavatars) (GPU integrada, headless, 1440×900, cache vazio). O Ara é **mais pesado**, porque cada personagem tem cerca de 20 materiais próprios e quase nada é compartilhado entre eles. Os personagens personalizados passam pelo mesmo pipeline e têm o mesmo peso dos prontos.

| Medida | MakeHuman | Ara 3D Gen |
|---|---|---|
| FPS câmera próxima (mediana / mínimo) | 37 / 23 | 25 a 32 / 5 a 8 |
| FPS câmera afastada (mediana / mínimo) | 49 / 29 | 30 a 35 / 29 a 33 |
| Triângulos (próxima / afastada) | 653 mil / 616 mil | 519 mil / 433 mil |
| Draw calls (próxima / afastada) | 334 / 375 | 453 / 519 |
| Texturas na GPU (próxima / afastada) | 160 / 131 | 887 / 670 |
| Heap JS (próxima / afastada) | 79 / 69 MB | 392 / 166 MB |
| Download dos avatares, cache vazio | 12,6 / 9,1 MB | 24,1 / 16,1 MB |

O Ara foi medido duas vezes (as faixas acima); a GPU integrada em modo headless varia de uma medição para outra. A câmera próxima tem picos de quadros baixos quando os modelos em LOD0 acabam de carregar.

**Como melhorar** (não feito): juntar os materiais de cada personagem num atlas (menos draw calls e texturas), compartilhar texturas de roupa entre personagens (hoje cada GLB embute as suas) e descartar do cache os GLB de LOD0 que não estão em uso.

## Lacunas

1. **Armazenamento dos modelos gerados:** ficam em disco no servidor (`<DATA_DIR>/avatar-models`) e **nunca são apagados**. Cada edição nova cria um modelo novo de 3 a 5 MB. Falta uma rotina de limpeza (apagar modelos que nenhum avatar salvo usa mais). Com mais de um processo de servidor, o armazenamento precisa ser compartilhado (volume ou armazenamento de objetos).
2. **Modelo ausente:** se a pasta de dados for apagada, o avatar aparece como "avatar indisponível" até a pessoa salvar de novo. Dá para regenerar a partir dos parâmetros gravados no banco, mas isso não está implementado.
3. **Desempenho:** ver a tabela acima. Em máquinas fracas, o administrador pode voltar ao estilo MakeHuman.
4. **Prévia no navegador:** a primeira geração carrega cerca de 14 MB de dados do Ara e leva alguns segundos; as seguintes são mais rápidas. Em computador lento, a prévia atrasa um pouco atrás do controle.
5. **Tradução:** os 130 rótulos dos controles finos foram traduzidos à mão. Se o Ara adicionar controles novos, eles aparecem com o texto original em inglês até serem traduzidos em `shared/araLabels.ts`.
6. **Mãos:** a pose usa a mesma IK do outro estilo; os dedos curvam de forma simples.
