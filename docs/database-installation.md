# Base de dados: instalação e migrations

## Fonte canónica

A história canónica da base de dados do WACRM é `supabase/migrations/`.

Cada alteração de schema, função, política RLS, trigger ou dado estrutural deve entrar como uma nova migration. Em produção, migrations já aplicadas são imutáveis: não devem ser renomeadas, reordenadas nem editadas para “corrigir” uma instalação existente. Uma correcção deve ser uma nova migration forward-only.

O ficheiro `supabase/ai-agent-complete-install.sql` é um instalador manual histórico, criado para agrupar um conjunto limitado de melhorias do agente em 2026-08-10. Não representa o estado actual completo da aplicação e não deve ser usado como substituto da cadeia completa de migrations numa instalação nova.

## Ordem e versões

Os ficheiros são aplicados pela sua versão numérica inicial. O repositório contém duas convenções históricas:

- versões sequenciais antigas, por exemplo `001_...sql`;
- versões por timestamp, por exemplo `20260819114500_...sql`.

Existe uma colisão histórica conhecida na versão `037`:

- `037_agent_knowledge_sources.sql`
- `037_webhook_broadcast_reliability.sql`

Esses ficheiros não são renomeados porque podem já ter sido aplicados em instalações existentes. O comando abaixo aceita apenas essa colisão histórica e falha se uma nova versão duplicada for introduzida:

```bash
npm run check:migrations
```

A mesma verificação corre no CI.

## Instalação nova

Para uma base nova, use sempre a cadeia completa em `supabase/migrations/`, em ordem determinística, através do processo de migrations adoptado no ambiente. Não execute em paralelo o instalador manual histórico do agente, porque ele repete alterações que já existem na cadeia canónica.

Antes de considerar uma instalação pronta, confirme pelo menos estes marcos do schema actual:

- `wacrm.accounts`, `wacrm.profiles`, `wacrm.contacts` e `wacrm.conversations` existem;
- `wacrm.ai_configs`, `wacrm.agent_tools`, `wacrm.ai_knowledge_documents` e memória/telemetria do agente existem;
- `wacrm.website_channels` existe para Website chat;
- `wacrm.handoff_queues` e `wacrm.handoff_queue_members` existem;
- `wacrm.messages.account_id` existe e é obrigatório;
- `wacrm.assign_conversation_if_current(...)` existe;
- as tabelas operacionais estão protegidas por RLS e os grants esperados estão presentes.

Esta lista é uma verificação de sanidade, não substitui a aplicação integral das migrations.

## Produção

Para uma instalação já em produção:

1. não volte a executar toda a história manualmente;
2. aplique apenas migrations ainda pendentes, na ordem correcta;
3. faça o deploy da aplicação apenas quando uma migration exigida pela nova versão já estiver aplicada;
4. se uma migration falhar, corrija a causa e crie uma nova migration quando necessário — não altere silenciosamente uma migration que já possa ter sido aplicada noutro ambiente;
5. registe qualquer SQL manual excepcional numa migration correspondente para que o estado continue reproduzível.

## Verificação no repositório

Antes de abrir PR ou fazer deploy:

```bash
npm run check:migrations
npm run lint
npm run typecheck
npm test
npm run build
```

O primeiro comando protege a numeração; os restantes validam a aplicação. Um deploy não deve ser considerado verificado apenas porque o SQL foi aceite pelo editor do Supabase.

## Estado de reconstruibilidade

Este documento define a cadeia canónica e impede novas colisões de versão. Ainda assim, a reconstrução completa de uma base vazia deve ser testada periodicamente num ambiente descartável. Só esse teste de ponta a ponta prova que todas as dependências históricas continuam reproduzíveis sem estado manual prévio.
