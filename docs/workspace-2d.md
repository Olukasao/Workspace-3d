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
- Visão de cima em 3/4. Pixel art original pintada por código (22 móveis, personagens em camadas) e, onde o tamanho bate, o pacote Office Pixel Art (ver Decisões). Nada do Habbo ou do Gather.
- Controles: WASD/setas, clique no chão (caminho A*), **E** ou clique na mesa para sentar/levantar, clique numa pessoa para o cartão e **Conversar**, roda do mouse ou +/− para zoom. Colisão com paredes e móveis; profundidade por linha (quem está atrás aparece atrás).
- Pinça no celular **não foi implementada** (use os botões +/−).

### Estados, só a partir de eventos reais

`online`, `working`/`em atendimento` (sentado numa estação), `in_call` (headset), `digitando` (só o fato de estar digitando, nunca o conteúdo), `ausente` (botão ou 5 min sem atividade) e `offline` (some do mapa). A prioridade é offline > em ligação > digitando > ausente > online, igual ao 3D. Nada é inventado: quem não tem sinal real aparece como online.

Regras do briefing mantidas: nenhuma tecla, texto ou nome de conversa vai para o escritório; o cliente não publica atividade em nome de outra pessoa; só vê presença quem tem permissão e só da própria empresa.

### Multijogador

- O **servidor é a autoridade** (`server/office2d.ts`): velocidade máxima 150 px/s (mais folga), caminho livre a cada 8 px, intervalo mínimo de 40 ms, regras de sentar (perto, livre ou sua, caminho livre). Posição inválida é **corrigida** e o cliente volta para a posição aceita.
- O cliente propõe a própria posição no máximo 10 vezes por segundo; o servidor junta as posições e envia em lotes de 100 ms (evento `p2d`), só para quem pode ver a presença da empresa. Os outros personagens são **interpolados** no cliente.
- Quem está online entra sozinho no escritório 2D (na estação vinculada, sentado, ou numa entrada livre, sem empilhar nomes); quem fica offline sai.

## Editor 2D (administrador)

Editor → no modo 2D abre o editor do layout: pintar piso, paredes, apagar, colocar/mover/girar/remover móveis (22 do catálogo), definir entradas, vincular colaborador a cada estação. **Salvar rascunho** (com versão-base: 409 se outro administrador salvou antes) e **Publicar**: todos os conectados recebem o layout novo ao vivo (as pessoas que estavam num lugar que deixou de existir são realocadas; vínculos de estações removidas caem). Toda mesa com computador vira uma estação automaticamente. O servidor valida o layout inteiro (`validateLayout`) antes de gravar: limites, sobreposição, móvel sobre parede, estações com lugar para sentar.

Vínculo de pessoas às estações 2D fica em tabela própria (`seat2d_assignments`), separado das mesas do 3D.

## Avatar 2D

"Meu avatar" no modo 2D: pele (6), cabelo (9 estilos, 8 cores), barba, parte de cima (5), parte de baixo (3), calçado (3), cores de cada peça, óculos e headset. Animações: parado, andando, sentado, digitando, falando (em pé e sentado) e com headset. A configuração é salva por colaborador (estilo `sprite2d`) e **separada da aparência 3D**. Cada colaborador só edita o próprio avatar.

Para acrescentar uma peça: incluir o id em `shared/avatar2d.ts` e a função de pintura em `src/workspace/modes/mode2d/art/characters.ts`. O motor do personagem não muda.

## Banco de dados

- `server/migrations/004_office2d.sql` (nova; só cria tabelas, não altera nem apaga dados existentes): `office2d_layouts` (rascunho e publicado, por empresa e andar, com versão) e `seat2d_assignments`.
- `workspace_mode` e o estilo `sprite2d` usam tabelas que já existiam (`company_settings`, `avatar_choices`).
- Posição 2D e layout 2D **não** se misturam com o 3D: cada modo guarda o seu.

## Decisões e diferenças em relação ao briefing

- **Socket.IO não foi adicionado.** O briefing aceita "a infraestrutura existente": o projeto já tem tempo real por SSE com reconexão, versão e ressincronização, e as posições vão por `POST` validado no servidor. Menos uma dependência, mesma garantia.
- **Arte mista.** Móveis, paredes e personagens são pixel art original pintada por código. Mesa, computador, cadeira, arquivo, 2 plantas, bebedouro e 3 pisos vêm do pacote gratuito **Office Pixel Art (Imersa Studios)**, usado sem alteração em `public/assets/office-pixel/`, com crédito na tela Créditos e autorização de redistribuição por escrito em `docs/licencas/imersa-office-pixel-art.md`. Se o pacote não carregar, a arte pintada assume (`src/workspace/modes/mode2d/art/pack.ts`). O pacote Modern Home (Chucky Assets) **não** foi incluído: a licença proíbe redistribuir.
- **Pinça em telas de toque:** não feita.
- **Colegas simulados:** no modo demonstração, os colegas simulados aparecem no 2D com os mesmos sinais de presença que já existiam; em produção só entram pessoas realmente conectadas.
- Padrão do ambiente: 3D (nenhuma mudança para quem já usava).

## Arquivos principais

- Compartilhados: `shared/workspace.ts`, `shared/office2d.ts`, `shared/office2dDefault.ts`, `shared/avatar2d.ts`.
- Servidor: `server/office2d.ts`, `server/routes/workspace.ts`, `server/live.ts` (modo, ausência, lotes), `server/migrations/004_office2d.sql`.
- Cliente: `src/workspace/` (gerente, motor, modos 2D e 3D), `src/admin/SettingsPage.tsx`, `src/live.ts`.
- Testes: `tests/office2d.test.ts`, `tests/workspace.test.ts`, `tools/e2e/workspace.mjs`.
