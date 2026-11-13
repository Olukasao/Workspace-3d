# Onde paramos (histórico para continuar de outro computador)

Atualizado em 12/11/2026. Este arquivo substitui a conversa: quem continuar (você ou o Claude) deve ler isto primeiro. Se for o Claude, peça: "leia docs/continuar.md e continue".

## O que é o projeto

**Office 3D**: planta do escritório em 3D. O administrador monta o andar num editor e publica revisões. Operadores navegam pela revisão publicada e usam chat, acesso remoto, transferência de atendimento, impressão e painéis. Cada colaborador tem um avatar 3D na mesa dele, animado pela presença ao vivo. Interface em pt-BR. Funciona em modo demonstração, sem nenhuma integração real.

É um projeto **independente**, que reaproveitou o editor do FigureBox Planner (commit `f478167`). O FigureBox Planner deve continuar **intacto**.

## Regras que valem sempre (do briefing original)

- Não implementar execução genérica de comandos, coleta de senhas nem conexão automática.
- Exibir somente dados profissionais autorizados.
- Segredos só no backend.
- Nunca enviar teclas, conteúdo ou nome da conversa ao escritório 3D. Não capturar, retransmitir nem transcrever a conversa.
- O cliente não publica atividade em nome de outro colaborador.
- O usuário autenticado edita só o próprio avatar (nem administrador edita o de outra pessoa).
- Leitura e eventos restritos à empresa e ao escopo autorizado.

## Estado atual

| Parte | Situação |
|---|---|
| Editor, operação, ações em demonstração, trilha, créditos | pronto |
| Construir a estrutura do zero (piso, parede, porta, janela, esticar parede) | pronto, `npm run e2e:draw` 7/7 |
| Paredes piscando nos cantos (z-fighting) | corrigido |
| Mesa com posição fixa (vincular colaborador à mesa) | pronto |
| Avatares personalizáveis (MakeHuman + MPFB) | pronto: editor "Meu avatar", persistência no servidor, 8 looks, poses por IK |
| Presença ao vivo (SSE): offline, online, digitando, em atendimento, fala | pronto, com sinais de demonstração para atendimento e fala |
| Testes automáticos (`npm test`) | 70/70, typecheck e lint limpos |
| `npm run e2e:avatars` | 9/9 na última rodada isolada |
| `npm run e2e:draw` | 7/7 |
| `npm run e2e` | 20/20 com o modo leve e tempo limite de 60 s (uma rodada; antes oscilava entre 17 e 18 de 20). Ver "Instabilidade do e2e" |
| Desempenho com 25 avatares | medido: 37 FPS (câmera próxima) e 49 (afastada) numa GPU integrada |
| Documentação | `README.md`, `docs/avatars.md`, `docs/integrations.md`, `docs/verification.md`, `docs/production-gaps.md` |

## Decisões tomadas (não refazer sem motivo)

- **Avatar ativo: MakeHuman + MPFB2 (Blender).** Foi avaliado trocar para o Quaternius (Universal Base Characters + Universal Animation Library, CC0, low-poly). **O usuário decidiu ficar com o MakeHuman + MPFB.** O Quaternius foi descartado e o download foi apagado. Se um dia voltar a ideia: os pacotes `[Standard]` gratuitos estão em https://quaternius.itch.io/universal-base-characters (122 MB) e https://quaternius.itch.io/universal-animation-library (15 MB).
- **MakeHuman/MPFB só existem na hora de gerar os modelos.** O produto distribui apenas `.glb` e `.webp` em `public/assets/avatars/` (21,6 MB, já no git). Roda em qualquer navegador com WebGL, inclusive dentro de um Electron. O MPFB é GPL e não é distribuído. Os modelos exportados são CC0.
- **Electron:** o usuário mencionou um app Electron, mas **não achei nenhum** nas pastas do computador do trabalho (`Documents/GitHub`, `Documents/Codex`, `Desktop/PROJECTA`, `Downloads/Projecta` e outras). Não existe empacotamento Electron neste projeto. Pendente: descobrir qual é o app, ou decidir empacotar o Office 3D.
- **Peças fora do catálogo:** camisetas e blusas casuais do pacote do sistema do MakeHuman têm o logotipo do MakeHuman estampado, e ficaram fora. `process.ts` só distribui o que está em `shared/avatarCatalog.ts`.
- **Esqueleto único por avatar, LOD0 a menos de 8 m, sem sombra no LOD1:** otimizações feitas depois da primeira medição com 25 avatares.

## Pendências (em ordem)

1. **Confirmar a estabilidade do `npm run e2e`**: rodar mais 2 ou 3 vezes seguidas. Passou 20/20 uma vez depois da correção abaixo.
2. **Descobrir o app Electron** do usuário (ver acima) e conferir como ele carrega `public/assets/avatars` e se a política de segurança (CSP) dele permite `.glb` e `.webp`.
3. **Fontes reais dos sinais de presença** (só quando houver acesso): digitação e presença do Workscape, ciclo de chamada e atividade de voz da telefonia (`CALL_PROVIDER`), barramento compartilhado para mais de um processo de servidor. Detalhes em `docs/integrations.md`.
4. **MariaDB nunca foi executado** (não havia nenhum na máquina do trabalho). O código e o SQL estão prontos.
5. Itens de produção em `docs/production-gaps.md`.

## Instabilidade do e2e (investigada em 13/11/2026)

**Sintoma:** `npm run e2e` falhava 2 ou 3 de 20, sempre com "tempo esgotado" ao clicar (Posto 01, aba Editor, aba Catálogo), em passos diferentes a cada rodada.

**Hipótese descartada:** os avatares. Sem avatares, o roteiro também falhou (17 de 20).

**Causa medida** (`node tools/e2e/probe-load.mjs [sessões] [--leve] [--sem-avatares]`): na renderização por software (SwiftShader) a cena completa roda a **1 a 4 quadros por segundo, mesmo com uma só sessão**. Com 3 sessões, um clique leva de 1 a 3 s, e o Playwright espera o elemento ficar "estável" (dois quadros iguais) antes de clicar. Não é defeito de lógica do produto.

| Sessões (software) | Cena completa | Modo leve |
|---|---|---|
| 1 | 0,9 quadro/s, clique 0,9 s | 4 quadros/s, clique 0,5 s |
| 3 | 0,7 a 2,2 quadros/s, clique 1,4 a 2,8 s | 1,7 a 3 quadros/s, clique 0,5 a 1,4 s |

**Correção:** o roteiro abre as páginas com `?leve` (sem sombras, sem antialias, dpr 1, definido em `src/three/Scene3D.tsx`) e usa tempo limite de 60 s. Resultado: **20/20 em 275 s**. Interruptores de teste: `?leve`, `?semAvatares` (também `E2E_SEM_AVATARES=1` no roteiro) e `?semInstancias`. O produto normal não muda.

**Não vale como medida de desempenho:** o FPS por software. As medidas de FPS usam GPU (`npm run perf`, `npm run perf:avatars`, `npm run e2e:avatars`).

## Como rodar em outro computador

Requisitos: Node 22.5 ou mais novo (testado no 24.19). Chrome ou Edge só para os testes de navegador.

```bash
git clone https://github.com/Olukasao/Workspace-3d.git
cd Workspace-3d
npm install
npm run db:reset     # banco local em data/office3d.sqlite, com dados fictícios
npm run dev          # API em :8787 e interface em :5173
```

Contas de demonstração (senha `demo1234`): `admin@demo.office3d.local`, `operador@demo.office3d.local`, `visualizador@demo.office3d.local`, `admin@outra.office3d.local`.

Verificações: `npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e`, `npm run e2e:draw`, `npm run e2e:avatars`, `npm run perf`, `npm run perf:avatars` (este exige `npm run build` antes).

### O que NÃO vai pelo git

- `.env` e `data/` (banco local, com o que você desenhar no editor): crie de novo com `cp .env.example .env` e `npm run db:reset`. **Se quiser levar a planta que desenhou, copie `data/office3d.sqlite` à parte.** Não apague `data/` sem copiar antes.
- `.build-tools/` (cerca de 2 GB): Blender 4.2.9 portátil, MPFB 2.0.18 e os pacotes de recursos do MakeHuman. **Só precisa disso para regerar os modelos dos avatares** (`npm run avatars:build`). Para usar o produto, os modelos já estão em `public/assets/avatars/`. Como reinstalar: `docs/avatars.md`, seção "Pipeline de assets". Os pacotes vêm de `https://files.makehumancommunity.org/asset_packs/<pacote>/<pacote>_cc0.zip` (`makehuman_system_assets`, `suits01`, `glasses01`, `bodyparts05`) e de `https://files.makehumancommunity.org/functional/visemes01.zip`.
- `assets-src/originals/` (modelos 3D originais): só é necessário para regerar o catálogo de móveis (`npm run assets:process`). Os resultados já estão em `public/assets/`.
- `node_modules/`, `dist/`, `test-results/`.

## Mapa do código

```
shared/          tipos, cena, mesa e assento, catálogo de avatares (usados por cliente e servidor)
server/          Express: auth, rascunho e publicação, vínculos, ações, trilha
  live.ts        presença ao vivo (LiveHub): conexões, tolerância, digitando, chamada
  routes/live.ts SSE, sinais, catálogo e aparência do avatar
src/three/avatar/  assets.ts (montagem das peças), rig.ts (poses por IK), Avatar.tsx (LOD e animação)
src/avatar/      "Meu avatar" e painel de presença de demonstração
src/live.ts      cliente da presença e sinal de digitação
tools/avatars/   build.py (Blender), process.ts, credits.ts, sheet.mjs (folhas de contato)
tools/e2e/       roteiros no navegador e medições
```

## Armadilhas já encontradas

- **Shell:** crases e aspas dentro de comandos `node -e` ou heredocs corromperam arquivos várias vezes. Para editar arquivos, use as ferramentas de edição, não `node -e` com texto longo.
- **Nunca rodar `rm -rf data`:** apaga o banco com a planta desenhada.
- **Dialog:** o foco inicial do `Dialog` (`src/ui.tsx`) só pode rodar na montagem. Se rodar a cada renderização do pai, tira o cursor do campo de mensagem a cada evento de presença e derruba o sinal de digitação.
- **Versão da presença:** parte do contador global (`seq`) e nunca regride. Se voltar a 0 depois de um `resync`, o cliente descarta os eventos como atrasados. Há teste.
- **GitHub:** o envio funciona por HTTPS com a conta do Git Credential Manager. A deploy key SSH gerada no computador do trabalho (`~/.ssh/workspace3d_deploy`) não foi usada e pode ser apagada.
