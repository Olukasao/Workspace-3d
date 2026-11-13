# Integrações

Toda integração passa por um **contrato** em `server/providers/types.ts` e tem dois adaptadores: um de **demonstração** (simulado, com dados fictícios, em `server/providers/demo.ts`) e um ponto de encaixe para o **serviço real** (`server/providers/real.ts`). Quem escolhe o adaptador é a variável de ambiente. A interface conversa só com o contrato e mostra o modo (`demo` ou `real`) em cada resultado.

Princípios aplicados a todas:

- **O servidor decide.** O estado de cada ação (disponível, não configurado, sem permissão, indisponível) é calculado em `server/office.ts` e recalculado no momento da execução (`requireAction`). O cliente nunca é a fonte de verdade.
- O alvo de cada ação vem do **vínculo gravado pelo ID estável do objeto** (`integration_bindings`, `seat_assignments`), nunca do nome da malha nem do modelo visual.
- Todas as consultas levam o `company_id` da sessão. Um ID de outra empresa recebe 404.
- **Segredos só no backend** (`.env`). O navegador nunca recebe token de serviço.
- Toda ação vai para a **trilha** (`action_audit`) com ator, alvo, horário, resultado, modo e identificador de correlação (cabeçalho `X-Correlation-Id`).
- Se um provedor cair, o mapa, a lista, a busca e a edição continuam funcionando. Só a ação afetada mostra "Indisponível".

## Variáveis

| Variável | Valores | Efeito |
|---|---|---|
| `DEMO_MODE` | `true` / `false` | `true` cria contas e dados fictícios e libera "Simular falha" e painéis em `/demo/…` |
| `CHAT_PROVIDER` | `demo` / `workscape` | Chat e presença |
| `TRANSFER_PROVIDER` | `demo` / `workscape` | Transferência de atendimento |
| `REMOTE_PROVIDER` | `demo` / `anydesk` | Acesso remoto |
| `ANYDESK_LAUNCH` | `manual` / `uri` | `manual` mostra o endereço autorizado; `uri` também devolve o link `anydesk:` (depois de validado) |
| `PRINT_PROVIDER` | `demo` / `ipp` / `none` | Envio direto à impressora (o diálogo do navegador sempre existe) |
| `WORKSCAPE_BASE_URL`, `WORKSCAPE_TOKEN` | — | Reservadas para o adaptador Workscape |
| `WORKSPACE_PRESENCE_TOKEN` | vazio | Segredo do sinal "Workspace aberto" (ver a seção abaixo); vazio desliga a recepção |
| `DASHBOARD_ALLOWED_HOSTS` | lista de hosts | Painéis de TV `https://` permitidos (também entram no `frame-src` da CSP) |
| `CAD_ALLOWED_HOSTS` | lista de hosts | Links de projeto CAD (Autodesk) permitidos |
| `PRINT_MAX_MB`, `PRINT_RETENTION_MINUTES` | número | Limite do PDF e retenção no disco |
| `UPLOAD_MAX_MB` | número | Limite do upload de GLB |
| `CALL_PROVIDER` | `demo` / `workscape` | Fonte do ciclo de atendimento e do indicador de fala dos avatares. Com `demo`, cada pessoa liga e desliga a própria chamada no painel de presença |
| `PRESENCE_GRACE_MS` | ms (padrão 15000) | Tolerância depois de fechar a última aba ou dispositivo antes de ficar offline (evita piscar numa recarga ou numa queda curta) |
| `TYPING_TTL_MS` | ms (padrão 6000) | Validade de um sinal de digitação sem renovação |
| `SPEAKING_TTL_MS` | ms (padrão 5000) | Validade do indicador de fala sem renovação |
| `CALL_MAX_MS` | ms (padrão 4 h) | Salvaguarda: chamada esquecida aberta é encerrada |
| `LIVE_HEARTBEAT_MS` | ms (padrão 20000) | Batimento do fluxo SSE (mantém a conexão através de proxies) |

## Endpoints do Office 3D (confirmados, implementados e testados)

| Método e rota | Perfil | Descrição |
|---|---|---|
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | — | Sessão com cookie HttpOnly e SameSite=Strict |
| `GET /api/offices`, `GET /api/offices/:id/operational` | todos | Mapas da empresa e visão operacional da revisão publicada |
| `GET` e `PUT /api/offices/:id/draft`, `POST /api/offices/:id/publish`, `GET /api/offices/:id/revisions` | admin | Rascunho com `baseVersion` (409 em conflito) e publicação atômica |
| `GET /api/assets`, `POST /api/assets/upload`, `GET /api/assets/file/:hash` | todos (upload: admin) | Catálogo e upload de GLB |
| `GET /api/directory` | todos | Nome, setor e ramal (dados mínimos) |
| `GET /api/admin/directory`, `GET /api/admin/devices`, `PATCH /api/admin/employees/:id`, `PATCH /api/admin/devices/:id` | admin | Diretório e inventário |
| `GET /api/admin/offices/:id/bindings`, `PUT …/seats/:objectId`, `PUT …/bindings/:objectId` | admin | Vínculos, com estado de órfão |
| `POST /api/offices/:id/actions/chat/open`, `GET` e `POST /api/chat/conversations/:id/messages` | operador, admin | Chat |
| `POST /api/offices/:id/actions/remote/request` | operador, admin | Acesso remoto (exige `confirm: true`) |
| `GET /api/tickets/active`, `POST /api/offices/:id/actions/transfer` | operador, admin | Transferência (exige `confirm` e `Idempotency-Key`) |
| `POST /api/offices/:id/actions/print/dialog`, `POST …/print/jobs`, `GET /api/print/jobs/:id` | operador, admin | Impressão |
| `POST /api/offices/:id/actions/dashboard/open`, `POST …/cad/open` | operador, admin | Painel autorizado e link de CAD |
| `GET /api/admin/audit`, `GET /api/integrations/status`, `POST /api/demo/outage` | admin | Trilha, estado dos conectores e falha simulada (só no modo demonstração) |
| `GET /api/live/stream` (SSE), `GET /api/live/snapshot` | operador, admin (visualizador recebe lista vazia) | Presença ao vivo da empresa: `snapshot` ao conectar, depois `person` (incremental, com versão) e `resync` |
| `POST /api/live/typing` | quem tem colaborador | `{ state: "start" ou "stop" }`: só o booleano, sempre da própria sessão |
| `POST /api/live/call`, `POST /api/live/speaking` | quem tem colaborador | Ciclo de atendimento e indicador de fala **de demonstração** (409 com `CALL_PROVIDER` real) |
| `GET /api/avatar/catalog`, `GET` e `PUT /api/avatar/me`, `PUT /api/avatar/employees/:id` | quem tem colaborador | Estilo ativo, catálogos e aparência do próprio avatar **no estilo ativo da empresa**. `baseVersion` desatualizada → 409; item fora do catálogo ou configuração de outro estilo ou parâmetros fora da lista permitida → 422; gerar outro avatar logo em seguida → 429; avatar de outra pessoa → 403, inclusive para administrador |
| `GET /api/avatar/model/:id/lod0.glb` e `lod1.glb` | quem tem sessão, só da própria empresa | Modelo 3D que o **servidor gerou** a partir dos parâmetros do personagem personalizado (estilo Ara). O cliente nunca envia modelo; outra empresa recebe 404. Ver [avatars-ara.md](avatars-ara.md#como-funciona-arquitetura) |
| `GET` e `PUT /api/admin/avatar-style` | admin | Estilo de avatar da empresa (`ara3d` padrão, ou `makehuman`). A troca vai ao vivo para todos (evento `snapshot` com `avatarStyle`) e entra na trilha. Ver [avatars-ara.md](avatars-ara.md) |

## Presença ao vivo e avatares

O estado de cada pessoa é **derivado no servidor** (`server/live.ts`), com a prioridade **OFFLINE > EM ATENDIMENTO > DIGITANDO > ONLINE**:

| Sinal | De onde vem hoje | De onde deve vir em produção |
|---|---|---|
| Online / offline | Conexão SSE autenticada da própria pessoa. Várias abas e dispositivos contam como uma; offline só depois de `PRESENCE_GRACE_MS` sem nenhuma | O mesmo (opcionalmente somado à presença do Workscape) |
| Digitando | Campo de mensagem do **chat interno do Office 3D**: o cliente manda `start` (no máximo a cada 2,5 s) e `stop` (3 s sem digitar, campo vazio, envio, saída do campo ou diálogo fechado) | **Evento de digitação do Workscape**, que não existe na API conhecida (ver lacunas) |
| Em atendimento | Botão do painel de presença (demonstração) | **Ciclo de chamada do sistema de telefonia ou atendimento** (`CALL_PROVIDER`) |
| Falando (booleano) | Botão do painel (demonstração), ou ausente | Indicador de atividade de voz da telefonia. Sem ele, o balão alterna "Em atendimento" e "•••" sem afirmar que a pessoa está falando |

Regras de segurança (testadas em `tests/live.test.ts`):

- **Nenhum conteúdo:** `/api/live/typing` só lê `state`; campos extras são ignorados. Teclas, texto, destinatário e nome da conversa nunca saem do navegador para o escritório 3D. A conversa não é capturada, retransmitida nem transcrita.
- **Só em nome próprio:** os sinais valem para o colaborador da sessão. O corpo do pedido não escolhe de quem é o sinal.
- **Só o próprio avatar:** `PUT /api/avatar/employees/:id` devolve 403 para qualquer outra pessoa, administrador incluído.
- **Escopo:** eventos e snapshot só da empresa da sessão. O perfil visualizador não recebe presença.
- **Ordem e duplicidade:** cada atualização leva uma versão crescente, que nunca regride (nem depois de um `resync`). O cliente descarta eventos atrasados. Ao reconectar, recebe um `snapshot` completo, com um avatar por pessoa.
- **Expiração e reconciliação:** digitação e fala expiram sozinhas. Chamada aberta além de `CALL_MAX_MS` é encerrada. A cada ciclo, o servidor compara as chamadas ativas com a fonte (`activeCalls`) e encerra as que sumiram.

**Modo demonstração:** colegas do diretório sem conta aparecem como **simulados** e alternam entre online, digitando, em atendimento e offline. O painel de presença do topo liga e desliga a chamada e o sinal de fala da própria pessoa pelo mesmo caminho que um provedor real usaria (`LiveHub.callStart`, `callEnd` e `speaking`).

**Lacunas para produção:**

1. **Workscape:** faltam os eventos de digitação (por conversa, só o booleano) e de presença. Com eles, a digitação passa a vir do servidor (webhook ou fluxo) e o campo do chat interno deixa de ser a fonte.
2. **Telefonia:** implementar a fonte real de chamadas (início e fim por ramal ou usuário e, se houver, atividade de voz) e ligar `CALL_PROVIDER=workscape`.
3. **Várias instâncias do servidor:** o `LiveHub` guarda o estado em memória. Com mais de um processo, os sinais e a contagem de conexões por pessoa precisam de um barramento compartilhado (Redis pub/sub, por exemplo).

## Chat (Workscape)

- **Demonstração:** conversas e mensagens ficam no próprio banco. A conversa direta é única por par de pessoas (`UNIQUE (company_id, pair_key)`). Pedidos simultâneos devolvem a mesma conversa (teste: 6 pedidos concorrentes, 1 criação).
- **Real:** `WorkscapeChat` existe, mas responde **"não configurado"**. **Não tive acesso à documentação nem ao código do Workscape.** Não sei como funcionam autenticação, criação de conversa direta, deduplicação nem presença, então nada foi inventado. O zip `workscape-phone-engine-win-x64.zip` encontrado em Downloads contém só um executável e não documenta a API.
- **Para ligar:** implementar `openDirect`, `listMessages` e `sendMessage` (e `presence`) conforme o contrato real; mapear `employees.chat_ref` para o ID do Workscape; aplicar a deduplicação **do contrato real** (chave de idempotência ou "obter ou criar" no servidor do Workscape); usar o token de serviço só no backend.

## Acesso remoto

- **"Autodesk" foi tratado como integração a confirmar.** O que se entendeu foi AnyDesk (acesso remoto). Para o caso de ser Autodesk mesmo, existe o vínculo `cad_link`: um link autorizado (host em `CAD_ALLOWED_HOSTS`) que abre o projeto ou visualizador CAD (https://www.autodesk.com/viewers).
- **Mecanismo documentado do AnyDesk** (https://support.anydesk.com/command-line-interface-for-windows, consultado em 12/11/2026): `anydesk.exe <ID/Alias>` inicia uma sessão com o cliente oficial. A mesma página documenta `--with-password`, que o Office 3D **não usa**.
- **Implementado:**
  - `REMOTE_PROVIDER=anydesk` + `ANYDESK_LAUNCH=manual` (padrão): o servidor confere a permissão do operador **para aquele dispositivo** (`remote_access_grants`), registra o pedido e devolve o endereço AnyDesk cadastrado e o comando documentado. O operador abre o cliente oficial.
  - `ANYDESK_LAUNCH=uri`: devolve também o link `anydesk:<endereço>`. Esse protocolo **não aparece na página de referência**. O instalador do AnyDesk costuma registrá-lo no Windows, mas isso precisa ser **validado no ambiente gerenciado** antes de ligar.
  - Em todos os modos: o consentimento de quem está do outro lado e a autenticação ficam no AnyDesk. O sistema não guarda senha, não executa comandos e não conecta sozinho.
- **TVs:** o acesso remoto vai para o **player ou PC associado** (dispositivo `tv_player`), nunca para "a TV".
- **Demonstração:** só registra. Não devolve endereço e não abre nada.

## Transferência de atendimento

- O operador só transfere **o atendimento ativo dele**. Sem atendimento ativo, a interface explica o motivo.
- O servidor valida a permissão, a elegibilidade do destino (colaborador ativo que aceita transferências, sem ser o próprio operador) e o estado atual. A atualização é condicional por versão (`UPDATE … WHERE version = ?`), e o conflito devolve 409 com `ticket_changed` ou `no_active_ticket`.
- **Idempotência:** o cabeçalho `Idempotency-Key` é obrigatório, com uma chave por intenção. A repetição com a mesma chave devolve a mesma resposta (`replayed: true`) sem executar de novo. Teste no navegador: duplo clique gerou 1 transferência.
- A interface só mostra "transferido" depois da **confirmação do provedor** (`confirmedAt`).
- **Real (Workscape):** adaptador não configurado, pelo mesmo motivo do chat. Falta o contrato de filas, atendimentos e transferência.

## Impressão

Três estados, sempre distintos na interface e na trilha:

1. **Diálogo aberto** (`print.dialog_opened`): pré-visualização do PDF e o diálogo do próprio navegador. O navegador **não garante qual impressora** será usada nem confirma que o documento saiu.
2. **Envio confirmado pela fila** (`sent`).
3. **Conclusão reportada pela fila** (`completed`) ou falha (`failed`).

Envio direto (`PRINT_PROVIDER`):

- **Destino:** só a impressora cadastrada e vinculada ao objeto (`managed_devices.kind = printer`).
- **Validação:** checagem da assinatura `%PDF-` (não da extensão) e limite de `PRINT_MAX_MB`.
- **Sem duplicidade:** chave de idempotência e, além dela, o mesmo usuário com a mesma impressora e o mesmo arquivo (hash) em até 15 s reaproveita o trabalho.
- **Retenção:** o arquivo é apagado ao chegar a um estado final ou após `PRINT_RETENTION_MINUTES`, com limpeza periódica.

Adaptador real (desenho, ainda não implementado):

- **Servidor de impressão corporativo (IPP/CUPS):** `submit` → `Print-Job` (IPP) na fila do destino, com usuário de serviço; `status` → `Get-Job-Attributes` (`job-state` 3/4/5 = na fila, 9 = concluído, 7/8 = falha).
- **Ou agente gerenciado** instalado no servidor de impressão, que recebe o PDF por HTTPS com mTLS.
- Em qualquer caso, a lista de destinos autorizados fica no servidor, junto com limites e retenção.

## Sinal "Workspace aberto" (presença no mapa)

Fora da demonstração (`DEMO_MODE=false`), **quem aparece no mapa, como online, é só quem o Workspace (chat interno) marcou como aberto**. Estar com a aba do Office 3D aberta não basta. Até o vínculo existir, ninguém aparece. Na demonstração nada muda: vale a conexão do próprio navegador e os colegas simulados.

O Workspace avisa por `PUT /api/integrations/workspace-presence`, sem sessão de usuário: autentica com `Authorization: Bearer <WORKSPACE_PRESENCE_TOKEN>` (segredo só no servidor, comparado em tempo constante). Dois formatos:

- **Lista completa** (recomendado, ressincroniza sozinho): `{ "companyId": "...", "employeeIds": ["emp_ana", "emp_bruno"] }`. Quem não está na lista passa a offline.
- **Evento:** `{ "companyId": "...", "employeeId": "emp_ana", "open": true }`.

Resposta: `{ "accepted": n, "ignored": m }` (ids desconhecidos ou inativos são ignorados). Só o fato de estar aberto trafega: nenhum conteúdo de conversa. Sem token configurado o endereço responde 409.

Quem está com o Office 3D aberto mas sem o Workspace aberto não entra no mapa: a tela 2D mostra o aviso e ele só observa (`GET /api/office2d/:id/positions`).

## Painéis de TV e CAD

- Só abrem caminhos `/demo/…` (modo demonstração) ou `https://` de hosts listados. O endereço é validado ao vincular e de novo ao abrir.
- O painel abre em `iframe` com `sandbox` e `referrerpolicy=no-referrer`.

## O que depende de ambiente real

| Item | Situação |
|---|---|
| API do Workscape (autenticação, chat, presença, atendimentos) | Sem documentação ou acesso nesta entrega |
| AnyDesk em máquinas gerenciadas | Validar o cliente instalado, a política e o protocolo `anydesk:` antes de `ANYDESK_LAUNCH=uri` |
| Servidor de impressão ou agente | Escolher IPP/CUPS ou agente; definir credenciais e filas |
| Painéis reais | Definir hosts e autenticação do painel (SSO ou token de exibição) |
| Autodesk | Confirmar se a intenção é CAD; obter os hosts do visualizador |
| MariaDB | O SQL é portátil e o driver está implementado (`mysql2`), mas **não foi executado contra um MariaDB real** nesta entrega |
