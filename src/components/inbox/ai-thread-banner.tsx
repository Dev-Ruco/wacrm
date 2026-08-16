'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Hand,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Sparkles,
  UserRound,
  WandSparkles,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface AiAccountStatus {
  autoReplyOn: boolean;
}

const statusCache = new Map<string, AiAccountStatus>();

async function fetchAiAccountStatus(accountId: string): Promise<AiAccountStatus> {
  const cached = statusCache.get(accountId);
  if (cached) return cached;

  try {
    const res = await fetch('/api/ai/config', { cache: 'no-store' });
    if (!res.ok) return { autoReplyOn: false };
    const json = await res.json();
    const status = {
      autoReplyOn: Boolean(
        json?.configured && json?.is_active && json?.auto_reply_enabled
      ),
    };
    statusCache.set(accountId, status);
    return status;
  } catch {
    return { autoReplyOn: false };
  }
}

interface AiThreadBannerProps {
  conversationId: string;
  disabled: boolean;
  handoffSummary?: string | null;
  assignedAgentId?: string | null;
  currentUserId?: string | null;
  onChange?: (patch: {
    ai_autoreply_disabled: boolean;
    assigned_agent_id?: string | null;
  }) => void;
}

type OperatingMode = 'ai' | 'copilot' | 'human';

const MODE_META: Record<
  OperatingMode,
  { label: string; description: string; icon: typeof Sparkles }
> = {
  ai: {
    label: 'IA automática',
    description: 'A IA responde directamente ao cliente',
    icon: Sparkles,
  },
  copilot: {
    label: 'Copiloto',
    description: 'A IA prepara respostas e o humano decide o envio',
    icon: WandSparkles,
  },
  human: {
    label: 'Humano',
    description: 'O atendimento automático está em pausa',
    icon: UserRound,
  },
};

export function AiThreadBanner({
  conversationId,
  disabled,
  handoffSummary,
  assignedAgentId,
  currentUserId,
  onChange,
}: AiThreadBannerProps) {
  const t = useTranslations('Inbox.aiBanner');
  const { accountId } = useAuth();
  const [autoReplyOn, setAutoReplyOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [paused, setPaused] = useState(disabled);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [draft, setDraft] = useState('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => setPaused(disabled), [conversationId, disabled]);

  useEffect(() => {
    setCopilotOpen(false);
    setInstruction('');
    setDraft('');
  }, [conversationId]);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    fetchAiAccountStatus(accountId).then((status) => {
      if (alive) setAutoReplyOn(status.autoReplyOn);
    });
    return () => {
      alive = false;
    };
  }, [accountId]);

  const updatePause = useCallback(
    async (nextPaused: boolean): Promise<boolean> => {
      if (busy) return false;
      setBusy(true);
      try {
        const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paused: nextPaused,
            assign_to_me: nextPaused,
          }),
        });

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          toast.error(json?.error ?? t('updateError'));
          return false;
        }

        setPaused(nextPaused);
        onChange?.({
          ai_autoreply_disabled: nextPaused,
          ...(nextPaused
            ? currentUserId
              ? { assigned_agent_id: currentUserId }
              : {}
            : { assigned_agent_id: null }),
        });
        toast.success(nextPaused ? t('tookOver') : t('resumed'));
        return true;
      } catch {
        toast.error(t('networkError'));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, conversationId, currentUserId, onChange, t]
  );

  const resetConversationContext = useCallback(async () => {
    if (resetting) return;
    const confirmed = window.confirm(
      'Reiniciar o contexto da IA? O histórico continuará visível no CRM, mas a IA tratará a próxima mensagem do cliente como o início de uma nova conversa.'
    );
    if (!confirmed) return;

    setResetting(true);
    try {
      const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: false, reset_context: true }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload?.error ?? 'Não foi possível reiniciar o contexto.');
        return;
      }

      setPaused(false);
      setCopilotOpen(false);
      setInstruction('');
      setDraft('');
      onChange?.({ ai_autoreply_disabled: false, assigned_agent_id: null });
      toast.success('Contexto da IA reiniciado.');
    } catch {
      toast.error('Não foi possível reiniciar o contexto.');
    } finally {
      setResetting(false);
    }
  }, [conversationId, onChange, resetting]);

  const generateOperatorReply = useCallback(async () => {
    const trimmed = instruction.trim();
    if (!trimmed || generating) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/ai/operator-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId,
          instruction: trimmed,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload?.error ?? 'Não foi possível gerar a resposta.');
        return;
      }

      const nextDraft =
        typeof payload?.draft === 'string' ? payload.draft.trim() : '';
      if (!nextDraft) {
        toast.error('A IA não devolveu uma resposta.');
        return;
      }
      setDraft(nextDraft);
    } catch {
      toast.error('Não foi possível contactar o assistente de IA.');
    } finally {
      setGenerating(false);
    }
  }, [conversationId, generating, instruction]);

  const humanMode = paused || Boolean(assignedAgentId);
  const mode: OperatingMode = copilotOpen
    ? 'copilot'
    : humanMode
      ? 'human'
      : 'ai';

  const changeMode = useCallback(
    async (nextMode: OperatingMode) => {
      if (nextMode === 'ai') {
        setCopilotOpen(false);
        if (paused || assignedAgentId) await updatePause(false);
        return;
      }

      if (!paused) {
        const changed = await updatePause(true);
        if (!changed) return;
      }

      setCopilotOpen(nextMode === 'copilot');
    },
    [assignedAgentId, paused, updatePause]
  );

  const useDraftInComposer = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    window.dispatchEvent(
      new CustomEvent('wacrm:composer-draft', {
        detail: { conversationId, text },
      })
    );
    setDraft('');
    setInstruction('');
    toast.success('Resposta colocada no editor.');
  }, [conversationId, draft]);

  if (!autoReplyOn) return null;

  const meta = MODE_META[mode];
  const ModeIcon = meta.icon;

  return (
    <div
      className={cn(
        'border-border bg-card/95 border-b backdrop-blur-sm',
        handoffSummary && 'bg-amber-500/[0.04]'
      )}
    >
      <div className="flex min-h-10 items-center gap-2 px-3 py-1.5 sm:px-4">
        <div
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full',
            mode === 'ai'
              ? 'bg-primary/10 text-primary'
              : mode === 'copilot'
                ? 'bg-violet-500/10 text-violet-500'
                : 'bg-muted text-muted-foreground'
          )}
        >
          <ModeIcon className="size-3.5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-xs font-semibold text-foreground">
              {meta.label}
            </span>
            {handoffSummary ? (
              <span className="flex min-w-0 items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3 shrink-0" />
                <span className="truncate">{handoffSummary}</span>
              </span>
            ) : (
              <span className="text-muted-foreground hidden truncate text-[11px] md:block">
                {meta.description}
              </span>
            )}
          </div>
        </div>

        {mode === 'ai' ? (
          <button
            type="button"
            onClick={() => void changeMode('human')}
            disabled={busy}
            className="border-border bg-background hover:bg-muted inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium text-foreground transition-colors disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Hand className="size-3" />
            )}
            Assumir
          </button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={busy}
            className="hover:bg-muted inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            Modo
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {(Object.keys(MODE_META) as OperatingMode[]).map((key) => {
              const item = MODE_META[key];
              const Icon = item.icon;
              return (
                <DropdownMenuItem
                  key={key}
                  onClick={() => void changeMode(key)}
                  className="items-start gap-2.5 py-2.5"
                >
                  <Icon className="mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{item.label}</span>
                      {mode === key ? <Check className="text-primary size-4" /> : null}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
                      {item.description}
                    </p>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Mais opções da IA"
            className="hover:bg-muted inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setCopilotOpen(true)}>
              <WandSparkles className="size-4" />
              Abrir Copiloto
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void resetConversationContext()}
              disabled={resetting}
            >
              {resetting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              Reiniciar contexto da IA
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {copilotOpen ? (
        <div className="border-border bg-muted/20 border-t px-3 py-3 sm:px-4">
          <div className="mx-auto max-w-4xl space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-foreground">
                  Copiloto
                </p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  Diga o que pretende responder. A IA prepara o texto e coloca-o no editor para revisão.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCopilotOpen(false)}
                aria-label="Fechar Copiloto"
                className="hover:bg-muted hover:text-foreground rounded-md p-1 text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex items-end gap-2">
              <textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="Ex.: Diga que esta cor acabou, mas ofereça preto e azul."
                rows={1}
                maxLength={2000}
                className="border-border bg-background focus:border-primary/40 min-h-10 flex-1 resize-y rounded-xl border px-3 py-2 text-sm text-foreground outline-none"
              />
              <button
                type="button"
                onClick={() => void generateOperatorReply()}
                disabled={!instruction.trim() || generating}
                className="bg-primary text-primary-foreground inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-medium disabled:opacity-50"
              >
                {generating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                Gerar
              </button>
            </div>

            {draft ? (
              <div className="border-primary/20 bg-primary/[0.04] rounded-xl border p-2.5">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={3}
                  className="border-border bg-background focus:border-primary/40 w-full resize-y rounded-lg border px-3 py-2 text-sm text-foreground outline-none"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDraft('')}
                    className="hover:bg-muted rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground"
                  >
                    Descartar
                  </button>
                  <button
                    type="button"
                    onClick={useDraftInComposer}
                    className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium"
                  >
                    <WandSparkles className="size-3.5" />
                    Usar no editor
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
