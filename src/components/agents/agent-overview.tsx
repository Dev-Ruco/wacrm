'use client';

import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { AgentConfigState } from './use-agent-config';
import type { Section } from './agent-builder-shell';

type Locale = 'pt' | 'en';

interface OverviewCounts {
  skillsActive: number;
  skillsTotal: number;
  toolsEnabled: number;
  toolsTotal: number;
  knowledgeDocs: number;
  handoffQueueReady: boolean;
  whatsappConnected: boolean;
  websiteActive: boolean;
}

const COPY = {
  pt: {
    configure: 'Configurar',
    configureNow: 'Configurar agora',
    noAgent: 'Ainda não configuraste um agente de IA para esta conta.',
    readiness: 'Prontidão do agente',
    readinessDesc: 'Confirma o mínimo operacional antes de colocar o agente a falar com clientes.',
    ready: 'Pronto para activar',
    readyDetail: 'Configuração mínima concluída',
    stepsDone: 'passos concluídos',
    identity: 'Identidade e idioma',
    identityDone: 'Nome, função e idioma definidos.',
    identityMissing: 'Define quem é o agente, o que faz e em que idioma responde.',
    provider: 'Modelo de IA',
    providerDone: 'Credencial do fornecedor configurada.',
    providerMissing: 'Falta uma chave válida do fornecedor de IA.',
    knowledge: 'Conhecimento do negócio',
    knowledgeMissing: 'Adiciona pelo menos uma fonte para reduzir respostas sem base factual.',
    sourceSuffix: 'fonte(s) de conhecimento disponível(is).',
    handoff: 'Handoff humano',
    handoffDone: 'Existe um responsável ou equipa disponível para receber handoffs.',
    handoffMissing: 'Configura um responsável de fallback ou uma equipa especialista.',
    channel: 'Canal de entrada',
    channelDone: 'está disponível para clientes.',
    channelMissing: 'Liga o WhatsApp ou activa o canal Website antes de entrar em produção.',
    testBefore: 'Testar antes de activar',
    guidance: 'A prontidão é uma orientação; a activação continua a respeitar as validações do servidor.',
    unnamed: 'Agente sem nome',
    status: 'Estado',
    active: 'Activo',
    inactive: 'Inactivo',
    model: 'Modelo',
    temperature: 'Temperatura',
    defaultValue: 'Por omissão',
    activeSkills: 'Skills activas',
    tools: 'Tools disponíveis',
    knowledgeSources: 'Fontes de conhecimento',
    autoReply: 'Auto-resposta',
    testAgent: 'Testar agente',
  },
  en: {
    configure: 'Configure',
    configureNow: 'Configure now',
    noAgent: 'No AI agent has been configured for this account yet.',
    readiness: 'Agent readiness',
    readinessDesc: 'Confirm the operational minimum before the agent starts talking to customers.',
    ready: 'Ready to activate',
    readyDetail: 'Minimum configuration complete',
    stepsDone: 'steps complete',
    identity: 'Identity and language',
    identityDone: 'Name, role, and language are defined.',
    identityMissing: 'Define who the agent is, what it does, and which language it uses.',
    provider: 'AI model',
    providerDone: 'Provider credential configured.',
    providerMissing: 'A valid AI provider key is still required.',
    knowledge: 'Business knowledge',
    knowledgeMissing: 'Add at least one source to reduce unsupported factual replies.',
    sourceSuffix: 'knowledge source(s) available.',
    handoff: 'Human handoff',
    handoffDone: 'A person or specialist team is available to receive handoffs.',
    handoffMissing: 'Configure a fallback person or a specialist team.',
    channel: 'Inbound channel',
    channelDone: 'is available to customers.',
    channelMissing: 'Connect WhatsApp or activate the Website channel before going live.',
    testBefore: 'Test before activating',
    guidance: 'Readiness is guidance; activation still obeys the server-side safety checks.',
    unnamed: 'Unnamed agent',
    status: 'Status',
    active: 'Active',
    inactive: 'Inactive',
    model: 'Model',
    temperature: 'Temperature',
    defaultValue: 'Default',
    activeSkills: 'Active skills',
    tools: 'Available tools',
    knowledgeSources: 'Knowledge sources',
    autoReply: 'Auto-reply',
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

async function loadCounts(): Promise<OverviewCounts> {
  const [skillsRes, toolsRes, knowledgeRes, queuesRes, whatsappRes, websiteRes] =
    await Promise.all([
      safeJson('/api/ai/skills'),
      safeJson('/api/ai/tools'),
      safeJson('/api/ai/knowledge'),
      safeJson('/api/account/handoff-queues'),
      safeJson('/api/whatsapp/config'),
      safeJson('/api/site-chat/channel'),
    ]);

  const skills = (skillsRes?.skills ?? []) as Array<{ enabled: boolean }>;
  const tools = (toolsRes?.tools ?? {}) as Record<string, { enabled: boolean }>;
  const toolValues = Object.values(tools);
  const queues = (queuesRes?.queues ?? []) as Array<{
    enabled?: boolean;
    member_user_ids?: string[];
  }>;

  return {
    skillsActive: skills.filter((skill) => skill.enabled).length,
    skillsTotal: skills.length,
    toolsEnabled: toolValues.filter((tool) => tool.enabled).length,
    toolsTotal: toolValues.length,
    knowledgeDocs: (knowledgeRes?.documents ?? []).length,
    handoffQueueReady: queues.some(
      (queue) => queue.enabled !== false && (queue.member_user_ids?.length ?? 0) > 0,
    ),
    whatsappConnected: whatsappRes?.connected === true,
    websiteActive: websiteRes?.channel?.is_active === true,
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function ReadinessRow({
  complete,
  label,
  detail,
  actionLabel,
  onFix,
}: {
  complete: boolean;
  label: string;
  detail: string;
  actionLabel: string;
  onFix?: () => void;
}) {
  const Icon = complete ? CheckCircle2 : Circle;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2.5">
      <Icon
        className={complete ? 'h-5 w-5 shrink-0 text-primary' : 'h-5 w-5 shrink-0 text-muted-foreground'}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      {!complete && onFix && (
        <Button type="button" variant="ghost" size="sm" onClick={onFix}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export function AgentOverview({
  state,
  onNavigate,
}: {
  state: AgentConfigState;
  onNavigate: (tab: Section) => void;
}) {
  const locale = useLocale();
  const copy = COPY[locale.startsWith('pt') ? 'pt' : 'en'];
  const [counts, setCounts] = useState<OverviewCounts | null>(null);

  useEffect(() => {
    if (!state.configured) return;
    void loadCounts().then(setCounts);
  }, [state.configured]);

  if (state.loading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!state.configured) {
    return (
      <Card className="max-w-3xl">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Bot className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{copy.noAgent}</p>
          <Button onClick={() => onNavigate('identity')}>{copy.configureNow}</Button>
        </CardContent>
      </Card>
    );
  }

  const modelLabel = `${state.provider === 'openai' ? 'OpenAI' : 'Anthropic'} · ${state.model}`;
  const identityReady = Boolean(
    state.agentName.trim() && state.agentRole.trim() && state.agentLanguage.trim(),
  );
  const providerReady =
    state.hasStoredKey || (state.keyEdited && state.apiKey.trim().length > 0);
  const knowledgeReady = (counts?.knowledgeDocs ?? 0) > 0;
  const handoffReady = Boolean(state.handoffAgentId) || Boolean(counts?.handoffQueueReady);
  const channelReady = Boolean(counts?.whatsappConnected || counts?.websiteActive);
  const readiness = [identityReady, providerReady, knowledgeReady, handoffReady, channelReady];
  const readinessDone = readiness.filter(Boolean).length;
  const operationallyReady = readinessDone === readiness.length;
  const channelName = counts?.whatsappConnected ? 'WhatsApp' : 'Website';

  return (
    <div className="max-w-3xl space-y-4">
      {state.canEdit && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">{copy.readiness}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{copy.readinessDesc}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-foreground">
                  {operationallyReady ? copy.ready : `${readinessDone} / ${readiness.length}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {operationallyReady ? copy.readyDetail : copy.stepsDone}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <ReadinessRow
                complete={identityReady}
                label={copy.identity}
                detail={identityReady ? copy.identityDone : copy.identityMissing}
                actionLabel={copy.configure}
                onFix={() => onNavigate('identity')}
              />
              <ReadinessRow
                complete={providerReady}
                label={copy.provider}
                detail={providerReady ? copy.providerDone : copy.providerMissing}
                actionLabel={copy.configure}
                onFix={() => onNavigate('runtime')}
              />
              <ReadinessRow
                complete={knowledgeReady}
                label={copy.knowledge}
                detail={knowledgeReady ? `${counts?.knowledgeDocs ?? 0} ${copy.sourceSuffix}` : copy.knowledgeMissing}
                actionLabel={copy.configure}
                onFix={() => onNavigate('knowledge')}
              />
              <ReadinessRow
                complete={handoffReady}
                label={copy.handoff}
                detail={handoffReady ? copy.handoffDone : copy.handoffMissing}
                actionLabel={copy.configure}
                onFix={() => onNavigate('security')}
              />
              <ReadinessRow
                complete={channelReady}
                label={copy.channel}
                detail={channelReady ? `${channelName} ${copy.channelDone}` : copy.channelMissing}
                actionLabel={copy.configure}
                onFix={() => {
                  window.location.href = '/settings?tab=whatsapp';
                }}
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={() => onNavigate('playground')}>{copy.testBefore}</Button>
              {!operationallyReady && (
                <p className="self-center text-xs text-muted-foreground">{copy.guidance}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-1 pt-6">
          <div className="mb-2 flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                {state.agentName || copy.unnamed}
              </h3>
              {state.agentRole && <p className="text-sm text-muted-foreground">{state.agentRole}</p>}
            </div>
          </div>

          <div className="space-y-1">
            <Row label={copy.status} value={state.isActive ? copy.active : copy.inactive} />
            <Row label={copy.model} value={modelLabel} />
            <Row
              label={copy.temperature}
              value={state.temperatureEnabled ? state.temperature.toFixed(2) : copy.defaultValue}
            />
          </div>

          <div className="mt-4 space-y-1">
            <Row
              label={copy.activeSkills}
              value={counts ? `${counts.skillsActive} / ${counts.skillsTotal}` : '…'}
            />
            <Row
              label={copy.tools}
              value={counts ? `${counts.toolsEnabled} / ${counts.toolsTotal}` : '…'}
            />
            <Row
              label={copy.knowledgeSources}
              value={counts ? String(counts.knowledgeDocs) : '…'}
            />
            <Row label={copy.autoReply} value={state.autoReplyEnabled ? copy.active : copy.inactive} />
          </div>

          <div className="flex gap-2 pt-4">
            <Button onClick={() => onNavigate('playground')}>{copy.testAgent}</Button>
            <Button variant="outline" onClick={() => onNavigate('identity')}>
              {copy.configure}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
