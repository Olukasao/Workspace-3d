# Resultado das verificações

Executadas em 12/11/2026 no ambiente descrito no fim deste documento. Os relatórios brutos ficam em `test-results/` (gerados de novo a cada execução).

| Verificação | Comando | Resultado |
|---|---|---|
| Tipagem (estrita) | `npm run typecheck` | ✅ sem erros |
| Lint | `npm run lint` | ✅ sem erros |
| Testes de cena, editor, desenho, API e presença | `npm test` | ✅ **70/70** (cena 8 · operações do editor 12 · desenho livre 6 · API 32 · presença e avatares 12) |
| Aceite no navegador real | `npm run e2e` | ✅ **20/20**, 0 erros de página (Chromium 157) |
| glTF Validator (Khronos) | `npm run assets:validate` | ✅ 52 modelos, **0 erros**, 4 avisos (espaço tangente gerado) |
| Construir a estrutura do zero | `npm run e2e:draw` | ✅ **7/7** (plano vazio → piso arrastado → 4 paredes ponto a ponto → janela e porta → esticar parede → publicar) |
| Build de produção | `npm run build` | ✅ (blocos: app 231 KB, r3f 387 KB, three 684 KB; gzip 71 + 125 + 176 KB) |
| Desempenho com 25 avatares | `npm run perf:avatars` | ✅ 37 FPS de mediana com a câmera próxima e 49 com ela afastada, 160 texturas na GPU (ver [avatars.md](avatars.md#desempenho-com-25-avatares-npm-run-perfavatars)) |
| Clipping dos avatares | `npm run avatars:sheet` | ✅ 8 looks × 6 poses conferidos; 2 problemas corrigidos e 1 aceito (ver [avatars.md](avatars.md#validação-de-clipping)) |
| Produção sob CSP | `npm run build && npm start` + navegador | ✅ sem violações no console; asset inexistente → 404 |
| Caminho local | `npm run db:reset` e `npm run dev` | ✅ migração + seed; API, Vite e proxy respondendo |
| MariaDB | — | ⚠️ **não executado**: não há MariaDB nesta máquina. Driver e SQL portáteis implementados |

## Fluxos verificados no navegador (`tools/e2e/run.mjs`)

Cada perfil usa uma sessão de navegador separada, e as ações passam pela interface:

1. Modelo faltante (GLB bloqueado): a cena mostra o substituto visual e continua utilizável.
2. O administrador abre o editor com o rascunho e o catálogo.
3. **Adicionar mesa e monitor:** o monitor entra sobre o tampo como filho da mesa.
4. **Mover o conjunto:** arraste real com o mouse na cena 3D; a mesa se desloca 0,66 m e o monitor continua filho dela.
5. **Trocar a TV mantendo o vínculo:** `tv_noc_01` passa de tv-painel para tv-parede; **desfazer** e **refazer** (Ctrl+Z / Ctrl+Y).
6. **Salvar, recarregar** a página e reencontrar tudo (rascunho v2).
7. **Publicar** (revisão 2).
8. **Outra sessão (operador)** vê a revisão 2, com a mesa, o monitor e a TV trocada.
9. A TV trocada mantém o dispositivo (PLAYER-NOC-01) e o painel; o painel autorizado abre sinalizado como simulação.
10. **Bloqueio de edição do operador:** sem aba Editor, a rota `#/editor` é ignorada e a API devolve 403 para GET e PUT do rascunho.
11. **Mesa vaga:** chat e transferência desabilitados, com o motivo.
12. Chat de demonstração: a conversa abre com o selo "Simulação (demonstração)".
13. **Duplo clique em transferência:** 1 transferência na trilha.
14. **Duplo clique em impressão + arquivo inválido:** .xlsx recusado; 1 trabalho só; na fila → envio confirmado → conclusão reportada.
15. **Provedor indisponível:** com o chat fora, aparece o aviso, o mapa e a lista seguem funcionando, só o chat fica "Indisponível" e a transferência continua disponível.
16. Visualizador: vê os dados profissionais e todas as ações aparecem como "Sem permissão".
17. **Usuário de outra empresa:** não vê o mapa; a API devolve 404 para a visão operacional e para o rascunho.
18. **Conflito entre dois editores:** o segundo recebe o aviso e a gravação do primeiro é preservada.
19. Upload de arquivo que não é GLB: recusado com mensagem clara.
20. Trilha: ator, alvo, resultado, modo e correlação para publicação, chat, transferência, impressão, painel e rascunho.

Os testes de API cobrem também:

- 6 pedidos simultâneos de chat resultam numa única conversa.
- Chave de idempotência reutilizada com outro conteúdo é recusada; versão desatualizada do atendimento devolve `ticket_changed`.
- Destino que não recebe transferências e o próprio posto são recusados.
- PDF acima do limite e GLB com recurso externo são recusados.
- Deduplicação de upload por hash sem misturar licenças; arquivo enviado não é servido a outra empresa.
- Retenção: o PDF sai do disco ao concluir.
- Cena com ciclo de parentesco é recusada.
- Objeto removido, colaborador desligado e dispositivo removido aparecem como vínculos **órfãos**.
- Acesso remoto real devolve endereço e comando; o link `anydesk:` só sai com `ANYDESK_LAUNCH=uri`.
- Modo demonstração não devolve endereço.

## Desempenho: 100 objetos repetidos (`npm run perf`)

Cena inicial + **100 cadeiras de escritório idênticas** (201 objetos). Servidor de produção, cache HTTP vazio em cada medida, câmera girando durante a amostragem.

| Modo | Pronto | FPS mediana (mín.) | Draw calls | Triângulos | Geometrias / texturas na GPU | Heap JS | Peso inicial |
|---|---|---|---|---|---|---|---|
| Operação, **instanciamento ligado** | 2,2 s | 60 (57) | **256** | 303 mil | 258 / 22 | 26 MB | 2,98 MB (modelos 1,56 MB, texturas 97 KB) |
| Operação, instanciamento desligado | 2,1 s | 60 (44) | 626 | 303 mil | 258 / 22 | 41 MB | 2,98 MB |
| Editor (sem instanciamento, objetos arrastáveis) | 1,9 s | 57 (33) | 795 | 309 mil | 458 / 18 | 61 MB | 3,07 MB |

Leitura:

- **Instanciamento:** corta 59% dos draw calls (626 → 256) e eleva o FPS mínimo de 44 para 57.
- **Compartilhamento entre instâncias:** o número de geometrias na GPU não cresce com as 100 cadeiras (todas apontam para a mesma geometria).
- **Primeira medição descartada:** colocou as cadeiras fora do enquadramento e rodou no servidor de desenvolvimento, com cache aquecido. Foi corrigida antes destes números.

**Ambiente de medição:** Windows 11 Pro (10.0.26300), AMD Ryzen 5 5600G (12 threads), 7 GB de RAM utilizáveis, GPU integrada AMD Radeon (ANGLE/Direct3D11), Chromium 157 headless com GPU, viewport 1440×900, Node 24.19.

Os testes de aceite rodam com renderização por software (SwiftShader). Por isso o FPS de lá não serve como medida.

## Construção livre da estrutura (`npm run e2e:draw`)

No navegador real, com o mouse: esvazia o rascunho, arrasta um piso de 8 × 6 m (madeira), desenha 4 paredes clicando nos cantos e fecha o contorno no primeiro ponto, clica uma janela e uma porta nas paredes, estica a parede norte de 8 para 10 m pelo puxador da ponta, desfaz e refaz, salva, publica e confere a estrutura na sessão do operador.

## Correção: paredes piscando nos cantos

**Relato:** ao afastar o zoom e arrastar a câmera, as paredes piscavam nos cantos.

**Causa:** *z-fighting*. A tampa de cada parede terminava no mesmo plano do topo do corpo, e nos cantos as pontas das paredes se sobrepõem com faces coplanares. A precisão de profundidade cai com o zoom afastado (`near` de 0,1).

**Correção:**
- tampa acima do corpo;
- folga fixa de poucos milímetros por parede, derivada do ID;
- `near` da câmera em perspectiva de 0,1 para 0,5;
- piso, grade e chão em planos separados;
- histerese de 30 cm no abaixamento das paredes.

**Validação:** comparação visual do canto ampliado, antes e depois. Antes, a quina e o topo aparecem quebrados em tracinhos. Depois, a quina é contínua. Uma métrica automática de pixels isolados foi tentada e **não discriminou** (diferença de 1,4%, dominada por linhas finas legítimas), então não é usada como prova.

**Observação sobre estabilidade:** `npm run e2e` falhou em 3 execuções seguidas no passo do conflito entre editores (clique na aba Editor da segunda sessão, por tempo esgotado) e depois passou 20/20 em 2 execuções seguidas, sem mudança de código entre elas. A causa não foi identificada. A suspeita é carga de CPU, porque o roteiro mantém até 3 sessões renderizando por software (SwiftShader). O roteiro agora grava captura de tela e o log completo quando algo falha.

