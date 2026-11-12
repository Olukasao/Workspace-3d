# Office 3D

A planta do escritório vira interface operacional. O administrador monta o andar num editor 3D e publica revisões. Operadores e visualizadores navegam pela última revisão publicada: clicam num posto, numa impressora ou numa TV e veem quem está ali e o que dá para fazer (chat, acesso remoto, transferência de atendimento, impressão, painel). Cada colaborador tem um avatar personalizado, sentado na própria mesa, que mostra ao vivo se a pessoa está online, digitando ou em atendimento.

**MVP executável com dados fictícios.** Funciona sem nenhuma integração externa: chat, presença, transferência, acesso remoto e fila de impressão têm adaptadores de demonstração claramente sinalizados. Os pontos de encaixe dos serviços reais estão descritos em [docs/integrations.md](docs/integrations.md).

## Executar localmente

Requisitos: **Node.js 22.5 ou mais recente** (usa o SQLite embutido do Node; testado no 24.19). Chrome ou Edge instalado só é necessário para os testes no navegador e para gerar miniaturas.

```bash
npm install
cp .env.example .env        # opcional: os padrões já servem para a demonstração
npm run db:reset            # cria o banco local (data/office3d.sqlite), aplica migrações e seed
npm run dev                 # API em http://localhost:8787 + interface em http://localhost:5173
```

Abra http://localhost:5173 e escolha uma conta fictícia na tela de entrada (senha `demo1234`):

| Conta | Perfil | Para ver |
|---|---|---|
| `admin@demo.office3d.local` | Administrador | Editor, publicação, vínculos, trilha, integrações (com "Simular falha") |
| `operador@demo.office3d.local` | Operador | Modo operacional e ações. Tem 2 atendimentos fictícios ativos |
| `visualizador@demo.office3d.local` | Visualizador | Mapa e dados profissionais, sem ações |
| `admin@outra.office3d.local` | Administrador de outra empresa | Isolamento: não enxerga nada da Acme |

Produção (um processo só, servindo a interface compilada):

```bash
npm run build && npm start   # http://localhost:8787
```

Com `DB_DRIVER=mariadb` e `DB_HOST`, `DB_USER`, `DB_PASSWORD` e `DB_NAME`, o mesmo código usa MariaDB (`npm run db:migrate` aplica `server/migrations/*.sql`). Use `DEMO_MODE=false` fora da demonstração: sem contas fictícias e sem "Simular falha".

## O que percorrer na demonstração

1. **Operador** → *Operação*: busque "Ana" ou "NOC", percorra a lista com ↑ ↓ e Enter, clique num posto na cena.
   - Mesa ocupada: chat (simulado), acesso remoto (só nos PCs autorizados para ele), transferir atendimento.
   - **Posto 06** é mesa vaga.
   - **Posto NOC 02** tem colaborador desligado (vínculo órfão).
   - **Posto 04** tem o dispositivo removido.
   - **Impressora Atendimento**: pré-visualização do PDF, diálogo do navegador ou envio para a fila simulada (na fila → envio confirmado → conclusão reportada).
   - **TVs do NOC**: painel autorizado.
   - **TV da sala de reunião**: sem painel (não configurado).
2. **Administrador** → *Editor*:
   - Insira "Mesa reta 1,40 m" e, com a mesa selecionada, "Monitor": o monitor entra sobre o tampo e acompanha a mesa ao ser arrastada.
   - Troque o modelo da TV no inspetor: o ID e os vínculos continuam os mesmos.
   - Ctrl+Z / Ctrl+Y, **Salvar**, **Publicar**. Abra outra janela anônima como operador para ver a revisão nova.
3. **Administrador** → *Integrações* → "Simular falha" no chat: no modo operação aparece o aviso, o mapa segue navegável e só o chat fica "Indisponível".
4. **Administrador** → *Trilha*: ator, alvo, resultado, modo (demo/real) e correlação de cada ação.

## Construir a estrutura do zero

No **Editor**, o painel *Construir a estrutura* (à esquerda) permite partir de um plano vazio e desenhar do jeito que quiser:

| Ferramenta | Atalho | Como usar |
|---|---|---|
| Selecionar | `V` | Mover, girar e editar objetos |
| Piso | `F` | Arraste um retângulo no chão. Escolha o acabamento (carpete, madeira, cerâmica, concreto, liso) e, se quiser, marque "já criar as 4 paredes". Cada piso é uma zona com nome, setor e capacidade |
| Parede | `W` | Clique no início e em cada ponto seguinte. Clicar de novo no primeiro ponto fecha o contorno. Enter, Esc ou duplo clique terminam. Escolha alvenaria, divisória ou vidro, e a altura e a espessura |
| Porta, Janela, Porta de vidro | `P`, `J` | Passe o mouse sobre uma parede: o vão aparece em azul onde cabe. Clique para inserir. Depois dá para arrastá-lo ao longo da parede |

- **Encaixe:** a grade (5 a 50 cm), os ângulos de 45° e as pontas de paredes e cantos de pisos já existentes. Segure `Alt` para desligar o encaixe de ângulo.
- **Medidas ao vivo** durante o desenho (comprimento, ângulo, área).
- **Esticar ou encurtar** uma parede pronta: selecione-a e arraste as bolinhas azuis das pontas. Portas e janelas ficam à mesma distância da ponta parada.
- **Plano vazio:** botão "Começar com o plano vazio" (pede confirmação e dá para desfazer com Ctrl+Z).
- Tudo entra no histórico: **Ctrl+Z** desfaz um passo por vez.

## Mesa com posição fixa

No **Editor**, selecione uma mesa e escolha o colaborador no inspetor (seção de vínculos). A mesa passa a ser o lugar fixo da pessoa:

- O assento fica na cadeira posta junto da mesa. Sem cadeira, fica à frente dela.
- O inspetor mostra a **posição fixa** em metros.
- A mesa é **travada** para não sair do lugar por acidente. Salve o rascunho e publique.
- Computadores sobre a mesa herdam o ocupante. Uma pessoa ocupa uma mesa, e uma mesa tem uma pessoa.

## Avatares e presença ao vivo

- **Meu avatar** (clique no seu nome, no topo): monte o seu avatar com corpo, pele, rosto, cabelo, barba, roupas, sapatos e óculos, ou parta de um look pronto (casual ou corporativo). A pré-visualização gira e mostra as poses. **Salvar** publica para todo mundo na hora; **Cancelar** descarta. Cada pessoa edita só o próprio avatar.
- **No modo Operação**, cada colaborador online aparece sentado na cadeira da mesa dele:
  - **digitando** quando escreve no chat interno;
  - **em atendimento**, com headset e balão "Em atendimento" ou "•••" enquanto fala;
  - some quando fica offline, depois de uma tolerância curta.
- Quem está online sem mesa aparece em "Online sem mesa".
- Nada do conteúdo da conversa chega ao escritório: só o sinal "digitando sim/não".
- **Demonstração:** o botão de presença no topo liga e desliga um atendimento e o sinal de fala da sua própria pessoa. Os colegas sem conta são simulados.

Detalhes: [docs/avatars.md](docs/avatars.md) (catálogo, pipeline, licenças, desempenho) e [docs/integrations.md](docs/integrations.md#presença-ao-vivo-e-avatares) (sinais, segurança e o que falta das integrações reais).

## Verificações

```bash
npm run typecheck   # TypeScript estrito (cliente, servidor, ferramentas e testes)
npm run lint        # ESLint
npm test            # 70 testes: cena, operações do editor, desenho livre, API e presença/avatares (servidor real + SQLite em memória)
npm run e2e         # 20 verificações no navegador real (Chrome/Edge), pelos fluxos da interface
npm run e2e:draw    # 7 verificações: construir a estrutura do zero (piso, paredes, janela, porta, puxador)
npm run e2e:avatars # 9 verificações com duas pessoas em sessões separadas: avatar na mesa, troca de roupa, digitação, atendimento, várias abas, reconexão
npm run perf        # medição com 100 objetos repetidos → test-results/perf-report.json
npm run perf:avatars      # medição com 25 avatares simultâneos (rode npm run build antes) → test-results/perf-avatars-report.json
npm run assets:validate   # glTF Validator (Khronos) em todos os GLB + conferência do manifesto
```

Pipeline dos avatares (só para regerar os modelos; precisa do Blender com o MPFB2, ver [docs/avatars.md](docs/avatars.md#pipeline-de-assets)):

```bash
npm run avatars:build     # Blender sem interface → .build-tools/avatars-raw
npm run avatars:process   # WebP, tingimento, LOD, manifesto e créditos → public/assets/avatars
npm run avatars:sheet -- <nome> <pedidos.json>   # folha de contato para conferir peças, poses e clipping
```

Resultados desta entrega: [docs/verification.md](docs/verification.md).

## Estrutura

```
shared/          tipos e regras da cena usados por cliente e servidor (validação, hierarquia, colisões, cena inicial)
server/          Express: autenticação, perfis, rascunho/publicação, vínculos, ações, trilha, upload de GLB
  db/            drivers SQLite (local) e MariaDB (produção), migrações, seed
  providers/     contratos dos conectores + adaptadores de demonstração e pontos de encaixe reais
  migrations/    SQL portátil (MariaDB e SQLite)
src/             React + React Three Fiber
  three/         cena 3D compartilhada, cache de modelos com contagem de referências, instanciamento
    avatar/      montagem dos avatares (peças, cor, máscara de pele), poses com IK, LOD
  avatar/        "Meu avatar" (editor com pré-visualização) e painel de presença de demonstração
  live.ts        cliente da presença ao vivo (SSE) e sinal de digitação
  editor/        editor do administrador (catálogo, inspetor, arraste, desfazer/refazer, vínculos)
  ops/           modo operacional (lista navegável, painel de contexto, diálogos de ação)
  admin/         trilha, integrações, créditos
public/assets/   catálogo distribuído: GLB, texturas, miniaturas, manifest.json, CREDITS.md, validation.json
public/assets/avatars/  corpos e peças dos avatares (GLB), tons de pele, manifest.json, CREDITS.md
tools/assets/    pipeline de assets: fetch → process → thumbs → validate → report
tools/avatars/   pipeline dos avatares: build no Blender (MPFB2) → process → créditos; folhas de contato
tools/e2e/       roteiro de aceite no navegador, medição de desempenho, capturas de tela
docs/            reaproveitamento do FigureBox, integrações, assets, decisões, verificação, produção, personagens
```

## Documentação

- [docs/figurebox-reuse.md](docs/figurebox-reuse.md): commit usado do FigureBox Planner, mapa do editor de origem, o que foi reaproveitado ou descartado, e licenças
- [docs/integrations.md](docs/integrations.md): variáveis, endpoints, contratos, o que é simulado e o que depende de ambiente real
- [docs/assets.md](docs/assets.md): curadoria, licenças, pipeline, rejeitados e pendentes. Manifesto completo em `public/assets/manifest.json`
- [docs/decisions.md](docs/decisions.md): decisões técnicas
- [docs/verification.md](docs/verification.md): resultado das verificações e da medição de desempenho
- [docs/production-gaps.md](docs/production-gaps.md): o que falta para produção
- [docs/avatars.md](docs/avatars.md): avatares (catálogo, persistência, pipeline, licenças, clipping, desempenho com 25 avatares, lacunas)
- [docs/characters-roadmap.md](docs/characters-roadmap.md): roteiro antigo de personagens, substituído pelos avatares

## Créditos

O editor reaproveita código do FigureBox Planner (commit `f478167`, do mesmo autor). Os modelos 3D são CC0 1.0 e CC-BY 3.0, de Poly Pizza, Kenney/OpenGameArt e Poly Haven; as texturas são CC0, do ambientCG. As atribuições exigidas estão em `public/assets/CREDITS.md` e na tela **Créditos** do produto. Os avatares usam recursos CC0 da comunidade MakeHuman, preparados com o MPFB2 (ferramenta GPL, não distribuída). A lista por arquivo está em `public/assets/avatars/CREDITS.md`.
