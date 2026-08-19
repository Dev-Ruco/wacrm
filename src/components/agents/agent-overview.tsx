'use client';

import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { AgentConfigState } from './use-agent-config';
import type { Section } from './agent-builder-shell';

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

async function safeJson(url: string) {
  try {
    const response = await fetch(url);
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
  onFix,
}: {
  complete: boolean;
  label: string;
  detail: string;
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
          Configurar
        </Button>
      )}
    </div>
  );
}

/**
 * Visão Geral: summary + operational-readiness checklist. Readiness is derived
 * only from persisted account state that already exists elsewhere in WACRM; it
 * does not create a second source of truth or silently activate anything.
 */
export function AgentOverview({
  state,
  onNavigate,
}: {
  state: AgentConfigState;
  onNavigate: (tab: Section) => void;
}) {
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
          <p className="text-sm text-muted-foreground">
            Ainda não configuraste um agente de IA para esta conta.
          </p>
          <Button onClick={() => onNavigate('identity')}>Configurar agora</Button>
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
  const readiness = [
    identityReady,
    providerReady,
    knowledgeReady,
    handoffReady,
    channelReady,
  ];
  const readinessDone = readiness.filter(Boolean).length;
  const operationallyReady = readinessDone === readiness.length;

  return (
    <div className="max-w-3xl space-y-4">
      {state.canEdit && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">Prontidão do agente</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Confirma o mínimo operacional antes de colocar o agente a falar com clientes.
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-foreground">
                  {operationallyReady ? 'Pronto para activar' : `${readinessDone} / ${readiness.length}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {operationallyReady ? 'Configuração mínima concluída' : 'passos concluídos'}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <ReadinessRow
                complete={identityReady}
                label="Identidade e idioma"
                detail={
                  identityReady
                    ? 'Nome, função e idioma definidos.'
                    : 'Define quem é o agente, o que faz e em que idioma responde.'
                }
                onFix={() => onNavigate('identity')}
              />
              <ReadinessRow
                complete={providerReady}
                label="Modelo de IA"
                detail={
                  providerReady
                    ? 'Credencial do fornecedor configurada.'
                    : 'Falta uma chave válida do fornecedor de IA.'
                }
                onFix={() => onNavigate('runtime')}
              />
              <ReadinessRow
                complete={knowledgeReady}
                label="Conhecimento do negócio"
                detail={
                  knowledgeReady
                    ? `${counts?.knowledgeDocs ?? 0} fonte(s) de conhecimento disponível(is).`
                    : 'Adiciona pelo menos uma fonte para reduzir respostas sem base factual.'
                }
                onFix={() => onNavigate('knowledge')}
              />
              <ReadinessRow
                complete={handoffReady}
                label="Handoff humano"
                detail={
                  handoffReady
                    ? 'Existe um responsável ou equipa disponível para receber handoffs.'
                    : 'Configura um responsável de fallback ou uma equipa especialista.'
                }
                onFix={() => onNavigate('security')}
              />
              <ReadinessRow
                complete={channelReady}
                label="Canal de entrada"
                detail={
                  channelReady
                    ? `${counts?.whatsappConnected ? 'WhatsApp' : 'Website'} está disponível para clientes.`
                    : 'Liga o WhatsApp ou activa o canal Website antes de entrar em produção.'
                }
                onFix={() => {
                  window.location.href = '/settings';
                }}
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={() => onNavigate('playground')}>Testar antes de activar</Button>
              {!operationallyReady && (
                <p className="self-center text-xs text-muted-foreground">
                  A prontidão é uma orientação; a activação continua a respeitar as validações do servidor.
                </p>
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
                {state.agentName || 'Agente sem nome'}
              </h3>
              {state.agentRole && (
                <p className="text-sm text-muted-foreground">{state.agentRole}</p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Row label="Estado" value={state.isActive ? 'Activo' : 'Inactivo'} />
            <Row label="Modelo" value={modelLabel} />
            <Row
              label="Temperatura"
              value={state.temperatureEnabled ? state.temperature.toFixed(2) : 'Por omissão'}
            />
          </div>

          <div className="mt-4 space-y-1">
            <Row
              label="Skills activas"
              value={counts ? `${counts.skillsActive} / ${counts.skillsTotal}` : '…'}
            />
            <Row
              label="Tools disponíveis"
              value={counts ? `${counts.toolsEnabled} / ${counts.toolsTotal}` : '…'}
            />
            <Row
              label="Fontes de conhecimento"
              value={counts ? String(counts.knowledgeDocs) : '…'}
            />
            <Row label="Auto-resposta" value={state.autoReplyEnabled ? 'Activa' : 'Inactiva'} />
          </div>

          <div className="flex gap-2 pt-4">
            <Button onClick={() => onNavigate('playground')}>Testar agente</Button>
            <Button variant="outline" onClick={() => onNavigate('identity')}>
              Configurar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
