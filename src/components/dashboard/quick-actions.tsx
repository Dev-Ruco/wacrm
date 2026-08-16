'use client';

import Link from 'next/link';
import { Briefcase, Radio, UserPlus, Zap } from 'lucide-react';
import type { ComponentType } from 'react';
import { useTranslations } from 'next-intl';

interface Action {
  labelKey: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

const ACTIONS: Action[] = [
  { labelKey: 'newContact', href: '/contacts', icon: UserPlus },
  { labelKey: 'newDeal', href: '/pipelines', icon: Briefcase },
  { labelKey: 'newBroadcast', href: '/broadcasts/new', icon: Radio },
  { labelKey: 'newAutomation', href: '/automations/new', icon: Zap },
];

export function QuickActions() {
  const t = useTranslations('Dashboard.quickActions');

  return (
    <section className="border-border overflow-hidden rounded-xl border bg-card">
      <div className="border-border/80 flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-card-title">Acções rápidas</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Comece as tarefas comerciais mais frequentes.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              className="group flex min-h-20 flex-col justify-between gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-muted/60"
            >
              <Icon className="text-muted-foreground group-hover:text-primary size-4 transition-colors duration-150" />
              <span className="text-sm font-medium text-foreground">
                {t(action.labelKey as string)}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
