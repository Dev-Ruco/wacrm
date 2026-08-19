'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, CheckCircle2, Trash2, Eye, EyeOff, Cpu, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';
import type { AgentConfigState } from './use-agent-config';

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
};
const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
};

type HandoffQueueRow = {
  enabled?: boolean;
  member_user_ids?: string[];
};

function hasReadyHandoffQueue(value: unknown): boolean {
  const queues = (value as { queues?: HandoffQueueRow[] } | null)?.queues ?? [];
  return queues.some(
    (queue) => queue.enabled !== false && (queue.member_user_ids?.length ?? 0) > 0,
  );
}

async function loadHandoffQueueReady(): Promise<boolean> {
  try {
    const response = await fetch('/api/account/handoff-queues', { cache: 'no-store' });
    if (!response.ok) return false;
    const data = await response.json().catch(() => null);
    return hasReadyHandoffQueue(data);
  } catch (error) {
    console.warn('[agent runtime] activation preflight handoff check failed:', error);
    return false;
  }
}

/**
 * Modelo & Runtime: provider/model/credentials and the technical dials
 * that shape HOW the agent executes (temperature, message buffer, reply
 * chunking, embeddings). Deliberately does NOT expose MAX_TOOL_ROUNDS,
 * context message limit, or request timeout — those are still hardcoded
 * constants / deployment-wide env vars (see src/lib/ai/defaults.ts and
 * providers/*.ts), not per-account fields, and a non-technical admin
 * setting them wrong could break the bot outright.
 */
export function AgentRuntime({ state }: { state: AgentConfigState }) {
  const { t } = state;
  const [showKey, setShowKey] = useState(false);
  const [handoffQueueReady, setHandoffQueueReady] = useState(false);
  const initialLiveRef = useRef<boolean | null>(null);
  const disabled = !state.canEdit || state.saving;

  useEffect(() => {
    if (!state.loading && initialLiveRef.current === null) {
      initialLiveRef.current = state.isActive && state.autoReplyEnabled;
    }
  }, [state.loading, state.isActive, state.autoReplyEnabled]);

  useEffect(() => {
    if (!state.canEdit) return;
    let cancelled = false;
    void loadHandoffQueueReady().then((ready) => {
      if (!cancelled) setHandoffQueueReady(ready);
    });
    return () => {
      cancelled = true;
    };
  }, [state.canEdit]);

  async function saveWithActivationGuard() {
    const goingLive =
      state.isActive &&
      state.autoReplyEnabled &&
      initialLiveRef.current !== true;

    if (goingLive) {
      let knowledgeCount: number | null = null;
      let specialistHandoffReady = handoffQueueReady;
      try {
        const [knowledgeResponse, queueReady] = await Promise.all([
          fetch('/api/ai/knowledge', { cache: 'no-store' }),
          loadHandoffQueueReady(),
        ]);
        specialistHandoffReady = queueReady;
        setHandoffQueueReady(queueReady);
        if (knowledgeResponse.ok) {
          const data = await knowledgeResponse.json().catch(() => ({}));
          knowledgeCount = Array.isArray(data?.documents) ? data.documents.length : null;
        }
      } catch (error) {
        console.warn('[agent runtime] activation preflight knowledge check failed:', error);
      }

      const warnings: string[] = [];
      if (knowledgeCount === 0) {
        warnings.push('não existe nenhuma fonte de conhecimento carregada');
      }
      if (!state.handoffAgentId && !specialistHandoffReady) {
        warnings.push('não existe destinatário ou equipa configurada para transferência humana');
      }

      if (warnings.length > 0) {
        const confirmed = window.confirm(
          `Antes de colocar o agente a responder a clientes reais:\n\n• ${warnings.join('\n• ')}\n\nO agente pode ser activado assim, mas recomenda-se corrigir estes pontos e testá-lo primeiro em “Testar agente”.\n\nContinuar e guardar?`,
        );
        if (!confirmed) return;
      }
    }

    const saved = await state.handleSave();
    if (saved) {
      initialLiveRef.current = state.isActive && state.autoReplyEnabled;
    }
  }

  const handoffReady = Boolean(state.handoffAgentId) || handoffQueueReady;

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle as="h3" className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> {t('providerAndKey')}
          </CardTitle>
          <CardDescription>{t('encryptionNotice')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('provider')}</Label>
              <Select
                value={state.provider}
                onValueChange={(v) => state.setProvider(v as AiProvider)}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">{PROVIDER_LABEL.openai}</SelectItem>
                  <SelectItem value="anthropic">{PROVIDER_LABEL.anthropic}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-model">{t('model')}</Label>
              <Input
                id="ai-model"
                value={state.model}
                onChange={(e) => state.setModel(e.target.value)}
                placeholder={AI_PROVIDER_DEFAULT_MODEL[state.provider]}
                disabled={disabled}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-key">{t('apiKey')}</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="ai-key"
                  type={showKey ? 'text' : 'password'}
                  value={state.apiKey}
                  onChange={(e) => {
                    state.setApiKey(e.target.value);
                    state.setKeyEdited(true);
                  }}
                  onFocus={() => {
                    if (!state.keyEdited && state.hasStoredKey) {
                      state.setApiKey('');
                      state.setKeyEdited(true);
                    }
                  }}
                  placeholder={KEY_PLACEHOLDER[state.provider]}
                  disabled={disabled}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  aria-label={showKey ? 'Ocultar chave' : 'Mostrar chave'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button variant="outline" onClick={() => void state.handleTest()} disabled={disabled || state.testing}>
                {state.testing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                {t('testKey')}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-embeddings-key">
              {t('embeddingsKey')}{' '}
              <span className="font-normal text-muted-foreground">{t('optionalSemanticSearch')}</span>
            </Label>
            <Input
              id="ai-embeddings-key"
              type="password"
              value={state.embeddingsKey}
              onChange={(e) => {
                state.setEmbeddingsKey(e.target.value);
                state.setEmbeddingsKeyEdited(true);
              }}
              onFocus={() => {
                if (!state.embeddingsKeyEdited && state.hasStoredEmbeddingsKey) {
                  state.setEmbeddingsKey('');
                  state.setEmbeddingsKeyEdited(true);
                }
              }}
              placeholder="sk-... (OpenAI)"
              disabled={disabled}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {t('embeddingsHint', {
                sameKeyText: state.provider === 'openai' ? t('sameKeyText') : '',
              })}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h3" className="flex items-center gap-2 text-base">
            <Cpu className="h-4 w-4 text-primary" /> Execução
          </CardTitle>
          <CardDescription>
            Estado, temporização e o limite de tokens de saída (fixo, ver docs) por resposta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">{t('enableAssistant')}</p>
              <p className="text-xs text-muted-foreground">{t('enableAssistantDesc')}</p>
            </div>
            <Switch checked={state.isActive} onCheckedChange={state.setIsActive} disabled={disabled} />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">{t('autoReply')}</p>
              <p className="text-xs text-muted-foreground">{t('autoReplyDesc')}</p>
            </div>
            <Switch
              checked={state.autoReplyEnabled}
              onCheckedChange={state.setAutoReplyEnabled}
              disabled={disabled || !state.isActive}
            />
          </div>

          {state.isActive && state.autoReplyEnabled && !handoffReady ? (
            <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Antes de colocar o agente ao vivo, configure quem deve receber uma transferência humana em Segurança ou numa equipa especialista e faça uma conversa em “Testar agente”.
              </p>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="ai-buffer-window">{t('messageBuffer')}</Label>
              <p className="text-xs text-muted-foreground">{t('messageBufferDesc')}</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="ai-buffer-window"
                type="number"
                min={1}
                max={30}
                value={state.bufferWindowSeconds}
                onChange={(e) =>
                  state.setBufferWindowSeconds(Math.min(30, Math.max(1, Number(e.target.value) || 1)))
                }
                disabled={disabled || !state.autoReplyEnabled}
                className="w-20"
              />
              <span className="text-xs text-muted-foreground">{t('seconds')}</span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="ai-max-reply-chunks">{t('maxReplyChunks')}</Label>
              <p className="text-xs text-muted-foreground">{t('maxReplyChunksDesc')}</p>
            </div>
            <Input
              id="ai-max-reply-chunks"
              type="number"
              min={1}
              max={5}
              value={state.maxReplyChunks}
              onChange={(e) =>
                state.setMaxReplyChunks(Math.min(5, Math.max(1, Number(e.target.value) || 1)))
              }
              disabled={disabled || !state.autoReplyEnabled}
              className="w-20"
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">{t('temperature')}</p>
              <p className="text-xs text-muted-foreground">{t('temperatureDesc')}</p>
            </div>
            <Switch
              checked={state.temperatureEnabled}
              onCheckedChange={state.setTemperatureEnabled}
              disabled={disabled}
            />
          </div>
          {state.temperatureEnabled && (
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="ai-temperature" className="text-xs text-muted-foreground">
                {t('temperatureValue')}
              </Label>
              <Input
                id="ai-temperature"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={state.temperature}
                onChange={(e) => state.setTemperature(Math.min(2, Math.max(0, Number(e.target.value) || 0)))}
                disabled={disabled}
                className="w-20"
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="ai-usd-mzn-rate">{t('usdToMznRate')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('usdToMznRateDesc')}
                {state.usdToMznRateUpdatedAt
                  ? ` ${t('usdToMznRateUpdatedAt', { date: new Date(state.usdToMznRateUpdatedAt).toLocaleString('pt-PT') })}`
                  : ''}
              </p>
            </div>
            <span id="ai-usd-mzn-rate" className="w-24 text-right font-mono text-sm">
              {state.usdToMznRate.toFixed(2)}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        {state.configured ? (
          <Button
            variant="ghost"
            onClick={() => void state.handleRemove()}
            disabled={!state.canEdit || state.removing}
            className="text-destructive hover:text-destructive"
          >
            {state.removing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            {t('remove')}
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={() => void saveWithActivationGuard()} disabled={disabled}>
          {state.saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('save')}
        </Button>
      </div>
    </div>
  );
}
