import Link from 'next/link';
import { AlertTriangle, Briefcase, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PriorityCounts } from '@/lib/dashboard/types';

/**
 * The dashboard's "needs attention today" row — three counts that
 * already exist elsewhere in the app (Inbox unread, automation error
 * logs, deal close dates), surfaced together instead of buried in a
 * nav badge or a single line in the activity feed. Any count at zero
 * is hidden rather than shown as a hollow "0" chip.
 */
export function PriorityChips({ counts }: { counts: PriorityCounts | null }) {
  if (!counts) return null;

  const chips = [
    {
      key: 'awaiting',
      count: counts.awaitingReply,
      label: 'conversas a aguardar resposta',
      href: '/inbox',
      icon: Clock,
      tone: 'warn' as const,
    },
    {
      key: 'automation-errors',
      count: counts.automationErrors,
      label: 'automações com erro',
      href: '/automations',
      icon: AlertTriangle,
      tone: 'danger' as const,
    },
    {
      key: 'closing-soon',
      count: counts.dealsClosingSoon,
      label: 'negócios a fechar esta semana',
      href: '/pipelines',
      icon: Briefcase,
      tone: 'info' as const,
    },
  ].filter((chip) => chip.count > 0);

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2.5">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          href={chip.href}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-transform hover:-translate-y-px',
            TONE_CLASSES[chip.tone],
          )}
        >
          <chip.icon className="size-4" />
          <span className="text-base font-bold tabular-nums">{chip.count}</span>
          {chip.label}
        </Link>
      ))}
    </div>
  );
}

const TONE_CLASSES = {
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  danger: 'bg-destructive/10 text-destructive',
  info: 'bg-primary-soft text-primary',
};
