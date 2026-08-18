'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Zap,
  Plus,
  MoreVertical,
  Copy,
  Pencil,
  Trash2,
  FileText,
  MessageCircle,
  Clock,
  PhoneCall,
  Loader2,
  LayoutTemplate,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { useLocale, useTranslations } from 'next-intl';
import type { Automation } from '@/types';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AUTOMATION_TEMPLATES,
  type TemplateSlug,
} from '@/lib/automations/templates';
import { triggerMeta, formatRelative } from '@/lib/automations/trigger-meta';
import { cn } from '@/lib/utils';

// Only templates that are safe recommendations for the modern agent runtime.
// The legacy keyword-based lead qualifier still exists for old deep links and
// saved automations, but is intentionally not promoted until Automations have
// a semantic intent trigger instead of language-specific keywords.
const TEMPLATE_ORDER: TemplateSlug[] = [
  'welcome_message',
  'out_of_office',
  'follow_up_reminder',
];

const TEMPLATE_ICON: Record<TemplateSlug, typeof Zap> = {
  welcome_message: MessageCircle,
  out_of_office: Clock,
  lead_qualifier: Zap,
  follow_up_reminder: PhoneCall,
};

const QUICK_START_COPY = {
  pt: {
    welcome_message: {
      name: 'Primeiro contacto inteligente',
      description: 'Deixa o agente responder naturalmente à primeira mensagem, com contexto e sem saudação pré-fabricada.',
    },
    out_of_office: {
      name: 'Atendimento fora do horário',
      description: 'Mantém o agente a ajudar fora do horário e só fala da equipa física quando isso for realmente necessário.',
    },
    follow_up_reminder: {
      name: 'Seguimento contextual',
      description: 'Retoma uma conversa parada através do mesmo agente e do contexto real, em vez de enviar um lembrete genérico.',
    },
  },
  en: {
    welcome_message: {
      name: 'Smart first contact',
      description: 'Let the agent answer the real first message naturally, with context and without a canned greeting.',
    },
    out_of_office: {
      name: 'After-hours agent',
      description: 'Keep the agent useful after hours and mention human or physical availability only when it matters.',
    },
    follow_up_reminder: {
      name: 'Contextual follow-up',
      description: 'Resume a quiet conversation through the same agent and real context instead of a generic reminder.',
    },
  },
} as const;

function quickStartCopy(locale: string, slug: TemplateSlug) {
  const lang = locale.toLowerCase().startsWith('pt') ? 'pt' : 'en';
  const copy = QUICK_START_COPY[lang];
  if (slug === 'lead_qualifier') {
    return {
      name: AUTOMATION_TEMPLATES[slug].name,
      description: AUTOMATION_TEMPLATES[slug].description,
    };
  }
  return copy[slug];
}

export default function AutomationsPage() {
  const router = useRouter();
  const locale = useLocale();
  const canCreate = useCan('send-messages');
  const t = useTranslations('Automations.list');
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      const supabase = createClient();
      const { data, error: fetchErr } = await supabase
        .from('automations')
        .select('*')
        .order('created_at', { ascending: false });
      if (fetchErr) throw fetchErr;
      setAutomations((data ?? []) as Automation[]);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load automations'
      );
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(a: Automation, next: boolean) {
    setAutomations(
      (prev) =>
        prev?.map((x) => (x.id === a.id ? { ...x, is_active: next } : x)) ??
        prev
    );
    const res = await fetch(`/api/automations/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      setAutomations(
        (prev) =>
          prev?.map((x) => (x.id === a.id ? { ...x, is_active: !next } : x)) ??
          prev
      );
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? t('toasts.updateError'));
      return;
    }
    toast.success(next ? t('toasts.activated') : t('toasts.paused'));
  }

  async function duplicate(a: Automation) {
    const res = await fetch(`/api/automations/${a.id}/duplicate`, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? t('toasts.duplicateError'));
      return;
    }
    toast.success(t('toasts.duplicated'));
    load();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const res = await fetch(`/api/automations/${pendingDelete.id}`, {
      method: 'DELETE',
    });
    setDeleting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? t('toasts.deleteError'));
      return;
    }
    toast.success(t('toasts.deleted'));
    setPendingDelete(null);
    load();
  }

  function startFromTemplate(slug: TemplateSlug) {
    router.push(`/automations/new?template=${slug}`);
  }

  const summary = useMemo(() => {
    const rows = automations ?? [];
    return {
      total: rows.length,
      active: rows.filter((item) => item.is_active).length,
      paused: rows.filter((item) => !item.is_active).length,
      executions: rows.reduce(
        (sum, item) => sum + (item.execution_count ?? 0),
        0
      ),
    };
  }, [automations]);

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-destructive text-sm">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (automations === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="border-border/80 flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground sm:text-[28px]">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm">
                    <LayoutTemplate className="size-4" />
                    {t('templatesTitle')}
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-80">
                {TEMPLATE_ORDER.map((slug) => {
                  const copy = quickStartCopy(locale, slug);
                  const Icon = TEMPLATE_ICON[slug];
                  return (
                    <DropdownMenuItem
                      key={slug}
                      onClick={() => startFromTemplate(slug)}
                      className="items-start gap-3 py-2.5"
                    >
                      <Icon className="text-primary mt-0.5 size-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {copy.name}
                        </span>
                        <span className="text-muted-foreground mt-0.5 block text-xs leading-snug">
                          {copy.description}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <GatedButton
            canAct={canCreate}
            gateReason="create automations"
            onClick={() => router.push('/automations/new')}
            size="sm"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" />
            {t('create')}
          </GatedButton>
        </div>
      </header>

      <section
        aria-label="Resumo das automações"
        className="border-border grid grid-cols-2 overflow-hidden rounded-xl border bg-card divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0"
      >
        <SummaryCell label="Total" value={summary.total} />
        <SummaryCell label="Activas" value={summary.active} tone="active" />
        <SummaryCell label="Pausadas" value={summary.paused} />
        <SummaryCell label="Execuções" value={summary.executions} />
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-section-title">Regras de automação</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Veja rapidamente o gatilho, estado e actividade de cada regra.
            </p>
          </div>
        </div>

        {automations.length === 0 ? (
          <div className="border-border flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed px-5 text-center">
            <Zap className="text-primary size-6" />
            <p className="text-foreground mt-3 text-sm font-medium">
              {t('emptyTitle')}
            </p>
            <p className="text-muted-foreground mt-1 max-w-md text-xs">
              {t('emptyDesc')}
            </p>
          </div>
        ) : (
          <div className="border-border overflow-hidden rounded-xl border bg-card">
            <div className="text-muted-foreground hidden grid-cols-[minmax(220px,2fr)_minmax(160px,1fr)_110px_120px_42px] gap-3 border-b border-border bg-muted/35 px-4 py-2.5 text-xs font-medium lg:grid">
              <span>Automação</span>
              <span>Gatilho</span>
              <span>Execuções</span>
              <span>Estado</span>
              <span />
            </div>
            <ul className="divide-border divide-y">
              {automations.map((automation) => (
                <AutomationRow
                  key={automation.id}
                  automation={automation}
                  onToggle={(next) => toggleActive(automation, next)}
                  onEdit={() => router.push(`/automations/${automation.id}/edit`)}
                  onDuplicate={() => duplicate(automation)}
                  onLogs={() => router.push(`/automations/${automation.id}/logs`)}
                  onDelete={() => setPendingDelete(automation)}
                  t={t}
                />
              ))}
            </ul>
          </div>
        )}
      </section>

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(value) => !value && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('deleteDesc', { name: pendingDelete?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'active';
}) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <p className="text-meta">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        {tone === 'active' ? <span className="bg-primary size-2 rounded-full" /> : null}
        <p className="text-2xl font-semibold tabular-nums text-foreground">
          {value.toLocaleString()}
        </p>
      </div>
    </div>
  );
}

function AutomationRow({
  automation,
  onToggle,
  onEdit,
  onDuplicate,
  onLogs,
  onDelete,
  t,
}: {
  automation: Automation;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onLogs: () => void;
  onDelete: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const meta = triggerMeta(automation.trigger_type);

  return (
    <li className="hover:bg-muted/35 transition-colors duration-150">
      <div className="flex items-center gap-3 px-4 py-3 lg:grid lg:grid-cols-[minmax(220px,2fr)_minmax(160px,1fr)_110px_120px_42px]">
        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 text-left lg:flex-none"
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'size-2 shrink-0 rounded-full',
                automation.is_active ? 'bg-primary' : 'bg-muted-foreground/45'
              )}
              aria-hidden
            />
            <span className="truncate text-sm font-semibold text-foreground">
              {automation.name}
            </span>
          </div>
          {automation.description ? (
            <p className="text-muted-foreground mt-1 truncate pl-4 text-xs">
              {automation.description}
            </p>
          ) : null}
        </button>

        <div className="hidden min-w-0 lg:block">
          <span
            className={cn(
              'inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
              meta.pillClass
            )}
          >
            <span className="truncate">{meta.label}</span>
          </span>
          <p className="text-muted-foreground mt-1 truncate text-xs">
            {t('lastRun', { time: formatRelative(automation.last_executed_at) })}
          </p>
        </div>

        <div className="text-muted-foreground hidden text-xs tabular-nums lg:block">
          {automation.execution_count === 1
            ? t('runs', { count: automation.execution_count })
            : t('runsPlural', { count: automation.execution_count })}
        </div>

        <div className="flex items-center justify-end gap-2 lg:justify-start">
          <Switch
            checked={automation.is_active}
            onCheckedChange={(value) => onToggle(!!value)}
            aria-label={automation.is_active ? t('deactivate') : t('activate')}
          />
          <span className="text-muted-foreground hidden text-xs xl:inline">
            {automation.is_active ? 'Activa' : 'Pausada'}
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Open menu"
            className="text-muted-foreground hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted inline-flex size-8 items-center justify-center rounded-md transition-colors"
          >
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4" />
              {t('edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="size-4" />
              {t('duplicate')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onLogs}>
              <FileText className="size-4" />
              {t('viewLogs')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-4" />
              {t('delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
