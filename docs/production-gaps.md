# O que falta para produção

Lista objetiva, da mais bloqueante para a menos.

## Integrações (dependem de acesso e ambiente)

1. **Workscape:** obter a documentação ou o código da API (autenticação de serviço, conversa direta "obter ou criar", presença, filas e atendimentos, transferência) e implementar `WorkscapeChat`, `WorkscapePresence` e `WorkscapeTransfer` em `server/providers/real.ts`. Sem isso, chat, presença e transferência só existem em demonstração.
2. **Autenticação corporativa:** reusar o login do Workscape (ou SSO/OIDC) no lugar das contas locais. As contas locais existem só para a demonstração.
3. **Diretório:** sincronizar `employees` com a fonte oficial (Workscape, AD ou RH). Hoje o cadastro é manual (seed). Definir a política de retenção de colaboradores desligados.
4. **AnyDesk:** validar no ambiente gerenciado (versão do cliente, política, aceite remoto e o protocolo `anydesk:`) antes de `ANYDESK_LAUNCH=uri`. Cadastrar os endereços reais dos dispositivos e as concessões por operador. Confirmar se "Autodesk" era AnyDesk ou visualizador CAD.
5. **Impressão direta:** escolher entre servidor IPP/CUPS e agente gerenciado e implementar `IppPrint` (Print-Job e Get-Job-Attributes). Definir as filas autorizadas, o usuário de serviço e a retenção. Hoje só o diálogo do navegador é real.
6. **Painéis de TV:** listar os hosts em `DASHBOARD_ALLOWED_HOSTS` e resolver a autenticação do painel dentro do iframe.

## Plataforma

7. **MariaDB:** rodar as migrações e os testes contra um MariaDB real (o código e o SQL estão prontos, mas não foram executados nesta máquina), configurar backup e criar o usuário com privilégios mínimos.
8. **HTTPS e proxy reverso:** `COOKIE_SECURE=true`, HSTS e limite de corpo no proxy.
9. **Limite de tentativas** de login e de ações persistente e compartilhado entre instâncias (hoje fica em memória, por processo).
10. **Armazenamento de uploads e do spool de impressão:** volume persistente ou armazenamento de objetos. Antivírus nos uploads, se a política exigir.
11. **Observabilidade:** logs estruturados com o identificador de correlação (já propagado) enviados ao coletor da empresa, métricas e alertas de conectores.
12. **Retenção da trilha** de auditoria e exportação para o SIEM.
13. **Processo de deploy** com as migrações versionadas (hoje `001` e `002`; a ferramenta aplica `NNN_*.sql` em ordem).

## Produto

14. **Vários andares e prédios:** o modelo já tem prédio → andar → mapa, e a interface tem seletor quando há mais de um andar. Falta criar andares pela interface.
15. **Mesclagem em conflito:** hoje o segundo editor recarrega e refaz o trabalho. Uma mesclagem por objeto seria o próximo passo.
16. **Histórico de revisões:** a API lista as revisões (`/revisions`). Faltam a tela, a comparação e o "restaurar revisão".
17. **Acessibilidade:** a lista operacional equivale à cena e funciona por teclado. Falta uma auditoria WCAG completa (leitor de tela na cena 3D, contraste dos chips).
18. **Carregamento inicial:** os blocos `three` e `r3f` somam cerca de 300 KB com gzip. Dá para carregar o editor sob demanda para operadores.
19. **Revisão jurídica das atribuições** CC-BY 3.0 (19 modelos) no material distribuído. A tela Créditos e o `CREDITS.md` já trazem autor, fonte, licença e alterações.
20. **Avatares e presença ao vivo:** implementados com sinais de demonstração para atendimento e fala. Faltam os eventos de digitação e presença do Workscape, a fonte real do ciclo de chamada e da atividade de voz (`CALL_PROVIDER`) e um barramento compartilhado para rodar mais de um processo de servidor. Ver [avatars.md](avatars.md#lacunas) e [integrations.md](integrations.md#presença-ao-vivo-e-avatares).
