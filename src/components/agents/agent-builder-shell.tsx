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

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'identity', label: 'Comportamento' },
  { id: 'knowledge', label: 'Conhecimento' },
  { id: 'tools', label: 'Ferramentas' },
  { id: 'skills', label: 'Skills' },
  { id: 'memory', label: 'Memória' },
  { id: 'security', label: 'Segurança' },
  { id: 'runtime', label: 'Runtime' },
  { id: 'playground', label: 'Testar' },
  { id: 'flow', label: 'Fluxo ao vivo' },
  { id: 'suggestions', label: 'Lições' },
  { id: 'eval', label: 'Avaliação', gated: true },
  { id: 'usage', label: 'Utilização', gated: true },
];

export function sectionLabel(id: Section): string {
  return NAV_ITEMS.find((item) => item.id === id)?.label ?? '';
}

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
  const visibleItems = NAV_ITEMS.filter((item) => !item.gated || canViewUsage);

  return (
    <div className="wacrm-page min-w-0 space-y-5">
      <header className="wacrm-page-header">
        <div className="min-w-0">
          <p className="text-label text-primary">Agente IA</p>
          <div className="mt-1 flex items-center gap-2.5">
            <span
              className={cn(
                'size-2.5 shrink-0 rounded-full',
                isActive
                  ? 'bg-[var(--wacrm-success)] shadow-[0_0_0_4px_rgb(31_138_112_/_0.12)]'
                  : 'bg-muted-foreground'
              )}
              aria-hidden="true"
            />
            <h1 className="truncate text-[26px] font-semibold tracking-tight text-foreground sm:text-[28px]">
              {agentName || 'Agente sem nome'}
            </h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {agentRole || 'Sem papel definido'} · WhatsApp ·{' '}
            <span className={cn('font-medium', isActive && 'text-[var(--wacrm-success)]')}>
              {isActive ? 'Activo' : 'Pausado'}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onNavigate('playground')}>
            <Sparkles className="size-4" />
            Testar agente
          </Button>
          {canToggleActive && onToggleActive ? (
            <Button
              variant={isActive ? 'outline' : 'default'}
              size="sm"
              onClick={onToggleActive}
            >
              {isActive ? <Pause className="size-4" /> : <Play className="size-4" />}
              {isActive ? 'Pausar' : 'Activar'}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="wacrm-surface overflow-hidden">
        <nav
          aria-label="Navegação do agente"
          className="flex gap-1 overflow-x-auto border-b border-border bg-card px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {visibleItems.map((item) => {
            const selected = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={selected ? 'page' : undefined}
                onClick={() => onNavigate(item.id)}
                className={cn(
                  'shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  selected
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <section className="min-w-0 bg-background/40 p-4 sm:p-5 lg:p-6">
          {children}
        </section>
      </div>
    </div>
  );
}
