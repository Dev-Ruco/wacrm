'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bot, CheckCircle2, Circle, Loader2, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';

type SetupState = {
  agentConfigured: boolean;
  agentActive: boolean;
  knowledgeDocs: number;
  handoffReady: boolean;
  whatsappConnected: boolean;
  websiteActive: boolean;
};

async function safeJson(url: string) {
  try {
    const response = await fetch(url);
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

function Step({
  done,
  title,
  description,
  href,
  action,
}: {
  done: boolean;
  title: string;
  description: string;
  href: string;
  action: string;
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
        <Button asChild type="button" variant="ghost" size="sm">
          <Link href={href}>{action}</Link>
        </Button>
      )}
    </div>
  );
}

export function OnboardingGuide() {
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
          A verificar a configuração inicial…
        </CardContent>
      </Card>
    );
  }

  if (ready) return null;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-label text-primary">Primeiros passos</p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">
              Colocar o WACRM pronto para atender clientes
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Segue esta ordem. Cada passo reutiliza a configuração real da conta; não existe um segundo estado de onboarding para manter.
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-foreground">{completed} / {required.length}</p>
            <p className="text-xs text-muted-foreground">passos essenciais</p>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <Step
            done={companyReady}
            title="1. Empresa"
            description={companyReady ? `Conta: ${account?.name}` : 'Define os dados básicos da conta.'}
            href="/settings?tab=profile"
            action="Configurar"
          />
          <Step
            done={channelReady}
            title="2. Canal"
            description={
              channelReady
                ? `${state.whatsappConnected ? 'WhatsApp' : 'Website'} disponível para clientes.`
                : 'Liga o WhatsApp ou configura o chat do Website.'
            }
            href="/settings?tab=whatsapp"
            action="Ligar canal"
          />
          <Step
            done={state.agentConfigured}
            title="3. Agente"
            description={
              state.agentConfigured
                ? 'Identidade e fornecedor de IA configurados.'
                : 'Define identidade, função e modelo do agente.'
            }
            href="/agents"
            action="Configurar"
          />
          <Step
            done={knowledgeReady}
            title="4. Knowledge"
            description={
              knowledgeReady
                ? `${state.knowledgeDocs} fonte(s) disponível(is).`
                : 'Adiciona informação factual do negócio para o agente consultar.'
            }
            href="/agents"
            action="Adicionar"
          />
          <Step
            done={state.handoffReady}
            title="5. Handoff"
            description={
              state.handoffReady
                ? 'Existe um responsável ou equipa para escalamentos.'
                : 'Define quem recebe pedidos que precisam de uma pessoa.'
            }
            href="/settings?tab=members"
            action="Configurar"
          />
          <Step
            done={state.agentActive}
            title="6. Activação"
            description={
              state.agentActive
                ? 'O agente está activo.'
                : 'Testa primeiro e activa apenas quando a prontidão estiver confirmada.'
            }
            href="/agents"
            action="Rever"
          />
        </div>

        {state.agentConfigured && !state.agentActive && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/50 px-3 py-3">
            <PlayCircle className="h-5 w-5 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">Antes da activação: testa uma conversa realista</p>
              <p className="text-xs text-muted-foreground">
                Confirma respostas, Knowledge, ferramentas e handoff no Playground antes de atender clientes.
              </p>
            </div>
            <Button asChild size="sm">
              <Link href="/agents">Testar agente</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
