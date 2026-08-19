'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, Loader2, PlayCircle } from 'lucide-react';
import { useLocale } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

type Locale = 'pt' | 'en';

type SetupState = {
  agentConfigured: boolean;
  agentActive: boolean;
  knowledgeDocs: number;
  handoffReady: boolean;
  whatsappConnected: boolean;
  websiteActive: boolean;
};

const COPY = {
  pt: {
    checking: 'A verificar a configuração inicial…',
    eyebrow: 'Primeiros passos',
    title: 'Colocar o WACRM pronto para atender clientes',
    intro: 'Segue esta ordem. Cada passo usa a configuração real da conta, por isso o progresso reflecte o que já está efectivamente preparado.',
    essentials: 'passos essenciais',
    company: '1. Empresa',
    companyMissing: 'Confirma os dados básicos da conta.',
    account: 'Conta',
    channel: '2. Canal',
    channelMissing: 'Liga o WhatsApp ou configura o chat do Website.',
    available: 'disponível para clientes.',
    agent: '3. Agente',
    agentDone: 'Identidade e fornecedor de IA configurados.',
    agentMissing: 'Define identidade, função e modelo do agente.',
    knowledge: '4. Knowledge',
    knowledgeMissing: 'Adiciona informação factual do negócio para o agente consultar.',
    sources: 'fonte(s) disponível(is).',
    handoff: '5. Handoff',
    handoffDone: 'Existe um responsável ou equipa para escalamentos.',
    handoffMissing: 'Define quem recebe pedidos que precisam de uma pessoa.',
    activation: '6. Activação',
    activationDone: 'O agente está activo.',
    activationMissing: 'Testa primeiro e activa apenas quando a prontidão estiver confirmada.',
    configure: 'Configurar',
    whatsapp: 'WhatsApp',
    website: 'Website',
    add: 'Adicionar',
    review: 'Rever',
    testTitle: 'Antes da activação: testa uma conversa realista',
    testDetail: 'Confirma respostas, Knowledge, ferramentas e handoff no Playground antes de atender clientes.',
    testAgent: 'Testar agente',
  },
  en: {
    checking: 'Checking initial setup…',
    eyebrow: 'Getting started',
    title: 'Get WACRM ready to serve customers',
    intro: 'Follow this order. Each step uses the account’s real configuration, so progress reflects what is actually ready.',
    essentials: 'essential steps',
    company: '1. Business',
    companyMissing: 'Confirm the basic account details.',
    account: 'Account',
    channel: '2. Channel',
    channelMissing: 'Connect WhatsApp or configure Website chat.',
    available: 'available to customers.',
    agent: '3. Agent',
    agentDone: 'Identity and AI provider configured.',
    agentMissing: 'Define the agent identity, role, and model.',
    knowledge: '4. Knowledge',
    knowledgeMissing: 'Add factual business information the agent can consult.',
    sources: 'source(s) available.',
    handoff: '5. Handoff',
    handoffDone: 'A person or specialist team is available for escalations.',
    handoffMissing: 'Choose who receives requests that need a person.',
    activation: '6. Activation',
    activationDone: 'The agent is active.',
    activationMissing: 'Test first and activate only after readiness is confirmed.',
    configure: 'Configure',
    whatsapp: 'WhatsApp',
    website: 'Website',
    add: 'Add',
    review: 'Review',
    testTitle: 'Before activation: test a realistic conversation',
    testDetail: 'Check replies, Knowledge, tools, and handoff in the Playground before serving customers.',
    testAgent: 'Test agent',
  },
} satisfies Record<Locale, Record<string, string>>;

async function safeJson(url: string) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function loadSetupState(): Promise<SetupState> {
  const [agent, knowledge, queues, whatsapp, website] = await Promise.all([
    safeJson('/api/ai/config'),
    safeJson('/api/ai/knowledge'),
    safeJson('/api/account/handoff-queues'),
    safeJson('/api/whatsapp/config'),
    safeJson('/api/site-chat/channel'),
  ]);

  const queueRows = (queues?.queues ?? []) as Array<{
    enabled?: boolean;
    member_user_ids?: string[];
  }>;

  return {
    agentConfigured: agent?.configured === true,
    agentActive: agent?.is_active === true,
    knowledgeDocs: Array.isArray(knowledge?.documents) ? knowledge.documents.length : 0,
    handoffReady:
      Boolean(agent?.handoff_agent_id) ||
      queueRows.some(
        (queue) => queue.enabled !== false && (queue.member_user_ids?.length ?? 0) > 0,
      ),
    whatsappConnected: whatsapp?.connected === true,
    websiteActive: website?.channel?.is_active === true,
  };
}

function actionLinkClass(variant: 'default' | 'ghost' = 'ghost') {
  return cn(buttonVariants({ variant, size: 'sm' }));
}

function Step({
  done,
  title,
  description,
  href,
  action,
  secondaryHref,
  secondaryAction,
}: {
  done: boolean;
  title: string;
  description: string;
  href: string;
  action: string;
  secondaryHref?: string;
  secondaryAction?: string;
}) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-3">
      <Icon
        className={
          done
            ? 'h-5 w-5 shrink-0 text-primary'
            : 'h-5 w-5 shrink-0 text-muted-foreground'
        }
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {!done && (
        <div className="flex shrink-0 gap-1">
          <Link href={href} className={actionLinkClass()}>
            {action}
          </Link>
          {secondaryHref && secondaryAction ? (
            <Link href={secondaryHref} className={actionLinkClass()}>
              {secondaryAction}
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function OnboardingGuide() {
  const locale = useLocale();
  const copy = COPY[locale.startsWith('pt') ? 'pt' : 'en'];
  const { account, canEditSettings, profileLoading } = useAuth();
  const [state, setState] = useState<SetupState | null>(null);

  useEffect(() => {
    if (!canEditSettings) return;
    let cancelled = false;
    void loadSetupState().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [canEditSettings]);

  const companyReady = Boolean(account?.name?.trim());
  const channelReady = Boolean(state?.whatsappConnected || state?.websiteActive);
  const knowledgeReady = (state?.knowledgeDocs ?? 0) > 0;
  const required = useMemo(
    () => [
      companyReady,
      channelReady,
      Boolean(state?.agentConfigured),
      knowledgeReady,
      Boolean(state?.handoffReady),
      Boolean(state?.agentActive),
    ],
    [channelReady, companyReady, knowledgeReady, state?.agentActive, state?.agentConfigured, state?.handoffReady],
  );
  const completed = required.filter(Boolean).length;
  const ready = required.every(Boolean);

  if (profileLoading || !canEditSettings) return null;

  if (!state) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {copy.checking}
        </CardContent>
      </Card>
    );
  }

  if (ready) return null;

  const channelName = state.whatsappConnected ? 'WhatsApp' : 'Website';

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-label text-primary">{copy.eyebrow}</p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{copy.title}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{copy.intro}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-foreground">{completed} / {required.length}</p>
            <p className="text-xs text-muted-foreground">{copy.essentials}</p>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <Step
            done={companyReady}
            title={copy.company}
            description={companyReady ? `${copy.account}: ${account?.name}` : copy.companyMissing}
            href="/settings"
            action={copy.configure}
          />
          <Step
            done={channelReady}
            title={copy.channel}
            description={channelReady ? `${channelName} ${copy.available}` : copy.channelMissing}
            href="/settings?tab=whatsapp"
            action={copy.whatsapp}
            secondaryHref="/settings?tab=website"
            secondaryAction={copy.website}
          />
          <Step
            done={state.agentConfigured}
            title={copy.agent}
            description={state.agentConfigured ? copy.agentDone : copy.agentMissing}
            href="/agents?section=identity"
            action={copy.configure}
          />
          <Step
            done={knowledgeReady}
            title={copy.knowledge}
            description={knowledgeReady ? `${state.knowledgeDocs} ${copy.sources}` : copy.knowledgeMissing}
            href="/agents?section=knowledge"
            action={copy.add}
          />
          <Step
            done={state.handoffReady}
            title={copy.handoff}
            description={state.handoffReady ? copy.handoffDone : copy.handoffMissing}
            href="/agents?section=security"
            action={copy.configure}
          />
          <Step
            done={state.agentActive}
            title={copy.activation}
            description={state.agentActive ? copy.activationDone : copy.activationMissing}
            href="/agents?section=runtime"
            action={copy.review}
          />
        </div>

        {state.agentConfigured && !state.agentActive && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/50 px-3 py-3">
            <PlayCircle className="h-5 w-5 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{copy.testTitle}</p>
              <p className="text-xs text-muted-foreground">{copy.testDetail}</p>
            </div>
            <Link href="/agents?section=playground" className={actionLinkClass('default')}>
              {copy.testAgent}
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
