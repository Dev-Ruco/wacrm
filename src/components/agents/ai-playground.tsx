'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useLocale } from 'next-intl';
import {
  Bot,
  RotateCcw,
  Send,
  Loader2,
  UserCircle2,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface ExecutionTrace {
  skills_active: string[];
  tools_called: { name: string; ms: number; succeeded: boolean }[];
  knowledge_sources_used: number;
  guardrails: { safe: boolean; violations: string[] };
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** assistant-only: the agent signalled a human handoff on this turn. */
  handoff?: boolean;
  /** assistant-only: what actually ran to produce this reply — skills,
   *  tools, knowledge, guardrail result. Ephemeral, never persisted. */
  execution?: ExecutionTrace;
}

const COPY = {
  pt: {
    title: 'Testar agente',
    subtitle: 'simule uma conversa como se fosse um cliente',
    reset: 'Reiniciar',
    emptyTitle: 'Envie uma mensagem para ver como o agente responderia.',
    emptyDesc: 'O teste usa o conhecimento e o comportamento configurados, incluindo transferência para uma pessoa.',
    setupLink: 'Ainda não configurado? Ir para configuração',
    noAgent: 'Ainda não existe um agente configurado — termine a configuração primeiro.',
    replyError: 'Não foi possível obter uma resposta do agente.',
    connectionError: 'Não foi possível ligar ao agente.',
    handoff: 'Aqui o atendimento seria transferido para uma pessoa',
    thinking: 'A pensar…',
    placeholder: 'Escreva uma mensagem como cliente…',
    execution: 'Execução',
    skills: 'Competências activas:',
    tools: 'Ferramentas chamadas:',
    knowledge: 'Conhecimento:',
    sourcesUsed: (count: number) => `${count} fonte(s) usada(s)`,
    failed: 'falhou',
  },
  en: {
    title: 'Test agent',
    subtitle: 'simulate a conversation as if you were a customer',
    reset: 'Reset',
    emptyTitle: 'Send a message to see how your agent would reply.',
    emptyDesc: 'The test uses your configured knowledge and behaviour, including human handoff.',
    setupLink: 'Not set up yet? Go to setup',
    noAgent: 'No agent configured yet — finish setup first.',
    replyError: "Couldn't get a reply from the agent.",
    connectionError: "Couldn't reach the agent.",
    handoff: 'Would hand off to a human here',
    thinking: 'Thinking…',
    placeholder: 'Type a customer message…',
    execution: 'Execution',
    skills: 'Active skills:',
    tools: 'Tools called:',
    knowledge: 'Knowledge:',
    sourcesUsed: (count: number) => `${count} source(s) used`,
    failed: 'failed',
  },
} as const;

export function AiPlayground({ onGoToSetup }: { onGoToSetup?: () => void }) {
  const locale = useLocale();
  const copy = locale.toLowerCase().startsWith('pt') ? COPY.pt : COPY.en;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [expandedExecution, setExpandedExecution] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/ai/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send only role+content — the server ignores anything else.
        body: JSON.stringify({
          messages: next.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error(copy.noAgent);
        } else {
          console.error('[agent playground] request failed:', data.error ?? data);
          toast.error(copy.replyError);
        }
        // Roll the unsent user turn back so the transcript stays clean.
        setTurns(turns);
        setInput(text);
        return;
      }
      setTurns([
        ...next,
        {
          role: 'assistant',
          content:
            typeof data.reply === 'string' && data.reply.trim()
              ? data.reply
              : '',
          handoff: Boolean(data.handoff),
          execution: data.execution as ExecutionTrace | undefined,
        },
      ]);
    } catch (error) {
      console.error('[agent playground] network error:', error);
      toast.error(copy.connectionError);
      setTurns(turns);
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-[60vh] min-h-[420px] flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">{copy.title}</span>
          <span className="text-xs text-muted-foreground">— {copy.subtitle}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTurns([])}
          disabled={turns.length === 0 || sending}
          className="text-muted-foreground"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {copy.reset}
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <Bot className="mb-2 h-8 w-8 text-muted-foreground/60" />
            <p>{copy.emptyTitle}</p>
            <p className="mt-1 text-xs">{copy.emptyDesc}</p>
            {onGoToSetup && (
              <Button
                variant="link"
                size="sm"
                onClick={onGoToSetup}
                className="mt-1 h-auto p-0 text-xs"
              >
                {copy.setupLink} <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            )}
          </div>
        )}

        {turns.map((t, i) => (
          <div
            key={i}
            className={cn(
              'flex gap-2',
              t.role === 'user' ? 'justify-end' : 'justify-start',
            )}
          >
            {t.role === 'assistant' && (
              <Bot className="mt-1 h-5 w-5 shrink-0 text-primary" />
            )}
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                t.role === 'user'
                  ? 'rounded-br-sm bg-primary text-primary-foreground'
                  : 'rounded-bl-sm bg-muted text-foreground',
              )}
            >
              {t.content && <p className="whitespace-pre-wrap">{t.content}</p>}
              {t.role === 'assistant' && t.handoff && (
                <p
                  className={cn(
                    'flex items-center gap-1 text-xs text-amber-500',
                    t.content && 'mt-1.5 border-t border-border/50 pt-1.5',
                  )}
                >
                  <UserCircle2 className="h-3.5 w-3.5" />
                  {copy.handoff}
                </p>
              )}
              {t.role === 'assistant' && t.execution && (
                <div className="mt-1.5 border-t border-border/50 pt-1.5">
                  <button
                    type="button"
                    onClick={() => setExpandedExecution((current) => (current === i ? null : i))}
                    aria-expanded={expandedExecution === i}
                    aria-controls={`execution-${i}`}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {expandedExecution === i ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                    {copy.execution}
                  </button>
                  {expandedExecution === i && (
                    <dl id={`execution-${i}`} className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                      <div className="flex gap-1">
                        <dt className="shrink-0 font-medium text-foreground">{copy.skills}</dt>
                        <dd>
                          {t.execution.skills_active.length > 0
                            ? t.execution.skills_active.join(', ')
                            : '—'}
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt className="shrink-0 font-medium text-foreground">{copy.tools}</dt>
                        <dd>
                          {t.execution.tools_called.length > 0
                            ? t.execution.tools_called
                                .map((call) => `${call.name}${call.succeeded ? '' : ` (${copy.failed})`}`)
                                .join(', ')
                            : '—'}
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt className="shrink-0 font-medium text-foreground">{copy.knowledge}</dt>
                        <dd>{copy.sourcesUsed(t.execution.knowledge_sources_used)}</dd>
                      </div>
                      <div className="flex items-center gap-1">
                        <dt className="shrink-0 font-medium text-foreground">Guardrails:</dt>
                        <dd className="flex items-center gap-1">
                          {t.execution.guardrails.safe ? (
                            <>
                              <ShieldCheck className="h-3 w-3 text-emerald-500" /> OK
                            </>
                          ) : (
                            <>
                              <ShieldAlert className="h-3 w-3 text-amber-500" />
                              {t.execution.guardrails.violations.join(', ')}
                            </>
                          )}
                        </dd>
                      </div>
                    </dl>
                  )}
                </div>
              )}
            </div>
            {t.role === 'user' && (
              <UserCircle2 className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
            )}
          </div>
        ))}

        {sending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bot className="h-5 w-5 text-primary" />
            <Loader2 className="h-4 w-4 animate-spin" /> {copy.thinking}
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-border p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={copy.placeholder}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
        />
        <Button
          size="sm"
          onClick={send}
          disabled={!input.trim() || sending}
          className="h-9 w-9 shrink-0 p-0"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
