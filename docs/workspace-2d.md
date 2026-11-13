# Modo 2D e alternância global 2D/3D

O Workspace tem **dois ambientes para a mesma empresa: 3D e 2D**. O **administrador** escolhe qual deles está ativo para **todos** (Configurações → Ambiente virtual). Só um motor gráfico roda por vez. O que continua igual nos dois modos: login, usuários, permissões, chat, presença e diretório.

## Como funciona a troca global

1. O administrador abre **Configurações → Ambiente virtual**, escolhe 2D ou 3D e **confirma** num diálogo. `PUT /api/admin/workspace-mode` exige `{ mode, confirm: true }` e o papel de administrador (operador e visualizador recebem 403). Fica no log de auditoria (`workspace.mode`).
2. O modo vai para `company_settings` (`workspace_mode`): **sobrevive a reinício** e vale por empresa. O padrão é `3d`.
3. O servidor avisa todos os navegadores conectados pelo fluxo de presença que já existe (SSE `/api/live/stream`, evento `mode`, seguido de um `snapshot` novo). **Ninguém precisa recarregar.** Cada mudança tem uma versão crescente; eventos antigos ou repetidos são ignorados.
4. No navegador, o `WorkspaceManager` (`src/workspace/`) desmonta o motor atual, libera a memória e só então monta o outro. A sessão, o login e a tela atual são preservados; uma tela de transição cobre a troca.
5. Usuário novo, ou quem recarrega a página, **entra direto no modo configurado**: o app espera o servidor informar o modo antes de carregar qualquer motor (não baixa o 3D para depois trocar).

## Isolamento dos motores

| | 3D ativo | 2D ativo |
|---|---|---|
| Three.js / R3F / GLB / texturas 3D | carregados | **não baixados** (ou descartados na troca) |
| Phaser / sprites / spritesheets | **não baixados** | carregados |
| Canvas com `data-engine` | `three` | `phaser` |

- Pacotes separados (`vite.config.ts`, `manualChunks`): `vendor` (React etc.), `three` e `phaser`. A entrada (~97 KB) só pré-carrega `vendor`; `Mode3D` e `Mode2D` são `lazy`.
- Na saída do 3D: `disposeThreeWorld` (cache de modelos, avatares, texturas, geometrias, contexto WebGL). Na saída do 2D: `Game.destroy(true)` (loop, entrada, texturas, canvas) e cancelamento das inscrições de tempo real.
- **Conferir pelo DevTools:** no console, `window.__workspace.report()` devolve `activeEngines`, `phaserGames`, `canvases`, `threeDiagnostics`, `liveHandlers2d` e os contadores de início/parada. Na aba Network, em 2D não aparece nenhum `.glb`/`three`; em 3D não aparece `phaser`.
- `npm run e2e:workspace` automatiza essas conferências (inclusive 3 ciclos 2D ⇄ 3D sem vazamento).

## Escritório 2D (jogar)

- Phaser 3 + React: o Phaser cuida do mapa e dos personagens; o React só desenha os painéis (lista de pessoas, seu estado, cartão da pessoa). Não há re-render do React a cada passo.
- Mapa em formato **Tiled** (JSON). O layout é guardado como `Layout2D` (grade de 32 px: piso, paredes, móveis, salas, entradas, estações) e pode ser exportado como `.tmj` (`GET /api/admin/office2d/:id/tiled`).
- Visão de cima em 3/4. Pixel art original pintada por código (26 móveis, personagens em camadas) e, onde o tamanho bate, o pacote Office Pixel Art (ver Decisões). Nada do Habbo ou do Gather.
- Controles: WASD/setas, clique no chão (caminho A*), **E** ou clique na mesa ou numa cadeira solta (reunião, copa) para sentar/levantar: em cadeira solta a pessoa fica virada para o lado da cadeira, e qualquer um pode usá-la, clique numa pessoa para o cartão e **Conversar**, roda do mouse ou +/− para zoom. Colisão com paredes e móveis; profundidade por linha (quem está atrás aparece atrás).
- Pinça no celular **não foi implementada** (use os botões +/−).

### Estados, só a partir de eventos reais

`online`, `working`/`em atendimento` (sentado numa estação), `in_call` (headset), `digitando` (só o fato de estar digitando, nunca o conteúdo), `ausente` (botão ou 5 min sem atividade) e `offline` (some do mapa). A prioridade é offline > em ligação > digitando > ausente > online, igual ao 3D. Nada é inventado: quem não tem sinal real aparece como online.

Regras do briefing mantidas: nenhuma tecla, texto ou nome de conversa vai para o escritório; o cliente não publica atividade em nome de outra pessoa; só vê presença quem tem permissão e só da própria empresa.

### Multijogador

- O **servidor é a autoridade** (`server/office2d.ts`): velocidade máxima 150 px/s (mais folga), caminho livre a cada 8 px, intervalo mínimo de 40 ms, regras de sentar (perto, livre ou sua, caminho livre). Posição inválida é **corrigida** e o cliente volta para a posição aceita.
- O cliente propõe a própria posição no máximo 10 vezes por segundo; o servidor junta as posições e envia em lotes de 100 ms (evento `p2d`), só para quem pode ver a presença da empresa. Os outros personagens são **interpolados** no cliente.
- **Quem aparece no mapa:** fora da demonstração, só quem está com o Workspace (chat interno) aberto (ver `docs/integrations.md`, "Sinal Workspace aberto"). O vínculo com o chat ainda não existe: enquanto isso ninguém aparece fora da demonstração.
- **Em atendimento:** quem não está na própria mesa vai direto para o computador e senta (o servidor leva a pessoa por um caminho livre). Quem já está na mesa, ou não tem mesa designada, fica onde está.
- Quem está online entra sozinho no escritório 2D por uma entrada livre (sem empilhar nomes) e, se tem mesa designada, o **servidor o leva andando até ela** (caminho livre, 80 px/s) e a pessoa **senta na cadeira que já está no cenário**. Se a pessoa se mexer ou pedir para sentar, assume o controle na hora. Sem mesa designada, fica em pé na entrada. Quem fica offline sai.

## Editor 2D (administrador)

Editor → no modo 2D abre o editor do layout: pintar piso, paredes, apagar, colocar/mover/girar/remover móveis (26 do catálogo), definir entradas, vincular colaborador a cada estação. **Salvar rascunho** (com versão-base: 409 se outro administrador salvou antes) e **Publicar**: todos os conectados recebem o layout novo ao vivo (as pessoas que estavam num lugar que deixou de existir são realocadas; vínculos de estações removidas caem). Toda mesa com computador vira uma estação automaticamente. O servidor valida o layout inteiro (`validateLayout`) antes de gravar: limites, sobreposição, móvel sobre parede, estações com lugar para sentar.

**TV na parede:** a TV, o quadro branco e o quadro podem ficar sobre a parede, e as paredes externas aparecem com duas alturas. Clicar numa TV abre a área de dispositivos (busca e lista, como o catálogo do AnyDesk) para escolher qual gerenciar por AnyDesk ou RustDesk (ver `docs/integrations.md`, "TV do escritório 2D"); no editor, o administrador define qual dispositivo vem marcado em cada TV. **A impressora funciona igual:** clicar nela abre a lista de impressoras do inventário para escolher e enviar um PDF para a fila da escolhida (ver `docs/integrations.md`, "Impressora do escritório 2D").

**Mesas e cadeiras por pessoa:** Configurações → *Mesas e cadeiras (2D)* lista cada pessoa com a mesa dela (a cadeira é a da mesa); cada escolha vale na hora, sem publicar o layout. Escolher a mesa de outra pessoa a passa para a nova dona. No editor também dá para vincular por mesa.

Vínculo de pessoas às estações 2D fica em tabela própria (`seat2d_assignments`), separado das mesas do 3D.

## Avatar 2D (Universal LPC, padrão)

"Meu avatar" no modo 2D funciona como o gerador do **Universal LPC Spritesheet Character Generator** (quadros de 64×64): prévia animada (andar, parado, sentado, digitando, falando) nas quatro direções e categorias com as peças em miniatura e as cores:

- **Corpo:** masculino ou feminino; 7 tons de pele.
- **Cabeça e rosto:** 7 cabeças (adulto, idoso, pequena, magra), 8 cores de olhos, 12 expressões, sobrancelhas, nariz.
- **Cabelo e barba:** 44 cabelos, 8 barbas e bigodes, 26 cores de cabelo.
- **Roupa:** 21 partes de cima, macacão e suspensório, 5 peças de pescoço (gravata, laço, colares), 4 de luvas e pulseiras; 24 cores.
- **Pernas e pés:** 10 calças, bermudas e saias, 6 calçados, 2 meias; 24 cores.
- **Chapéus:** 12 (bonés, capuz, hijab, lenços, tiaras) com cores.
- **Acessórios:** óculos e headset.

Animações no escritório: andar (8 passos), parado, sentado, digitando, falando (em pé e sentado) e com headset. A cor é aplicada por paleta em tempo de execução (cor da rampa do pacote → cor escolhida), sem alterar os desenhos.

- A configuração é guardada por colaborador (estilo `sprite2d`, campo `look: 'lpc'`) e fica **separada da aparência 3D**. Cada colaborador só edita o próprio avatar. O servidor valida todos os campos contra o catálogo gerado (`shared/avatarLpc.generated.ts`).
- Aparências antigas (sem `look`, do personagem pequeno 32×32) continuam válidas e aparecem como antes; ao abrir o editor viram a aparência LPC padrão.
- As imagens das peças só são baixadas quando alguém as usa (≈5 MB no total em `public/assets/lpc`); sem elas o 2D mostra o personagem pequeno.
- **Licença:** só entram peças que oferecem OGA-BY 3.0, CC-BY 3.0/4.0 ou CC0 (atribuição). Nada de CC-BY-SA ou GPL. Autores na tela Créditos e em `public/assets/lpc/CREDITS.md`.
- **Acrescentar ou trocar peças:** `git clone --depth 1 https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator.git <pasta>`, editar a lista `CURATED` em `tools/lpc/build.mjs` e rodar `LPC_REPO=<pasta> node tools/lpc/build.mjs`: baixa só o que usamos, confere a licença e regera o catálogo, os créditos e o arquivo compartilhado.

## Banco de dados

- `server/migrations/004_office2d.sql` (nova; só cria tabelas, não altera nem apaga dados existentes): `office2d_layouts` (rascunho e publicado, por empresa e andar, com versão) e `seat2d_assignments`.
- `workspace_mode` e o estilo `sprite2d` usam tabelas que já existiam (`company_settings`, `avatar_choices`).
- Posição 2D e layout 2D **não** se misturam com o 3D: cada modo guarda o seu.

## Decisões e diferenças em relação ao briefing

- **Socket.IO não foi adicionado.** O briefing aceita "a infraestrutura existente": o projeto já tem tempo real por SSE com reconexão, versão e ressincronização, e as posições vão por `POST` validado no servidor. Menos uma dependência, mesma garantia.
- **Personagens:** Universal LPC (padrão) e, para aparências antigas, o pacote Customizable Character Pack (Ordinary Bumblebee, CC0).
- **Móveis extras:** sofás, balcão de recepção, forno, balcão da copa, som e caixa de som do Crimelike Furniture (extradave, CC0), em `public/assets/furniture-crimelike/`.
- **Arte mista.** Móveis, paredes e personagens são pixel art original pintada por código. Mesa, computador, cadeira, arquivo, 2 plantas, bebedouro e 3 pisos vêm do pacote gratuito **Office Pixel Art (Imersa Studios)**, usado sem alteração em `public/assets/office-pixel/`, com crédito na tela Créditos e autorização de redistribuição por escrito em `docs/licencas/imersa-office-pixel-art.md`. Se o pacote não carregar, a arte pintada assume (`src/workspace/modes/mode2d/art/pack.ts`). O pacote Modern Home (Chucky Assets) **não** foi incluído: a licença proíbe redistribuir.
- **Pinça em telas de toque:** não feita.
- **Colegas simulados:** no modo demonstração, os colegas simulados aparecem no 2D com os mesmos sinais de presença que já existiam; em produção só entram pessoas realmente conectadas.
- Padrão do ambiente: 3D (nenhuma mudança para quem já usava).

## Arquivos principais

- Compartilhados: `shared/workspace.ts`, `shared/office2d.ts`, `shared/office2dDefault.ts`, `shared/avatar2d.ts`.
- Servidor: `server/office2d.ts`, `server/routes/workspace.ts`, `server/live.ts` (modo, ausência, lotes), `server/migrations/004_office2d.sql`.
- Cliente: `src/workspace/` (gerente, motor, modos 2D e 3D), `src/admin/SettingsPage.tsx`, `src/live.ts`.
- Testes: `tests/office2d.test.ts`, `tests/workspace.test.ts`, `tools/e2e/workspace.mjs`.
