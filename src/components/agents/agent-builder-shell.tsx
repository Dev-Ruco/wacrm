'use client';

import type { ReactNode } from 'react';
import { Pause, Play, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export type Section =
  | 'overview'
  | 'identity'
  | 'skills'
  | 'tools'
  | 'knowledge'
  | 'memory'
  | 'security'
  | 'runtime'
  | 'playground'
  | 'flow'
  | 'suggestions'
  | 'eval'
  | 'usage';

interface NavItem {
  id: Section;
  label: string;
  gated?: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'agent',
    label: 'Agente',
    items: [
      { id: 'overview', label: 'Visão geral' },
      { id: 'identity', label: 'Comportamento' },
    ],
  },
  {
    id: 'capabilities',
    label: 'Capacidades',
    items: [
      { id: 'tools', label: 'Ferramentas' },
      { id: 'skills', label: 'Skills' },
      { id: 'knowledge', label: 'Conhecimento' },
      { id: 'memory', label: 'Memória' },
    ],
  },
  {
    id: 'operation',
    label: 'Operação',
    items: [
      { id: 'security', label: 'Segurança & handoff' },
      { id: 'runtime', label: 'Modelo & runtime' },
    ],
  },
  {
    id: 'validation',
    label: 'Validar & observar',
    items: [
      { id: 'playground', label: 'Testar agente' },
      { id: 'flow', label: 'Fluxo ao vivo' },
      { id: 'suggestions', label: 'Lições' },
      { id: 'eval', label: 'Avaliação', gated: true },
      { id: 'usage', label: 'Utilização', gated: true },
    ],
  },
];

export function sectionLabel(id: Section): string {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((entry) => entry.id === id);
    if (item) return item.label;
  }
  return '';
}

/**
 * Agent workspace with one local navigation rail only. The previous version
 * replaced the original sidebar with two stacked SegmentedControls, which
 * still consumed vertical space and forced users to understand two levels of
 * navigation. This shell keeps the top app navigation global and gives the
 * agent workspace one compact contextual rail on desktop.
 */
export function AgentBuilderShell({
  active,
  onNavigate,
  agentName,
  agentRole,
  isActive,
  onToggleActive,
  canToggleActive,
  canViewUsage,
  children,
}: {
  active: Section;
  onNavigate: (section: Section) => void;
  agentName: string;
  agentRole: string;
  isActive: boolean;
  onToggleActive?: () => void;
  canToggleActive: boolean;
  canViewUsage: boolean;
  children: ReactNode;
}) {
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.gated || canViewUsage),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:gap-0">
        <aside className="border-border/80 bg-card/35 w-full shrink-0 rounded-xl border p-2 lg:sticky lg:top-0 lg:w-56 lg:self-start lg:rounded-none lg:border-y-0 lg:border-l-0 lg:border-r lg:bg-transparent lg:p-0 lg:pr-4">
          <nav aria-label="Navegação do agente" className="space-y-4">
            {visibleGroups.map((group) => (
              <div key={group.id}>
                <p className="text-label mb-1.5 px-2">{group.label}</p>
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
                  {group.items.map((item) => {
                    const isActiveItem = active === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-current={isActiveItem ? 'page' : undefined}
                        onClick={() => onNavigate(item.id)}
                        className={cn(
                          'min-h-9 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors duration-150',
                          isActiveItem
                            ? 'bg-primary-soft text-primary'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <section className="min-w-0 flex-1 lg:pl-6">
          <header className="border-border/80 flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    'h-2.5 w-2.5 shrink-0 rounded-full',
                    isActive
                      ? 'bg-primary shadow-[0_0_0_4px_var(--primary-soft)]'
                      : 'bg-muted-foreground'
                  )}
                  aria-hidden="true"
                />
                <h1 className="text-[22px] font-semibold tracking-tight text-foreground sm:text-2xl">
                  {agentName || 'Agente sem nome'}
                </h1>
              </div>
              <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
                {agentRole || 'Sem papel definido'} · WhatsApp ·{' '}
                <span className={cn('font-medium', isActive ? 'text-primary' : '')}>
                  {isActive ? 'Activo' : 'Pausado'}
                </span>
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate('playground')}
              >
                <Sparkles className="size-4" />
                Testar
              </Button>
              {canToggleActive && onToggleActive ? (
                <Button
                  variant={isActive ? 'outline' : 'default'}
                  size="sm"
                  onClick={onToggleActive}
                >
                  {isActive ? (
                    <Pause className="size-4" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  {isActive ? 'Pausar' : 'Activar'}
                </Button>
              ) : null}
            </div>
          </header>

          <div className="min-w-0 pt-5">{children}</div>
        </section>
      </div>
    </div>
  );
}
