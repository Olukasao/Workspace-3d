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
| Avatares: **Ara 3D Gen (padrão)** e MakeHuman + MPFB (desativado) | pronto: **editor completo do Ara** (Montar e Detalhado, 200+ controles em português, prévia 3D ao vivo, 16 personagens prontos como ponto de partida), o servidor gera o modelo ao salvar, escolha do estilo pelo admin em Configurações (ao vivo, por empresa), persistência por colaborador e estilo, poses por IK |
| Presença ao vivo (SSE): offline, online, digitando, em atendimento, fala | pronto, com sinais de demonstração para atendimento e fala |
| **Modo 2D + troca global 2D/3D pelo admin** | pronto: ver `docs/workspace-2d.md`. Escritório 2D em Phaser com servidor autoritativo, editor de layout, avatar 2D em camadas, `npm run e2e:workspace` |
| Testes automáticos (`npm test`) | 123/123, typecheck e lint limpos |
| `npm run e2e:avatars` | 10/10 (inclui a troca de estilo pelo admin) |
| `npm run e2e:ara-editor` | 8/8, em desenvolvimento e na versão compilada (`E2E_PROD=1`) |
| `npm run e2e:draw` | 7/7 |
| `npm run e2e` | 20/20 com o modo leve e tempo limite de 60 s (uma rodada; antes oscilava entre 17 e 18 de 20). Ver "Instabilidade do e2e" |
| Desempenho com 25 avatares | Ara: 25 a 32 FPS (câmera próxima, mín. 5 a 8) e 30 a 35 (afastada); MakeHuman: 37 e 49. O Ara é mais pesado (ver docs/avatars-ara.md) |
| Documentação | `README.md`, `docs/avatars.md`, `docs/integrations.md`, `docs/verification.md`, `docs/production-gaps.md` |

## Decisões tomadas (não refazer sem motivo)

- **Modo 2D (briefing "Workspace 3D: modo 2D com alternância global administrativa"):** o administrador escolhe 2D ou 3D para toda a empresa; só um motor gráfico por vez; o inativo nem é baixado. Tempo real pelo SSE que já existia (**sem Socket.IO**, aceito pelo briefing), pixel art original pintada por código, padrão continua 3D, vínculos de estação 2D em tabela própria. O app **espera o servidor informar o modo** antes de montar qualquer motor. Detalhes em `docs/workspace-2d.md`.

- **Estilo de avatar ativo: Ara 3D Gen. O MakeHuman + MPFB2 fica guardado e desativado**, e o administrador escolhe entre os dois em Configurações. O usuário rejeitou o visual do MakeHuman e pediu o Ara 3D Gen "no lugar do atual", mantendo o atual salvo. Foi avaliado antes o Quaternius (Universal Base Characters), descartado. O **bobba_client não foi integrado**: os avatares dele são do Habbo (copyright da Sulake, e o projeto nem os inclui) e o código é GPL-3.0.
- **Editor completo do Ara:** o usuário pediu que a edição fosse "igual a da Ara, com diversos tipos de personalizar" (a primeira versão era só uma galeria de personagens prontos). Agora o estilo Ara tem editor completo. O corpo base continua sendo o do MakeHuman (mesmo pacote CC0): muda o gerador, as roupas procedurais, os sapatos e o formato. Se o visual ainda desagradar, a saída é outra fonte de assets, de outro estilo (cartoon, low-poly, pixel isométrico original).
- **Parâmetros, não arquivos:** o servidor guarda os parâmetros do personagem, valida com uma lista permitida de escritório (sem armas, fantasias, biquíni, tatuagens; só 18+; sempre vestido) e **gera o modelo ele mesmo**. O cliente nunca envia modelo 3D. Ver `docs/avatars-ara.md`, seção "Como funciona".
- **`vendor/ara3d`:** cópia sem alterações do núcleo do Ara 3D Gen (MIT) mais os dados CC0 em `public/assets/ara-data` (50 MB). Roda no servidor (thread própria) e no navegador (worker da prévia). Está no git, então o produto roda sem o clone do Ara.
- **Defeito do Ara no Windows:** o `setup-assets` dele gera `targets.pack` vazio no Windows (barras invertidas nas chaves), e todos os personagens saem com o mesmo corpo. Corrigido no clone local e documentado em `vendor/ara3d/UPSTREAM.md` e `docs/avatars-ara.md`.
- **MakeHuman/MPFB só existem na hora de gerar os modelos.** O produto distribui apenas `.glb` e `.webp` em `public/assets/avatars/` (21,6 MB, já no git). Roda em qualquer navegador com WebGL, inclusive dentro de um Electron. O MPFB é GPL e não é distribuído. Os modelos exportados são CC0.
- **Electron:** o usuário mencionou um app Electron, mas **não achei nenhum** nas pastas do computador do trabalho (`Documents/GitHub`, `Documents/Codex`, `Desktop/PROJECTA`, `Downloads/Projecta` e outras). Não existe empacotamento Electron neste projeto. Pendente: descobrir qual é o app, ou decidir empacotar o Office 3D.
- **Peças fora do catálogo:** camisetas e blusas casuais do pacote do sistema do MakeHuman têm o logotipo do MakeHuman estampado, e ficaram fora. `process.ts` só distribui o que está em `shared/avatarCatalog.ts`.
- **Esqueleto único por avatar, LOD0 a menos de 8 m, sem sombra no LOD1:** otimizações feitas depois da primeira medição com 25 avatares.

## Pendências (em ordem)

0. **2D:** pinça (zoom por toque) não feita; instalar mais móveis e decoração 2D com licença que permita redistribuir (feito em parte, ver docs/workspace-2d.md); arte pode ganhar mais variedade (mais móveis e roupas); falta teste manual em celular. O estilo do avatar 3D (Integrações → agora **Configurações**) continua valendo só para o modo 3D.

1. **Confirmar a estabilidade do `npm run e2e`**: rodar mais 2 ou 3 vezes seguidas. Passou 20/20 uma vez depois da correção abaixo.
2. **Limpeza dos modelos gerados:** ficam em `data/avatar-models` e nunca são apagados (3 a 5 MB por edição). Falta uma rotina que apague os que nenhum avatar salvo usa. Com mais de um servidor, o armazenamento precisa ser compartilhado. Também não há regeneração automática se a pasta sumir. Ver `docs/avatars-ara.md`, "Lacunas".
   **Desempenho do estilo Ara:** é mais pesado que o MakeHuman (ver `docs/avatars-ara.md`, "Como melhorar": atlas de materiais, texturas compartilhadas, cache).
3. **Descobrir o app Electron** do usuário (ver acima) e conferir como ele carrega `public/assets/avatars` e se a política de segurança (CSP) dele permite `.glb` e `.webp`.
4. **Fontes reais dos sinais de presença** (só quando houver acesso): digitação e presença do Workscape, ciclo de chamada e atividade de voz da telefonia (`CALL_PROVIDER`), barramento compartilhado para mais de um processo de servidor. Detalhes em `docs/integrations.md`.
5. **MariaDB nunca foi executado** (não havia nenhum na máquina do trabalho). O código e o SQL estão prontos.
6. Itens de produção em `docs/production-gaps.md`.

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
- `.build-tools/` (cerca de 3 GB): `ara3d/` (clone do Ara 3D Gen com seus dados, 1,2 GB; **só para regerar a galeria de 16 personagens prontos**, `npm run avatars-ara:build`), `ara-raw/` (GLB brutos) e, do estilo MakeHuman, Blender 4.2.9 portátil, MPFB 2.0.18 e os pacotes de recursos (`npm run avatars:build`). **O editor e o servidor não precisam disso:** o gerador está em `vendor/ara3d` e os dados em `public/assets/ara-data`. Como reinstalar o clone do Ara: `docs/avatars-ara.md`, seção "Pipeline" (`git clone https://github.com/olatunde85/3d-gen.git .build-tools/ara3d`, `npm install`, `npm run setup-assets`, e a correção do Windows).
- `assets-src/originals/` (modelos 3D originais): só é necessário para regerar o catálogo de móveis (`npm run assets:process`). Os resultados já estão em `public/assets/`.
- `node_modules/`, `dist/`, `test-results/`.

## Mapa do código

```
shared/          tipos, cena, mesa e assento, catálogo de avatares, parâmetros do estilo Ara (araCustom, avatarAra, araLabels, araCatalog.generated)
server/          Express: auth, rascunho e publicação, vínculos, ações, trilha
  live.ts        presença ao vivo (LiveHub): conexões, tolerância, digitando, chamada
  routes/live.ts SSE, sinais, catálogo e aparência do avatar
src/three/avatar/  assets.ts (peças do MakeHuman), ara.ts (modelos do Ara), rig.ts (poses por IK), Avatar.tsx (LOD e animação)
src/avatar/ara/  editor completo do estilo Ara (AraEditor, controles, worker da prévia)
server/araGen.ts, araWorker.ts  geração dos modelos 3D dos personagens personalizados
vendor/ara3d/    núcleo do Ara 3D Gen (MIT), sem alterações
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
